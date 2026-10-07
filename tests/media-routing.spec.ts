import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, LlmRuntime, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { inject as pluginInject } from '../src/index.ts'
import { resolveConfig } from '../src/config.ts'
import { installMediaRouting } from '../src/media-routing.ts'
import { SessionMediaStore, defaultSessionMedia } from '../src/session-media.ts'
import type { VisionToolkitRuntime } from '../src/runtime.ts'

const CORDIS_CTX_API = new Set(['on', 'off', 'inject', 'get', 'logger', 'effect'])

/**
 * Cordis refuses `ctx.<service>` reads the plugin did not declare in its entry
 * `inject` export — with the literal runtime error this harness reproduces:
 * `cannot get property "llm" without inject`. Every service below must reach
 * the mock through the real declaration, exactly like the dsh host.
 */
function enforceInject(target: object): Context {
  return new Proxy(target, {
    get(value, prop: string | symbol) {
      if (typeof prop === 'string' && !CORDIS_CTX_API.has(prop) && !pluginInject.includes(prop)) {
        throw new Error(`cannot get property "${prop}" without inject`)
      }
      return Reflect.get(value, prop)
    },
  }) as unknown as Context
}

afterEach(() => { vi.unstubAllGlobals() })
function harness() {
  type Listener = (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => AsyncIterable<StreamChunk>
  let listener: Listener
  const next = vi.fn(async function* (): AsyncGenerator<StreamChunk> { yield { type: 'finish', reason: { kind: 'stop' } } })
  const captured = vi.fn(async () => { throw new Error('Missing vision credential') })
  const resolveModelInfo = vi.fn(async () => ({ inputModalities: ['text'] }))
  const downstream = vi.fn()
  const ctx = enforceInject({ credentials: { resolve: async () => ({ value: 'test-key' }) }, on: (_: string, callback: Listener) => { listener = callback; return () => {} }, sessions: { get: () => ({ header: { createdAt: 1, cwd: process.cwd() } }) }, llm: { resolveModelInfo, stream: (request: GenerateOptions) => { downstream(request); return (async function* () { yield* listener({ ...request }, next) })() } } })
  const store = new SessionMediaStore(ctx)
  const config = resolveConfig({ nativeProviders: ['local-relay'] })
  installMediaRouting(ctx, store, () => config, () => ({ captureEvidenceRuntime: captured }) as unknown as VisionToolkitRuntime, new AbortController().signal)
  const options: GenerateOptions = { provider: 'local-relay', model: 'plain', sessionId: SessionId('a'), messages: [createUserMessage({ content: [{ type: 'text', text: 'Hello' }], source: { kind: 'user' } })] }
  // Exercise the real Host waterfall seam: replacement wires bypass adapterStream.
  const host = Object.assign(Object.create(LlmRuntime.prototype), {
    ctx: { waterfall: (_runtime: unknown, _event: string, request: GenerateOptions) => listener(request, next) },
  }) as LlmRuntime
  const run = async () => { const chunks = []; for await (const chunk of host.stream(options)) chunks.push(chunk); return chunks }
  return { store, options, run, next, captured, resolveModelInfo, downstream }
}
describe('session media interception', () => {
  it('continues plain chat once without needing vision metadata or credentials', async () => {
    const h = harness()
    await h.run()
    expect(h.next).toHaveBeenCalledOnce()
    expect(h.downstream).not.toHaveBeenCalled()
    expect(h.captured).not.toHaveBeenCalled()
    expect(h.resolveModelInfo).not.toHaveBeenCalled()
  })
  it('rejects unrelated native routes before credential or network access', async () => {
    const h = harness()
    await h.store.set('a', 0, { ...defaultSessionMedia(), mode: 'direct' })
    h.options.provider = 'private-provider'
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    expect((await h.run()).at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'NATIVE_MEDIA_CONFIG', message: expect.stringContaining('not authorized') } } })
    expect(fetch).not.toHaveBeenCalled()
    expect(h.captured).not.toHaveBeenCalled()
  })
  it('finishes rejected native requests through the Host protocol and permits the next session turn', async () => {
    const h = harness()
    await h.store.set('a', 0, { ...defaultSessionMedia(), imageGeneration: true })
    h.options.model = 'gpt-6.1-sol'
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('must not expose test-key', { status: 400 }))
      .mockResolvedValueOnce(Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Recovered' }] }] }))
    vi.stubGlobal('fetch', fetch)
    const failed = await h.run()
    expect(failed.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'NATIVE_MEDIA_BAD_REQUEST', status: 400, message: expect.stringContaining('HTTP 400') } } })
    expect(JSON.stringify(failed)).not.toContain('test-key')
    expect(fetch).toHaveBeenCalledOnce()
    expect((await h.run()).at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    expect(h.next).not.toHaveBeenCalled()
  })
  it('preserves actionable relay failure categories without reflecting secret error text or retrying', async () => {
    const h = harness()
    await h.store.set('a', 0, { ...defaultSessionMedia(), imageGeneration: true })
    h.options.model = 'gpt-6.1-sol'
    const cases = [
      { code: 'context_length_exceeded', expected: 'CONTEXT_WINDOW_EXCEEDED', reason: 'context window' },
      { code: 'insufficient_quota', expected: 'QUOTA', reason: 'quota' },
      { code: 'rate_limit_exceeded', expected: 'NATIVE_MEDIA_RATE_LIMIT', reason: 'rate limit' },
      { code: 'server_error', expected: 'NATIVE_MEDIA_SERVER', reason: 'upstream server' },
      { code: 'timeout', expected: 'NATIVE_MEDIA_RELAY_TIMEOUT', reason: 'relay/upstream timed out' },
      { code: 'unsupported_parameter', expected: 'NATIVE_MEDIA_BAD_REQUEST', reason: 'reasoning.effort' },
      { code: 'test-key-unknown', expected: 'NATIVE_MEDIA_PROVIDER_ERROR', reason: 'unspecified' },
    ]
    for (const { code, expected, reason } of cases) {
      const fetch = vi.fn(async () => new Response(`data: ${JSON.stringify({ type: 'response.failed', response: { error: { code, param: 'reasoning.effort', message: 'must not expose test-key or https://private.invalid' } } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }))
      vi.stubGlobal('fetch', fetch)
      const chunks = await h.run()
      expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: expected, message: expect.stringContaining(reason) } } })
      expect(JSON.stringify(chunks)).not.toMatch(/test-key|private\.invalid/u)
      expect(fetch).toHaveBeenCalledOnce()
      expect(h.next).not.toHaveBeenCalled()
    }
  })
  it('keeps HTTP status and classifies bounded relay errors instead of discarding the body', async () => {
    const h = harness()
    await h.store.set('a', 0, { ...defaultSessionMedia(), imageGeneration: true })
    h.options.model = 'gpt-6.1-sol'
    for (const [status, code] of [[401, 'NATIVE_MEDIA_AUTH'], [429, 'NATIVE_MEDIA_RATE_LIMIT'], [504, 'NATIVE_MEDIA_RELAY_TIMEOUT'], [503, 'NATIVE_MEDIA_SERVER']] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('test-key', { status })))
      expect((await h.run()).at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code, status, message: expect.stringContaining(`HTTP ${status}`) } } })
    }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'context_length_exceeded', message: 'test-key' } }, { status: 400 })))
    expect((await h.run()).at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'CONTEXT_WINDOW_EXCEEDED', status: 400 } } })
  })
  it('distinguishes an upstream Host timeout from a user cancellation before native dispatch', async () => {
    const h = harness()
    await h.store.set('a', 0, { ...defaultSessionMedia(), imageGeneration: true })
    h.options.model = 'gpt-6.1-sol'
    const caller = new AbortController()
    caller.abort(new DOMException('secret reason', 'TimeoutError'))
    h.options.signal = caller.signal
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const chunks = await h.run()
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'NATIVE_MEDIA_HOST_TIMEOUT', message: expect.stringContaining('Host request deadline') } } })
    expect(JSON.stringify(chunks)).not.toContain('secret reason')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('preserves the native idle-timeout category at the Host boundary without a second request', async () => {
    const h = harness()
    await h.store.set('a', 0, { ...defaultSessionMedia(), imageGeneration: true })
    h.options.model = 'gpt-6.1-sol'
    vi.useFakeTimers()
    const fetch = vi.fn(async (_url, request: RequestInit) => new Response(new ReadableStream({ start(controller) {
      const signal = request.signal as AbortSignal
      signal.addEventListener('abort', () => controller.error(signal.reason), { once: true })
    } }), { headers: { 'Content-Type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetch)
    try {
      const request = h.run()
      await vi.advanceTimersByTimeAsync(300_001)
      expect((await request).at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'NATIVE_MEDIA_TIMEOUT', message: expect.stringContaining('no progress for 300s') } } })
      expect(vi.getTimerCount()).toBe(0)
      expect(fetch).toHaveBeenCalledOnce()
    } finally { vi.useRealTimers() }
  })
  it('does not silently stop on an empty native completion or automatically repeat a paid request', async () => {
    const h = harness()
    await h.store.set('a', 0, { ...defaultSessionMedia(), imageGeneration: true })
    h.options.model = 'gpt-6.1-sol'
    const fetch = vi.fn(async () => Response.json({ status: 'completed', output: [] }))
    vi.stubGlobal('fetch', fetch)
    const chunks = await h.run()
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'NATIVE_MEDIA_EMPTY_RESPONSE' } } })
    expect(fetch).toHaveBeenCalledOnce()
    expect(h.next).not.toHaveBeenCalled()
  })
  it('returns caller cancellation as aborted, not an uncaught middleware error', async () => {
    const h = harness()
    await h.store.set('a', 0, { ...defaultSessionMedia(), imageGeneration: true })
    h.options.model = 'gpt-6.1-sol'
    const caller = new AbortController()
    h.options.signal = caller.signal
    vi.stubGlobal('fetch', vi.fn(async (_url, request: RequestInit) => new Response(new ReadableStream({ start(controller) {
      const signal = request.signal as AbortSignal
      signal.addEventListener('abort', () => controller.error(signal.reason), { once: true })
      caller.abort(new Error('secret in arbitrary caller reason'))
    } }), { headers: { 'Content-Type': 'text/event-stream' } })))
    expect((await h.run()).at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED' } } })
  })
  it('withholds nested tool images and survives cloning redispatch middleware', async () => {
    const h = harness()
    await h.store.set('a', 0, { ...defaultSessionMedia(), enabled: false })
    h.options.messages = [createUserMessage({ content: [{ type: 'tool-result', toolCallId: 'call' as never, isError: false, content: [{ type: 'image', attachment: { attachmentId: 'img', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } }] }], source: { kind: 'user' } })]
    const original = JSON.stringify(h.options)
    await h.run()
    expect(h.downstream).toHaveBeenCalledOnce()
    expect(h.next).toHaveBeenCalledOnce()
    expect(JSON.stringify(h.downstream.mock.calls[0]?.[0])).not.toContain('"type":"image"')
    expect(JSON.stringify(h.options)).toBe(original)
    expect(h.captured).not.toHaveBeenCalled()
  })
  it('does not initiate paid image evidence for auxiliary requests', async () => {
    const h = harness()
    h.options.purpose = 'compaction'
    h.options.messages = [createUserMessage({ content: [{ type: 'image', attachment: { attachmentId: 'img', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } }], source: { kind: 'user' } })]
    await h.run()
    expect(h.captured).not.toHaveBeenCalled()
    expect(h.resolveModelInfo).not.toHaveBeenCalled()
    expect(h.downstream).toHaveBeenCalledOnce()
  })
})
