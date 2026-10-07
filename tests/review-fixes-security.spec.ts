import { createServer, type IncomingMessage, type Server } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { resolveConfig } from '../src/config.ts'
import { authenticatedWebHandler, installVisionToolkitWeb, SETTINGS_ROUTE, DISPLAY_CONFIG_ROUTE } from '../src/web.ts'
import { PASTE_IMAGES_ROUTE, PASTE_POLICY_ROUTE, PastedImageBackend } from '../src/paste-images.ts'
import { SESSION_MEDIA_ROUTE } from '../src/session-media.ts'
import { MediaReferenceAuthority } from '../src/media-references.ts'
import { nativeMessages } from '../src/native-media.ts'
import { defaultSessionMedia, SessionMediaStore } from '../src/session-media.ts'
import { fetchRelayModels } from '../src/relay-models.ts'
import { installMediaRouting } from '../src/media-routing.ts'
import { EvidenceCache } from '../src/evidence-cache.ts'
import { convertImagesToEvidence } from '../src/image-input-variants.ts'
import type { VisionToolkitRuntime } from '../src/runtime.ts'

const roots: string[] = []
const servers: Server[] = []
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function workspace() { const root = await mkdtemp(join(tmpdir(), 'dvt-security-')); roots.push(root); return root }
async function listen(server: Server) { servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const addr = server.address(); if (addr === null || typeof addr === 'string') throw new Error('no listener'); return `http://127.0.0.1:${addr.port}` }

