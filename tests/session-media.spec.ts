import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionMediaStore, defaultSessionMedia } from '../src/session-media.ts'

function harness() {
  const sessions = new Map([['a', { header: { createdAt: 1 } }], ['b', { header: { createdAt: 2 } }]])
  const ctx = { sessions: { get: (id: string) => sessions.get(id) } } as unknown as Context
  return { store: new SessionMediaStore(ctx), sessions }
}
describe('Session media consent', () => {
  it('keeps settings isolated and checks revisions', async () => {
    const { store } = harness()
    const value = defaultSessionMedia()
    value.modalities.audio = false
    await store.set('a', 0, value)
    expect((await store.get('a')).settings.modalities.audio).toBe(false)
    expect((await store.get('b')).settings.modalities.audio).toBe(true)
    await expect(store.set('a', 0, value)).rejects.toThrow('settings changed')
    await expect(store.assertInputs('a', ['voice.wav'])).rejects.toThrow('disabled')
    await expect(store.assertInputs('a', ['movie.mp4'])).resolves.toBeUndefined()
  })
  it('fails closed on bad sessions and invalid payloads', async () => {
    const { store } = harness()
    await expect(store.get('missing')).rejects.toThrow('not found')
    await expect(store.set('a', 0, { ...defaultSessionMedia(), enabled: 'false' })).rejects.toThrow()
  })
  it('does not reuse consent for a recreated identity', async () => {
    const { store, sessions } = harness()
    await store.set('a', 0, { ...defaultSessionMedia(), enabled: false })
    sessions.set('a', { header: { createdAt: 3 } })
    expect((await store.get('a')).settings.enabled).toBe(true)
    expect((await store.get('a')).revision).toBe(0)
  })
  it('restores explicit session consent from its durable global domain', async () => {
    let state = { sessions: {} }
    const domain = { global: { get: () => state, set: async (next: typeof state) => { state = structuredClone(next) } }, close: async () => {} }
    const context = () => ({ sessions: { get: () => ({ header: { createdAt: 1 } }) }, get: () => ({}), inject: (_: unknown, callback: (scope: unknown) => Promise<unknown>) => callback({ storageDomain: { open: async () => domain } }), logger: { warn: () => {} } }) as unknown as Context
    const first = new SessionMediaStore(context())
    await first.set('a', 0, { ...defaultSessionMedia(), enabled: false })
    const restored = await new SessionMediaStore(context()).get('a')
    expect(restored.settings.enabled).toBe(false)
    expect(restored.revision).toBe(1)
    expect(restored.persistent).toBe(true)
  })
  it('never blocks memory consent waiting for an absent optional domain', async () => {
    const ctx = { sessions: { get: () => ({ header: { createdAt: 1 } }) }, get: () => undefined, inject: () => new Promise(() => {}) } as unknown as Context
    const store = new SessionMediaStore(ctx)
    expect((await store.get('a')).persistent).toBe(false)
    expect((await store.set('a', 0, { ...defaultSessionMedia(), enabled: false })).settings.enabled).toBe(false)
  })
  it('retains explicit opt-outs after more than 2000 session settings', async () => {
    const { store, sessions } = harness()
    await store.set('a', 0, { ...defaultSessionMedia(), enabled: false })
    for (let i = 0; i < 2001; i++) { const id = `s-${i}`; sessions.set(id, { header: { createdAt: i + 3 } }); await store.set(id, 0, defaultSessionMedia()) }
    expect((await store.get('a')).settings.enabled).toBe(false)
  })
  it('serializes competing writes so exactly one revision wins', async () => {
    const { store } = harness()
    const results = await Promise.allSettled([store.set('a', 0, defaultSessionMedia()), store.set('a', 0, defaultSessionMedia())])
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
  })
})
