import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { prepareWatchedSettingsGeneration, resolveConfig } from '../src/config.ts'
import { StorageHistoryStore } from '../src/storage-history.ts'
import type { VisionToolkitRuntime } from '../src/runtime.ts'
import { bindVisionSettings } from '../src/settings-compat.ts'

const startup = vi.hoisted(() => ({ gate: Promise.resolve(), keyGate: Promise.resolve(), models: [] as string[] }))
vi.mock('../src/artifact-access.ts', async original => ({ ...await original<typeof import('../src/artifact-access.ts')>(), prepareArtifactAccessKey: async () => { await startup.keyGate; return Buffer.alloc(32, 7) } }))
vi.mock('../src/runtime-manager.ts', async original => {
  const actual = await original<typeof import('../src/runtime-manager.ts')>()
  return { ...actual, VisionToolkitRuntimeManager: class extends actual.VisionToolkitRuntimeManager {
    constructor(ctx: Context) { super(ctx, async (_ctx, config) => { startup.models.push(config.provider.model); if (startup.models.length === 1) await startup.gate; return { upstreamVersion: { version: 'fixture', commit: 'fixture', path: 'fixture' } } as VisionToolkitRuntime }) }
  } }
})
vi.mock('../src/exposure.ts', () => ({ VisionToolExposure: class { activationTool = {}; install() { return () => {} } } }))
vi.mock('../src/image-input-variants.ts', () => ({ createPasteTakeoverResolver: () => async () => ({ takeOver: false }), installImageInputVariants: () => ({ dispose: () => {}, reconcile: () => {} }) }))
vi.mock('../src/web.ts', () => ({ VisionToolkitWebBackend: class {}, installVisionToolkitWeb: () => {} }))
import { apply } from '../src/index.ts'

function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes }); return { promise, resolve } }
function startupContext() {
  let value = { provider: { model: 'first' } }
  let listener: (next: typeof value, previous: typeof value) => void | Promise<void> = () => {}
  const binding = { get: () => value, update: async () => {}, watch: (callback: typeof listener) => { listener = callback; return () => {} } }
  const ctx = { settings: { register: () => binding, writable: false }, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, get: () => undefined, on: () => () => {}, sessions: { get: () => undefined }, tools: { register: () => () => {} }, skills: { register: () => () => {} } } as unknown as Context
  return { ctx, update: (model: string) => { const previous = value; value = { provider: { model } }; return listener(value, previous) } }
}

describe('review Settings lifecycle regressions', () => {
  it('catches changes while the initial runtime is preparing', async () => {
    startup.models = []; startup.keyGate = Promise.resolve(); const gate = deferred(); startup.gate = gate.promise
    const h = startupContext(); const applying = apply(h.ctx)
    await vi.waitFor(() => expect(startup.models).toEqual(['first']))
    await h.update('second'); gate.resolve()
    const dispose = await applying
    expect(startup.models).toEqual(['first', 'second']); dispose()
  })
  it('subscribes before even the artifact key startup await', async () => {
    startup.models = []; startup.gate = Promise.resolve(); const gate = deferred(); startup.keyGate = gate.promise
    const h = startupContext(); const applying = apply(h.ctx)
    await h.update('second'); gate.resolve()
    const dispose = await applying
    expect(startup.models).toEqual(['second']); dispose(); startup.keyGate = Promise.resolve()
  })
  it('accepts a valid repair after an invalid projected generation', async () => {
    let event: (ns: string) => void = () => {}; let value = { timeoutMs: 30000 }
    const ctx = { settings: { describe: () => [{ ns: 'vision-toolkit', value }], update: async () => {} }, on: (_: string, callback: typeof event) => { event = callback; return () => {} } } as unknown as Context
    const binding = bindVisionSettings(ctx, value)
    let accepted = 30000; const completed: Promise<void>[] = []
    binding.watch((next, previous) => {
      const task = prepareWatchedSettingsGeneration(next, previous, false, async () => {}).then(prepared => { accepted = resolveConfig(prepared.config!).timeoutMs }).catch(() => {})
      completed.push(task); return task
    })
    value = { timeoutMs: 500 }; event('vision-toolkit'); await Promise.all(completed); expect(accepted).toBe(30000)
    value = { timeoutMs: 45000 }; event('vision-toolkit'); await Promise.all(completed); expect(accepted).toBe(45000)
  })
  it('merges roots persisted before a late domain binding and notifies reconciliation', async () => {
    let bind: (ctx: unknown) => Promise<unknown> = () => Promise.resolve(); let available = false
    const ctx = { get: () => available ? {} : undefined, logger: { warn: vi.fn() }, inject: (_: unknown, callback: typeof bind) => { bind = callback; return Promise.resolve() } } as unknown as Context
    const notify = vi.fn(); const store = new StorageHistoryStore(ctx, notify)
    expect(await store.persist({ storageDir: '/new' })).toBe(false)
    let state = { roots: ['/old'] }
    available = true
    await bind({ storageDomain: { open: async () => ({ global: { get: () => state, set: async (next: typeof state) => { state = next } }, close: async () => {} }) } })
    expect(state.roots).toEqual(['/old', '/new']); expect(notify).toHaveBeenCalledOnce()
    expect((await store.restore({ storageDir: '/new' })).storageHistory).toEqual(['/old'])
    await store.persist({ storageDir: '/latest' }); expect(state.roots).toEqual(['/old', '/new', '/latest'])
    const { VisionToolkitRuntimeManager: RealManager } = await vi.importActual<typeof import('../src/runtime-manager.ts')>('../src/runtime-manager.ts')
    const seen: string[][] = []
    const factory = vi.fn(async (_ctx: Context, _config: unknown, readable: readonly string[]) => { seen.push([...readable]); return { upstreamVersion: { version: 'fixture', commit: 'fixture', path: 'fixture' } } as VisionToolkitRuntime })
    const manager = new RealManager({ logger: { info: vi.fn() } } as unknown as Context, factory)
    await manager.initialize({ provider: { model: 'first' } })
    await manager.reconfigure(await store.restore(manager.currentConfig()))
    expect(factory).toHaveBeenCalledTimes(2)
    expect(seen[1]).toEqual(['/old', '/new', '/latest'])
  })
  it('same-fingerprint activation invalidates a pending different generation', async () => {
    // Use the real class, not the startup mock constructor.
    const { VisionToolkitRuntimeManager: RealManager } = await vi.importActual<typeof import('../src/runtime-manager.ts')>('../src/runtime-manager.ts')
    const gate = deferred()
    const ctx = { logger: { info: vi.fn() } } as unknown as Context
    const manager = new RealManager(ctx, async (_ctx, config) => { if (config.provider.model === 'slow') await gate.promise; return { upstreamVersion: { version: 'fixture', commit: 'fixture', path: 'fixture' } } as VisionToolkitRuntime })
    await manager.initialize({ provider: { model: 'first' } })
    const pending = manager.reconfigure({ provider: { model: 'slow' } })
    const latest = await manager.prepareCandidate({ provider: { model: 'first' }, imageInputVariants: { hidden: false } })
    manager.activateCandidate(latest); gate.resolve(); expect(await pending).toBe(false)
    expect(manager.currentConfig().imageInputVariants.hidden).toBe(false)
    expect(manager.currentConfig().provider.model).toBe('first')
  })
})