describe('review security boundary regressions', () => {
  it('delegates cookie and trust authentication to the Host before any administrative action', async () => {
    const calls = vi.fn()
    const ctx = { get: () => ({ requestRejection: (req: IncomingMessage) => req.headers.origin === 'https://foreign.example' ? 403 : req.headers.cookie === 'fixture-auth=valid' ? undefined : 401 }) } as unknown as Context
    const base = await listen(createServer(authenticatedWebHandler(ctx, (_req, res) => { calls(); res.end('authorized') })))
    expect((await fetch(base)).status).toBe(401)
    expect((await fetch(base, { method: 'POST' })).status).toBe(401)
    expect(calls).not.toHaveBeenCalled()
    // Desktop-forwarded requests need no Origin; authenticated cookie remains authoritative.
    expect((await fetch(base, { headers: { Cookie: 'fixture-auth=valid' } })).status).toBe(200)
    expect((await fetch(base, { headers: { Cookie: 'fixture-auth=valid', Origin: 'https://foreign.example' } })).status).toBe(403)
    expect(calls).toHaveBeenCalledOnce()
  })
  it('authenticates every installed administrative route before its implementation', async () => {
    const routes = new Map<string, (req: IncomingMessage, res: any) => unknown>()
    const actions = vi.fn((_req: unknown, res: any) => { res.end('action') })
    const policy = vi.fn(async () => ({ takeOver: false })); const display = vi.fn(() => ({ hidden: true }))
    const get = vi.fn(async () => ({ sessionId: 'a' })); const set = vi.fn(async () => ({ sessionId: 'a' }))
    const ctx = { get: () => ({ requestRejection: (req: IncomingMessage) => req.headers.cookie === 'fixture-auth=valid' ? undefined : 401 }), webServer: { host: '127.0.0.1', port: 19387, register: ({ path, handler }: { path: string; handler: any }) => { routes.set(path, handler); return () => {} } }, inject: (_: unknown, callback: any) => callback(ctx), effect: (callback: any) => callback() } as unknown as Context
    installVisionToolkitWeb(ctx, { configureWebServer: () => {}, handle: actions } as never, { attachRoute: () => () => {}, handle: actions } as never, { handle: actions } as never, policy as never, display, { get, set } as never)
    const base = await listen(createServer((req, res) => { const handler = routes.get(new URL(req.url!, 'http://fixture').pathname); if (!handler) { res.writeHead(404); res.end(); return } void handler(req, res) }))
    for (const route of [SETTINGS_ROUTE, PASTE_IMAGES_ROUTE, PASTE_POLICY_ROUTE, DISPLAY_CONFIG_ROUTE, `${SESSION_MEDIA_ROUTE}?sessionId=a`]) {
      for (const method of ['GET', 'POST']) expect((await fetch(base + route, { method })).status).toBe(401)
    }
    expect(actions).not.toHaveBeenCalled(); expect(policy).not.toHaveBeenCalled(); expect(display).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled()
    expect((await fetch(base + SETTINGS_ROUTE, { headers: { Cookie: 'fixture-auth=valid' } })).status).toBe(200)
    expect(actions).toHaveBeenCalledOnce()
  })
  it('fails closed without a supported Host auth API', async () => {
    const calls = vi.fn()
    const base = await listen(createServer(authenticatedWebHandler({ get: () => undefined } as unknown as Context, calls)))
    expect((await fetch(base)).status).toBe(503)
    expect(calls).not.toHaveBeenCalled()
  })
  it('requires a server signature, genuine user source, same session identity, and unchanged bytes for native projection', async () => {
    const cwd = await workspace(); const path = join(cwd, 'test.pdf'); await writeFile(path, '%PDF-1.4 fixture')
    const header = { createdAt: 1, cwd }
    const ctx = { sessions: { get: () => ({ header }) }, llm: { fileRequestText: () => '' } } as unknown as Context
    const authority = new MediaReferenceAuthority(Buffer.alloc(32, 7))
    const signed = await authority.issue(ctx, 'a', path, 16)
    const options: GenerateOptions = { provider: 'local-relay', model: 'gpt', sessionId: SessionId('a'), messages: [] }
    const config = resolveConfig({})
    const project = (text: string, source = 'user') => nativeMessages(ctx, { ...options, messages: [createUserMessage({ content: [{ type: 'text', text }], source: { kind: source } as never })] }, defaultSessionMedia(), config, 'responses', authority)
    expect(JSON.stringify(await project(`[Pasted document available at absolute path: ${JSON.stringify(path)}]`))).not.toContain('file_data')
    expect(JSON.stringify(await project(signed, 'skill-invocation'))).not.toContain('file_data')
    expect(JSON.stringify(await project(signed))).toContain('file_data')
    expect(authority.references(ctx, 'b', signed)).toEqual([])
    header.createdAt = 2
    expect(authority.references(ctx, 'a', signed)).toEqual([])
    header.createdAt = 1
    expect(authority.references(ctx, 'a', signed.replace('test.pdf', 'evil.pdf'))).toEqual([])
    await writeFile(path, '%PDF-1.4 changed')
    await expect(project(signed)).rejects.toThrow('changed since admission')
  })
  it('lets admitted images above the direct cap reach proxy preprocessing and does not reprocess projected evidence', async () => {
    const cwd = await workspace(); const path = join(cwd, 'large.png'); const bytes = Buffer.alloc(5 * 1024 * 1024, 7); await writeFile(path, bytes)
    const header = { createdAt: 1, cwd }; let listener: any
    const glance = vi.fn(async () => ({ answer: 'one compressed evidence description' }))
    const snapshot = { evidenceFingerprint: 'fixture', glance }
    const requests: GenerateOptions[] = []
    const ctx = { on: (_: string, callback: unknown) => { listener = callback; return () => {} }, sessions: { get: () => ({ header }) }, llm: { stream: (options: GenerateOptions) => { requests.push(options); return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } } })() } } } as unknown as Context
    const authority = new MediaReferenceAuthority(Buffer.alloc(32, 7)); const marker = await authority.issue(ctx, 'a', path, bytes.length)
    const store = new SessionMediaStore(ctx); const config = resolveConfig({ nativeProviders: ['local-relay'] })
    installMediaRouting(ctx, store, () => config, () => ({ captureEvidenceRuntime: async () => snapshot }) as unknown as VisionToolkitRuntime, new AbortController().signal, authority)
    const options: GenerateOptions = { provider: 'local-relay', model: 'plain', sessionId: SessionId('a'), messages: [createUserMessage({ content: [{ type: 'text', text: marker }], source: { kind: 'user' } })] }
    const next = vi.fn(async function* () { yield { type: 'finish', reason: { kind: 'stop' } } })
    for await (const _chunk of listener(options, next)) {}
    expect(glance).toHaveBeenCalledOnce(); expect(requests).toHaveLength(1)
    expect(JSON.stringify(requests[0])).toContain('compressed evidence description')
    expect(JSON.stringify(requests[0])).not.toContain('; reference:')
    for await (const _chunk of listener(requests[0], next)) {}
    expect(glance).toHaveBeenCalledOnce(); expect(next).toHaveBeenCalledOnce()
    for (const source of ['skill-invocation', 'user']) {
      options.messages = [createUserMessage({ content: [{ type: 'text', text: source === 'user' ? `[Pasted image available at absolute path: ${JSON.stringify(path)}]` : marker }], source: { kind: source } as never })]
      for await (const _chunk of listener(options, next)) {}
    }
    expect(glance).toHaveBeenCalledOnce()
  })
  it('does not make a second paid call for variant-generated image path evidence', async () => {
    const cwd = await workspace(); const header = { createdAt: 1, cwd }
    const glance = vi.fn(async () => ({ answer: 'authoritative variant evidence' }))
    const snapshot = { evidenceFingerprint: 'fixture', glance }
    const attachments = { readImage: async () => ({ ref: {}, data: Buffer.from([7, 8, 9]) }) }
    let listener: any
    const ctx = { get: (name: string) => name === 'attachments' ? attachments : undefined, sessions: { get: () => ({ header }) }, on: (_: string, callback: unknown) => { listener = callback; return () => {} }, llm: {} } as unknown as Context
    const messages = await convertImagesToEvidence(ctx, () => snapshot as never, new EvidenceCache(4), [createUserMessage({ content: [{ type: 'image', attachment: { attachmentId: 'fixture', mediaType: 'image/png' } as never }], source: { kind: 'user' } })], undefined, 'a')
    expect(glance).toHaveBeenCalledOnce(); expect(JSON.stringify(messages)).toContain('authoritative variant evidence')
    installMediaRouting(ctx, new SessionMediaStore(ctx), () => resolveConfig({ nativeProviders: ['local-relay'] }), () => ({ captureEvidenceRuntime: async () => snapshot }) as unknown as VisionToolkitRuntime, new AbortController().signal, new MediaReferenceAuthority(Buffer.alloc(32, 7)))
    const next = vi.fn(async function* () { yield { type: 'finish', reason: { kind: 'stop' } } })
    for await (const _chunk of listener({ provider: 'local-relay', model: 'plain', sessionId: SessionId('a'), messages }, next)) {}
    expect(glance).toHaveBeenCalledOnce(); expect(next).toHaveBeenCalledOnce()
  })
  it('retains opt-out when persistence binds late and after it detaches', async () => {
    let bind: (scope: unknown) => Promise<unknown> = () => Promise.resolve()
    let available = false
    const ctx = { sessions: { get: () => ({ header: { createdAt: 1 } }) }, get: () => available ? {} : undefined, inject: (_: unknown, callback: typeof bind) => { bind = callback; return Promise.resolve() }, logger: { warn: vi.fn() } } as unknown as Context
    const store = new SessionMediaStore(ctx)
    await store.set('a', 0, { ...defaultSessionMedia(), enabled: false })
    let state: { sessions: Record<string, unknown> } = { sessions: {} }
    available = true
    const dispose = await bind({ storageDomain: { open: async () => ({ global: { get: () => state, set: async (next: typeof state) => { state = next } }, close: vi.fn() }) } }) as () => Promise<void>
    expect(await store.get('a')).toMatchObject({ revision: 1, persistent: true, settings: { enabled: false } })
    await expect(store.assertInputs('a', ['test.pdf'])).rejects.toThrow('disabled')
    available = false; await dispose()
    expect(await store.get('a')).toMatchObject({ revision: 1, persistent: false, settings: { enabled: false } })
  })
  it('never follows real catalog redirects with provider or tenant credentials', async () => {
    const receiver = vi.fn((_req: IncomingMessage, res: any) => { res.end('{"data":[{"id":"unsafe"}]}') })
    const destination = await listen(createServer(receiver))
    const origin = await listen(createServer((_req, res) => { res.writeHead(302, { Location: destination + '/v1/models' }); res.end() }))
    for (const protocol of ['openai', 'anthropic'] as const) {
      const provider = resolveConfig({ provider: { baseUrl: origin + '/v1', protocol } }).provider
      await expect(fetchRelayModels(provider, 'fixture-key', { 'X-Tenant': 'fixture-tenant' })).rejects.toThrow('could not be fetched')
    }
    expect(receiver).not.toHaveBeenCalled()
  })
  it('issues upload authority that the actual native projection accepts', async () => {
    const cwd = await workspace(); const header = { createdAt: 1, cwd }
    const ctx = { sessions: { get: () => ({ header }) }, logger: { warn: vi.fn() }, llm: { fileRequestText: () => '' } } as unknown as Context
    const authority = new MediaReferenceAuthority(Buffer.alloc(32, 7))
    const backend = new PastedImageBackend(ctx, { maxUploadBytes: () => 1024, maxMediaUploadBytes: () => 1024 }, authority)
    const base = await listen(createServer((req, res) => { void backend.handle(req, res) }))
    const response = await fetch(`${base}${PASTE_IMAGES_ROUTE}?sessionId=a&name=test.pdf&size=16`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/pdf' }, body: '%PDF-1.4 fixture' })
    expect(response.status).toBe(201)
    const body = await response.json() as { value: { absolutePath: string; mediaReference: string } }
    expect(authority.references(ctx, 'a', body.value.mediaReference)[0]?.path).toBe(body.value.absolutePath)
    const projected = await nativeMessages(ctx, { provider: 'local-relay', model: 'gpt', sessionId: SessionId('a'), messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: body.value.mediaReference }] })] }, defaultSessionMedia(), resolveConfig({}), 'responses', authority)
    expect(JSON.stringify(projected)).toContain('file_data')
  })
  it('redacts reflected credentials before truncating catalog errors and network failures', async () => {
    const provider = resolveConfig({ provider: { baseUrl: 'https://relay.example/v1', credential: 'TEST' } }).provider
    vi.stubGlobal('fetch', vi.fn(async () => new Response('a'.repeat(190) + 'long-secret-key', { status: 500 })))
    const error = await fetchRelayModels(provider, 'long-secret-key').catch(error => error as Error)
    expect((error as Error).message).not.toContain('long-secre')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('long-secret-key') }))
    await expect(fetchRelayModels(provider, 'long-secret-key')).rejects.toThrow('<redacted>')
  })
  it('cancels chunked oversized catalogs without draining the complete body', async () => {
    let chunks = 0; const cancelled = vi.fn()
    const body = new ReadableStream({ pull(controller) { chunks++; controller.enqueue(new Uint8Array(1024 * 1024)); if (chunks === 20) controller.close() }, cancel: cancelled }, { highWaterMark: 0 })
    vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => { expect(init.redirect).toBe('error'); return new Response(body) }))
    await expect(fetchRelayModels(resolveConfig({}).provider, 'key')).rejects.toThrow('byte limit')
    expect(chunks).toBe(5); expect(cancelled).toHaveBeenCalledOnce()
  })
})
