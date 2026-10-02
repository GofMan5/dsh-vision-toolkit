import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { fetchRelayModels, parseRelayModelIds } from '../src/relay-models.ts'

const provider = resolveConfig({
  provider: { baseUrl: 'https://relay.example/v1', credential: 'RELAY_KEY', model: 'qwen3.8-max-0902' },
}).provider

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('parseRelayModelIds', () => {
  it('parses the OpenAI-compatible data shape', () => {
    expect(parseRelayModelIds({ data: [{ id: 'qwen3.8-max-0902' }, { id: 'glm-5.3' }] }))
      .toEqual(['glm-5.3', 'qwen3.8-max-0902'])
  })

  it('parses a bare array of ids or objects', () => {
    expect(parseRelayModelIds(['b-model', { id: 'a-model' }])).toEqual(['a-model', 'b-model'])
  })

  it('trims, dedupes case-identical ids, and drops blanks', () => {
    expect(parseRelayModelIds({ data: [{ id: ' qwen-max ' }, { id: 'qwen-max' }, { id: '' }, { id: 'glm' }] }))
      .toEqual(['glm', 'qwen-max'])
  })

  it('sorts case-insensitively', () => {
    expect(parseRelayModelIds({ data: [{ id: 'Zebra' }, { id: 'apple' }] })).toEqual(['apple', 'Zebra'])
  })

  it('caps the catalog at 500 models', () => {
    const rows = Array.from({ length: 600 }, (_, index) => ({ id: `model-${index}` }))
    expect(parseRelayModelIds({ data: rows })).toHaveLength(500)
  })

  it('returns nothing for unrelated payloads', () => {
    expect(parseRelayModelIds({ object: 'list' })).toEqual([])
    expect(parseRelayModelIds('nope' as unknown)).toEqual([])
  })
})

function stubFetch(handler: (input: string, init?: RequestInit) => { status: number; body: string }): void {
  globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const answer = handler(url, init)
    return new Response(answer.body, { status: answer.status, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
}

describe('fetchRelayModels', () => {
  it('sends bearer auth and returns detected capabilities per model', async () => {
    let seenAuth = ''
    let seenUrl = ''
    stubFetch((url, init) => {
      seenUrl = url
      seenAuth = String((init?.headers as Record<string, string>).Authorization)
      return { status: 200, body: JSON.stringify({ data: [{ id: 'qwen3.8-max-0902' }, { id: 'glm-5.3' }] }) }
    })
    const catalog = await fetchRelayModels(provider, 'secret-key')
    expect(seenUrl).toBe('https://relay.example/v1/models')
    expect(seenAuth).toBe('Bearer secret-key')
    expect(catalog.models).toHaveLength(2)
    expect(catalog.models.find(entry => entry.id === 'qwen3.8-max-0902')?.capabilities)
      .toEqual({ image: true, video: true, audio: true, document: true })
    expect(catalog.models.find(entry => entry.id === 'glm-5.3')?.capabilities)
      .toEqual({ image: false, video: false, audio: false, document: false })
  })

  it('uses anthropic headers for the anthropic protocol', async () => {
    let seenHeaders: Record<string, string> = {}
    stubFetch((url, init) => {
      seenHeaders = init?.headers as Record<string, string>
      return { status: 200, body: JSON.stringify({ data: [{ id: 'claude-sonnet-5' }] }) }
    })
    const anthropic = resolveConfig({
      provider: { baseUrl: 'https://relay.example', credential: 'RELAY_KEY', model: 'claude-sonnet-5', protocol: 'anthropic' },
    }).provider
    await fetchRelayModels(anthropic, 'anthropic-key')
    expect(seenHeaders['x-api-key']).toBe('anthropic-key')
    expect(seenHeaders['anthropic-version']).toBe('2023-06-01')
    expect(seenHeaders.Authorization).toBeUndefined()
  })

  it('surfaces a 401 as a credential rejection', async () => {
    stubFetch(() => ({ status: 401, body: JSON.stringify({ error: 'unauthorized' }) }))
    await expect(fetchRelayModels(provider, 'bad-key')).rejects.toThrow(/rejected the configured credential/)
  })

  it('explains a missing /models endpoint', async () => {
    stubFetch(() => ({ status: 404, body: 'not found' }))
    await expect(fetchRelayModels(provider, 'key')).rejects.toThrow(/type the model id manually/)
  })

  it('rejects invalid JSON bodies', async () => {
    stubFetch(() => ({ status: 200, body: '<html>not json</html>' }))
    await expect(fetchRelayModels(provider, 'key')).rejects.toThrow(/not valid JSON/)
  })

  it('rejects catalogs without readable ids', async () => {
    stubFetch(() => ({ status: 200, body: JSON.stringify({ data: [] }) }))
    await expect(fetchRelayModels(provider, 'key')).rejects.toThrow(/no readable model ids/)
  })

  it('wraps network failures with the endpoint URL', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch
    await expect(fetchRelayModels(provider, 'key')).rejects.toThrow(/relay.example\/v1\/models/)
  })
})
