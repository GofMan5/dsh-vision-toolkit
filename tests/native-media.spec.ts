import { readFile, mkdtemp, rm, open, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, createUserMessage, createToolResultMessage, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { resolveConfig } from '../src/config.ts'
import { mediaPart, relayEvents } from '../src/media-wire.ts'
import { nativeMessages, pastedMediaReferences, saveGeneratedImage, streamNativeMedia } from '../src/native-media.ts'
import { describeArtifact } from '../src/artifacts.ts'
import { defaultSessionMedia } from '../src/session-media.ts'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: vi.fn(actual.open) }
})
vi.mock('../src/artifacts.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/artifacts.ts')>()
  return { ...actual, describeArtifact: vi.fn(actual.describeArtifact) }
})

const config = resolveConfig({ provider: { baseUrl: 'http://localhost:8798/v1', credential: 'TEST_KEY' }, nativeProviders: ['local-relay'] })
const directories: string[] = []
afterEach(async () => { vi.unstubAllGlobals(); vi.clearAllMocks(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function harness() {
  const workspace = await mkdtemp(join(tmpdir(), 'dvt-native-'))
  directories.push(workspace)
  const data = await readFile(new URL('./fixtures/sample.png', import.meta.url))
  const ref = { attachmentId: 'image', mediaType: 'image/png', name: 'sample.png' }
  const ctx = { sessions: { get: () => ({ header: { cwd: workspace } }) }, credentials: { resolve: async () => ({ value: 'test-key' }) }, attachments: { readImage: vi.fn(async () => ({ ref, data })), saveImage: vi.fn(async () => ref) }, llm: { fileRequestText: () => '[Host file handle]' } } as unknown as Context
  const options: GenerateOptions = { provider: 'local-relay', model: 'gpt-6.1-sol', sessionId: SessionId('s'), messages: [createUserMessage({ content: [{ type: 'text', text: 'Hello' }], source: { kind: 'user' } })] }
  return { ctx, options, ref, data }
}
async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> { const chunks: StreamChunk[] = []; for await (const chunk of stream) chunks.push(chunk); return chunks }
function sse(events: unknown[]): Response { return new Response(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } }) }

describe('native relay media', () => {
  it('uses real Responses media parts and rejects invented audio/video formats', () => {
    const file = { kind: 'document' as const, mediaType: 'application/pdf', filename: 'a.pdf', data: Buffer.from('pdf') }
    expect(mediaPart(file, 'responses')).toEqual({ type: 'input_file', file_data: 'data:application/pdf;base64,cGRm', filename: 'a.pdf' })
    expect(() => mediaPart({ ...file, kind: 'audio' }, 'responses')).toThrow('does not define')
    expect(pastedMediaReferences('ordinary C:\\a.png')).toEqual([])
  })
  it('keeps a progressing native stream alive beyond the visual-service timeout', async () => {
    const { ctx, options } = await harness()
    vi.useFakeTimers()
    // Native AbortSignal.timeout uses real time; shim it so the old wall-clock
    // deadline fails deterministically instead of producing a false green.
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(new DOMException('deadline', 'TimeoutError')), ms)
      return controller.signal
    })
    let push!: ReadableStreamDefaultController<Uint8Array>
    let signal!: AbortSignal
    vi.stubGlobal('fetch', vi.fn(async (_url, request: RequestInit) => {
      signal = request.signal as AbortSignal
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        push = controller
        signal.addEventListener('abort', () => controller.error(signal.reason), { once: true })
      } }), { headers: { 'Content-Type': 'text/event-stream' } })
    }))
    const request = collect(streamNativeMedia(ctx, options, defaultSessionMedia(), config, new AbortController().signal)).then(chunks => ({ chunks }), error => ({ error }))
    try {
      await vi.advanceTimersByTimeAsync(0)
      for (let index = 0; index < 10; index++) {
        await vi.advanceTimersByTimeAsync(20_000)
        push.enqueue(Buffer.from('data: {"type":"response.output_text.delta","item_id":"answer","delta":"a"}\n\n'))
        await vi.advanceTimersByTimeAsync(0)
        expect(signal.aborted).toBe(false)
      }
      push.enqueue(Buffer.from('data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n'))
      expect(await request).toMatchObject({ chunks: expect.arrayContaining([{ type: 'finish', reason: { kind: 'stop' } }]) })
      expect(vi.getTimerCount()).toBe(0)
    } finally { timeout.mockRestore(); vi.useRealTimers() }
  })
  it('allows quiet native generation, but still aborts stalled streams and clears timers', async () => {
    const { ctx, options } = await harness()
    for (const imageGeneration of [false, true]) {
      vi.useFakeTimers()
      const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
        const controller = new AbortController()
        setTimeout(() => controller.abort(new DOMException('deadline', 'TimeoutError')), ms)
        return controller.signal
      })
      let signal!: AbortSignal
      const cancel = vi.fn()
      vi.stubGlobal('fetch', vi.fn(async (_url, request: RequestInit) => {
        signal = request.signal as AbortSignal
        return new Response(new ReadableStream({ start(controller) {
          signal.addEventListener('abort', () => controller.error(signal.reason), { once: true })
        }, cancel }), { headers: { 'Content-Type': 'text/event-stream' } })
      }))
      const request = collect(streamNativeMedia(ctx, options, { ...defaultSessionMedia(), imageGeneration }, config, new AbortController().signal)).then(chunks => ({ chunks }), error => ({ error }))
      try {
        await vi.advanceTimersByTimeAsync(0)
        if (imageGeneration) {
          await vi.advanceTimersByTimeAsync(120_000)
          expect(signal.aborted).toBe(false)
        }
        await vi.advanceTimersByTimeAsync(300_000)
        expect(await request).toMatchObject({ error: { code: 'NATIVE_MEDIA_TIMEOUT' } })
        expect(signal.aborted).toBe(true)
        expect(vi.getTimerCount()).toBe(0)
        expect(ctx.attachments.saveImage).not.toHaveBeenCalled()
      } finally { timeout.mockRestore(); vi.useRealTimers() }
    }
  })
  it('preserves caller cancellation and cleans a suspended native iterator without a retry', async () => {
    const { ctx, options } = await harness()
    for (const abort of [true, false]) {
      const caller = new AbortController()
      const reason = new Error('user stopped this request')
      const cancel = vi.fn()
      const fetch = vi.fn(async (_url, request: RequestInit) => new Response(new ReadableStream({ start(controller) {
        const signal = request.signal as AbortSignal
        signal.addEventListener('abort', () => controller.error(signal.reason), { once: true })
        controller.enqueue(Buffer.from('data: {"type":"response.output_text.delta","item_id":"answer","delta":"a"}\n\n'))
      }, cancel }), { headers: { 'Content-Type': 'text/event-stream' } }))
      vi.stubGlobal('fetch', fetch)
      vi.useFakeTimers()
      try {
        const iterator = streamNativeMedia(ctx, { ...options, signal: caller.signal }, { ...defaultSessionMedia(), imageGeneration: true }, config, new AbortController().signal)
        await iterator.next()
        if (abort) {
          caller.abort(reason)
          await expect(collect(iterator)).rejects.toBe(reason)
        } else await iterator.return()
        if (!abort) expect(cancel).toHaveBeenCalledOnce()
        expect(vi.getTimerCount()).toBe(0)
        expect(fetch).toHaveBeenCalledOnce()
      } finally { vi.useRealTimers() }
    }
  })
  it('decodes UTF8 SSE across single-byte boundaries and enforces byte limits', async () => {
    const bytes = Buffer.from('data: {"text":"Привет"}\r\ndata: \r\n\r\ndata: [DONE]\r\n\r\n')
    const response = new Response(new ReadableStream({ start(controller) { for (const value of bytes) controller.enqueue(Uint8Array.of(value)); controller.close() } }), { headers: { 'Content-Type': 'text/event-stream' } })
    const values = []; for await (const event of relayEvents(response)) values.push(event)
    expect(values).toEqual([{ text: 'Привет' }])
    await expect(collect(relayEvents(sse([{ text: 'too big' }]), 4) as never)).rejects.toThrow('byte limit')
  })
  it('ends the event iterator at DONE even if the relay keeps its connection open', async () => {
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('data: {"value":1}\n\ndata: [DONE]\n\n')) }, cancel }), { headers: { 'Content-Type': 'text/event-stream' } })
    const events = relayEvents(response)
    expect(await events.next()).toEqual({ done: false, value: { value: 1 } })
    expect(await events.next()).toEqual({ done: true, value: undefined })
    expect(cancel).toHaveBeenCalledOnce()
  }, 1000)
  it('finishes a terminal Responses result without waiting for transport EOF', async () => {
    const { ctx, options } = await harness()
    const cancel = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(Buffer.from(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', id: 'answer', content: [{ type: 'output_text', text: 'Done' }] }] } })}\n\n`))
    }, cancel }), { headers: { 'Content-Type': 'text/event-stream' } })))
    const chunks = await collect(streamNativeMedia(ctx, options, defaultSessionMedia(), config, new AbortController().signal))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    expect(cancel).toHaveBeenCalledOnce()
  }, 1000)
  it('decodes CR, LF and CRLF event boundaries even when CRLF is split across chunks', async () => {
    for (const ending of ['\r', '\n', '\r\n']) {
      const bytes = Buffer.from(`data: {"value":1}${ending}${ending}data: {"value":2}${ending}${ending}`)
      const response = new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close() } }), { headers: { 'Content-Type': 'text/event-stream' } })
      const values = []; for await (const event of relayEvents(response)) values.push(event)
      expect(values).toEqual([{ value: 1 }, { value: 2 }])
    }
  })
  it('preserves text/call order and tool images; opt-out performs no reads', async () => {
    const { ctx, options, ref } = await harness()
    const callId = ToolCallId('call')
    options.messages = [createAssistantMessage({ content: [{ type: 'text', text: 'Before call' }, { type: 'tool-call', id: callId, name: 'read_image', arguments: '{}' }], source: { provider: 'local-relay', model: 'gpt-6.1-sol' } }), createToolResultMessage({ callId, content: [{ type: 'image', attachment: ref as never }], isError: false })]
    const messages = await nativeMessages(ctx, options, defaultSessionMedia(), config, 'responses')
    expect(messages[0]).toMatchObject({ role: 'assistant', content: [{ type: 'output_text', text: 'Before call' }] })
    expect(messages[1]).toMatchObject({ type: 'function_call' })
    expect(messages[3]).toMatchObject({ role: 'user', content: [{ type: 'input_text' }, { type: 'input_image' }] })
    expect(ctx.attachments.readImage).toHaveBeenCalledOnce()
    vi.mocked(ctx.attachments.readImage).mockClear()
    await nativeMessages(ctx, options, { ...defaultSessionMedia(), enabled: false }, config, 'responses')
    expect(ctx.attachments.readImage).not.toHaveBeenCalled()
  })
  it('serializes DSH 0.2 role-tool result messages into protocol-native items', async () => {
    const { ctx, options, ref } = await harness()
    const callId = ToolCallId('call')
    // DSH 0.2 hosts deliver tool results as role:'tool' messages carrying the
    // raw result blocks; 0.1.5 wrapped them in a tool-result block. The direct
    // wire must serialize the message shape, not echo its role.
    const toolMessage = {
      role: 'tool',
      toolCallId: callId,
      isError: false,
      source: { kind: 'tool', callId },
      content: [{ type: 'text', text: 'file contents here' }, { type: 'image', attachment: ref }],
    } as never
    options.messages = [
      createAssistantMessage({ content: [{ type: 'text', text: 'Before call' }, { type: 'tool-call', id: callId, name: 'read_image', arguments: '{}' }], source: { provider: 'local-relay', model: 'gpt-6.1-sol' } }),
      toolMessage,
    ]
    const responses = await nativeMessages(ctx, options, defaultSessionMedia(), config, 'responses')
    expect(responses.some(item => item.role === 'tool')).toBe(false)
    expect(responses[2]).toMatchObject({ type: 'function_call_output', call_id: 'call', output: 'file contents here\n[Tool image follows]' })
    expect(responses[3]).toMatchObject({ role: 'user', content: [{ type: 'input_text' }, { type: 'input_image' }] })
    const chat = await nativeMessages(ctx, options, defaultSessionMedia(), config, 'openai')
    expect(chat[1]).toMatchObject({ role: 'tool', tool_call_id: 'call', content: 'file contents here\n[Tool image follows]' })
    expect(ctx.attachments.readImage).toHaveBeenCalledTimes(2)
  })
  it('rejects malformed tool history before reading images or sending a request', async () => {
    const { ctx, options, ref } = await harness()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    for (const toolCallId of [undefined, 42, '', ' ']) {
      options.messages = [{ role: 'tool', toolCallId, content: [{ type: 'image', attachment: ref }] } as never]
      for (const directProtocol of ['responses', 'openai'] as const) {
        await expect(collect(streamNativeMedia(ctx, options, { ...defaultSessionMedia(), directProtocol }, config, new AbortController().signal))).rejects.toThrow('Tool result is missing a valid toolCallId')
      }
    }
    expect(ctx.attachments.readImage).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('reads admitted PDF bytes via the host service and withholds disabled documents', async () => {
    const { ctx, options } = await harness()
    const read = vi.fn(async function* () { yield Buffer.from('pdf') })
    ctx.attachments.readFileStream = read
    options.messages = [createUserMessage({ content: [{ type: 'file', attachment: { attachmentId: 'file' as never, name: 'a.pdf', bytes: 3 } }], source: { kind: 'user' } })]
    expect(await nativeMessages(ctx, options, defaultSessionMedia(), config, 'responses')).toMatchObject([{ content: [{ type: 'input_file', filename: 'a.pdf' }] }])
    read.mockClear()
    await nativeMessages(ctx, options, { ...defaultSessionMedia(), enabled: false }, config, 'responses')
    expect(read).not.toHaveBeenCalled()
  })
  it('never sends role-tool history in a Responses request body', async () => {
    const { ctx, options } = await harness()
    options.messages = []
    for (let index = 0; index < 3; index++) {
      const callId = ToolCallId(`call_${index}`)
      options.messages.push(
        createUserMessage({ content: [{ type: 'text', text: 'Read the next file' }], source: { kind: 'user' } }),
        createAssistantMessage({ content: [{ type: 'tool-call', id: callId, name: 'read', arguments: '{}' }], source: { provider: 'local-relay', model: 'gpt-6.1-sol' } }),
        { role: 'tool', toolCallId: callId, isError: false, content: [{ type: 'text', text: `file ${index}` }] } as never,
      )
    }
    const fetch = vi.fn(async (_url: unknown, request: RequestInit) => {
      const body = JSON.parse(String(request.body))
      expect(body.input).toHaveLength(9)
      expect(body.input.every((item: { role?: string }) => item.role !== 'tool')).toBe(true)
      expect(body.input.filter((item: { type?: string }) => item.type === 'function_call_output')).toEqual([
        { type: 'function_call_output', call_id: 'call_0', output: 'file 0' },
        { type: 'function_call_output', call_id: 'call_1', output: 'file 1' },
        { type: 'function_call_output', call_id: 'call_2', output: 'file 2' },
      ])
      return Response.json({ status: 'completed', output: [{ type: 'message', id: 'answer', content: [{ type: 'output_text', text: 'Done' }] }] })
    })
    vi.stubGlobal('fetch', fetch)
    const chunks = await collect(streamNativeMedia(ctx, options, defaultSessionMedia(), config, new AbortController().signal))
    expect(chunks).toContainEqual({ type: 'text-delta', index: 0, text: 'Done' })
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('reconstructs JSON function output using selected model, not vision model', async () => {
    const { ctx, options } = await harness()
    options.tools = [{ name: 'read', description: 'Read one file', parameters: { type: 'object', properties: {} } }]
    const fetch = vi.fn(async () => Response.json({ status: 'completed', output: [{ type: 'function_call', id: 'fc', call_id: 'call', name: 'read', arguments: '{}' }], usage: { input_tokens: 3, output_tokens: 2 } }))
    vi.stubGlobal('fetch', fetch)
    const chunks = await collect(streamNativeMedia(ctx, options, { ...defaultSessionMedia(), imageGeneration: true }, config, new AbortController().signal))
    expect(chunks).toContainEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
    expect(chunks).toContainEqual({ type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call', name: 'read', arguments: '{}' } })
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))
    expect(body.model).toBe('gpt-6.1-sol')
    expect(body.tools).toEqual([{ type: 'function', ...options.tools[0], strict: false }, { type: 'image_generation' }])
  })
  it('accepts Responses event names carried only in SSE headers', async () => {
    const { ctx, options } = await harness()
    vi.stubGlobal('fetch', vi.fn(async () => new Response([
      'event: response.created\ndata: {"response":{"status":"in_progress"}}\n\n',
      'event: response.output_text.delta\ndata: {"item_id":"answer","delta":"Done"}\n\n',
      'event: response.completed\ndata: {"response":{"status":"completed","output":[]}}\n\n',
    ].join(''), { headers: { 'Content-Type': 'text/event-stream' } })))
    const chunks = await collect(streamNativeMedia(ctx, options, { ...defaultSessionMedia(), imageGeneration: true }, config, new AbortController().signal))
    expect(chunks).toContainEqual({ type: 'text-delta', index: 0, text: 'Done' })
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })
  it('accepts only terminal final images and deduplicates done/completed output', async () => {
    const { ctx, options, data } = await harness()
    const image = { type: 'image_generation_call', id: 'ig', result: data.toString('base64') }
    vi.stubGlobal('fetch', vi.fn(async () => sse([{ type: 'response.image_generation_call.partial_image', partial_image_b64: 'ignore' }, { type: 'response.output_item.done', item: image }, { type: 'response.completed', response: { status: 'completed', output: [image] } }])))
    const chunks = await collect(streamNativeMedia(ctx, options, { ...defaultSessionMedia(), imageGeneration: true }, config, new AbortController().signal))
    expect(chunks.filter(chunk => chunk.type === 'block-end' && chunk.block.type === 'image')).toHaveLength(1)
    expect(ctx.attachments.saveImage).toHaveBeenCalledOnce()
    vi.mocked(ctx.attachments.saveImage).mockClear()
    vi.stubGlobal('fetch', vi.fn(async () => sse([{ type: 'response.output_item.done', item: image }])))
    await expect(collect(streamNativeMedia(ctx, options, defaultSessionMedia(), config, new AbortController().signal))).rejects.toThrow('terminal')
    expect(ctx.attachments.saveImage).not.toHaveBeenCalled()
  })
  it('does not accept nonterminal, cancelled or filtered Responses as successful generation', async () => {
    const { ctx, options, data } = await harness()
    const image = { type: 'image_generation_call', id: 'ig', result: data.toString('base64') }
    for (const status of ['queued', 'in_progress', 'cancelled']) {
      vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status, output: [image] })))
      await expect(collect(streamNativeMedia(ctx, options, { ...defaultSessionMedia(), imageGeneration: true }, config, new AbortController().signal))).rejects.toThrow(/terminal|cancelled/u)
    }
    vi.stubGlobal('fetch', vi.fn(async () => sse([{ type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [image] } }])))
    await expect(collect(streamNativeMedia(ctx, options, { ...defaultSessionMedia(), imageGeneration: true }, config, new AbortController().signal))).rejects.toThrow('content filter')
    expect(ctx.attachments.saveImage).not.toHaveBeenCalled()
  })
  it('reconciles each final Responses text part with deltas without losing or duplicating text', async () => {
    const { ctx, options } = await harness()
    vi.stubGlobal('fetch', vi.fn(async () => sse([
      { type: 'response.output_text.delta', item_id: 'answer', output_index: 0, content_index: 0, delta: 'Hel' },
      { type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', id: 'answer', content: [{ type: 'output_text', text: 'Hello' }, { type: 'output_text', text: 'World' }] }] } },
    ])))
    const chunks = await collect(streamNativeMedia(ctx, options, defaultSessionMedia(), config, new AbortController().signal))
    expect(chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('')).toBe('HelloWorld')
    expect(chunks.filter(chunk => chunk.type === 'block-end').map(chunk => chunk.block)).toEqual([{ type: 'text', text: 'Hello' }, { type: 'text', text: 'World' }])
  })
  it('uses the same safe relay classifier for Chat, flat SSE errors, and failed final Responses', async () => {
    const { ctx, options } = await harness()
    for (const event of [
      { type: 'error', code: 'context_length_exceeded', message: 'secret test-key' },
      { status: 'failed', error: { code: 'context_length_exceeded', message: 'secret test-key' }, output: [] },
      { error: { code: 'context_length_exceeded', message: 'secret test-key' } },
    ]) {
      vi.stubGlobal('fetch', vi.fn(async () => sse([event])))
      await expect(collect(streamNativeMedia(ctx, options, defaultSessionMedia(), config, new AbortController().signal))).rejects.toMatchObject({ code: 'CONTEXT_WINDOW_EXCEEDED', message: expect.stringContaining('context window') })
    }
    vi.stubGlobal('fetch', vi.fn(async () => sse([{ error: { code: 'rate_limit_exceeded', message: 'secret test-key' } }])))
    await expect(collect(streamNativeMedia(ctx, options, { ...defaultSessionMedia(), directProtocol: 'openai' }, config, new AbortController().signal))).rejects.toMatchObject({ code: 'NATIVE_MEDIA_RATE_LIMIT' })
  })
  it('bounds malformed HTTP error bodies and never reflects arbitrary upstream parameter names', async () => {
    for (const body of ['private test-key HTML', JSON.stringify({ error: { message: 'test-key', code: 'unsupported_parameter', param: 'test-key' } }), JSON.stringify({ error: { code: 'context_length_exceeded', message: 'test-key'.repeat(4096) } })]) {
      const events = relayEvents(new Response(body, { status: 400 }))
      const error = await events.next().then(() => undefined, error => error)
      expect(error).toMatchObject({ code: 'NATIVE_MEDIA_BAD_REQUEST', failure: { status: 400 } })
      expect(error.message).not.toMatch(/test-key|private/u)
    }
  })
  it('reports Chat error envelopes even after a finish chunk without accepting success', async () => {
    const { ctx, options } = await harness()
    vi.stubGlobal('fetch', vi.fn(async () => sse([
      { choices: [{ delta: { content: 'Partial' }, finish_reason: 'stop' }] },
      { error: { message: 'must not expose test-key', code: 'upstream_error' } },
    ])))
    await expect(collect(streamNativeMedia(ctx, options, { ...defaultSessionMedia(), directProtocol: 'openai' }, config, new AbortController().signal))).rejects.toThrow('Relay request failed')
  })
  it('preserves Responses refusal text instead of silently finishing with an empty answer', async () => {
    const { ctx, options } = await harness()
    for (const deltas of [[], [{ type: 'response.refusal.delta', item_id: 'answer', content_index: 0, delta: 'Cannot' }]]) {
      vi.stubGlobal('fetch', vi.fn(async () => sse([...deltas, { type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', id: 'answer', content: [{ type: 'refusal', refusal: 'Cannot comply.' }] }] } }])))
      const chunks = await collect(streamNativeMedia(ctx, options, defaultSessionMedia(), config, new AbortController().signal))
      expect(chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('')).toBe('Cannot comply.')
    }
  })
  it('does not authorize tool dispatch when Chat marks the output as content-filtered', async () => {
    const { ctx, options } = await harness()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ id: 'call', function: { name: 'read', arguments: '{}' } }] }, finish_reason: 'content_filter' }] })))
    await expect(collect(streamNativeMedia(ctx, options, { ...defaultSessionMedia(), directProtocol: 'openai' }, config, new AbortController().signal))).rejects.toThrow('content filter')
  })
  it('keeps max-token truncation distinct and never saves an incomplete generated image', async () => {
    const { ctx, options, data } = await harness()
    vi.stubGlobal('fetch', vi.fn(async () => sse([{ type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'image_generation_call', id: 'ig', result: data.toString('base64') }] } }])))
    const chunks = await collect(streamNativeMedia(ctx, options, { ...defaultSessionMedia(), imageGeneration: true }, config, new AbortController().signal))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'max-tokens' } })
    expect(ctx.attachments.saveImage).not.toHaveBeenCalled()
  })
  it('cleans an owned partial generated image on write failure without masking the cause', async () => {
    const { ctx, options, data } = await harness()
    const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    const failure = new Error('simulated interrupted write')
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await real.open(...args)
      handle.writeFile = async () => { await real.writeFile(args[0], data.subarray(0, 8)); throw failure }
      return handle
    })
    const workspace = ctx.sessions.get(options.sessionId!)!.header.cwd
    await expect(saveGeneratedImage(ctx, data.toString('base64'), workspace, config)).rejects.toBe(failure)
    expect(await readdir(join(workspace, '.dsh-vision-toolkit', 'artifacts'))).toEqual([])
    expect(ctx.attachments.saveImage).not.toHaveBeenCalled()
  })
  it('does not delete a pre-existing file when exclusive generated-image creation fails', async () => {
    const { ctx, options, data } = await harness()
    const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    const failure = Object.assign(new Error('already exists'), { code: 'EEXIST' })
    let existing = ''
    vi.mocked(open).mockImplementationOnce(async path => {
      existing = String(path)
      await real.writeFile(path, 'existing artifact')
      throw failure
    })
    const workspace = ctx.sessions.get(options.sessionId!)!.header.cwd
    await expect(saveGeneratedImage(ctx, data.toString('base64'), workspace, config)).rejects.toBe(failure)
    expect(await readFile(existing, 'utf8')).toBe('existing artifact')
    expect(ctx.attachments.saveImage).not.toHaveBeenCalled()
  })
  it('does not commit a generated attachment when cancellation happens during artifact validation', async () => {
    const { ctx, options, data } = await harness()
    const controller = new AbortController()
    const reason = new Error('cancelled during artifact validation')
    const real = await vi.importActual<typeof import('../src/artifacts.ts')>('../src/artifacts.ts')
    vi.mocked(describeArtifact).mockImplementationOnce(async (...args) => { const artifact = await real.describeArtifact(...args); controller.abort(reason); return artifact })
    const workspace = ctx.sessions.get(options.sessionId!)!.header.cwd
    await expect(saveGeneratedImage(ctx, data.toString('base64'), workspace, config, controller.signal)).rejects.toBe(reason)
    expect(await readdir(join(workspace, '.dsh-vision-toolkit', 'artifacts'))).toEqual([])
    expect(ctx.attachments.saveImage).not.toHaveBeenCalled()
  })
  it('supports Chat JSON tool calls', async () => {
    const { ctx, options } = await harness()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ id: 'call', function: { name: 'read', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] })))
    const chunks = await collect(streamNativeMedia(ctx, options, { ...defaultSessionMedia(), directProtocol: 'openai' }, config, new AbortController().signal))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
  })
})
