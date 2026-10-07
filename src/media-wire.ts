/** Native relay wire parts and bounded SSE/JSON transport. */
import { CONTEXT_WINDOW_EXCEEDED_CODE, isContextWindowExceededError, isQuotaExceededError, LlmError, QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import type { VisionModality } from './model-capabilities.ts'
import { VisionToolkitError } from './errors.ts'

export interface WireMedia { kind: VisionModality; mediaType: string; filename: string; data: Uint8Array }
export type WireProtocol = 'openai' | 'responses' | 'anthropic'
export function mediaPart(file: WireMedia, protocol: WireProtocol): Record<string, unknown> {
  const base64 = Buffer.from(file.data).toString('base64')
  const url = `data:${file.mediaType};base64,${base64}`
  if (protocol === 'openai') {
    if (file.kind === 'image') return { type: 'image_url', image_url: { url } }
    if (file.kind === 'video') return { type: 'video_url', video_url: { url } }
    if (file.kind === 'audio') return { type: 'input_audio', input_audio: { data: base64, format: file.mediaType === 'audio/mpeg' ? 'mp3' : file.mediaType === 'audio/mp4' ? 'm4a' : file.mediaType.split('/')[1] } }
    return { type: 'file', file: { file_data: url, filename: file.filename } }
  }
  if (protocol === 'responses') {
    if (file.kind === 'image') return { type: 'input_image', image_url: url }
    if (file.kind === 'document') return { type: 'input_file', file_data: url, filename: file.filename }
    throw new VisionToolkitError('input', `Responses does not define native ${file.kind} parts; select OpenAI Chat Completions for direct audio/video or the Vision Toolkit proxy mode`)
  }
  if (file.kind !== 'image' && (file.kind !== 'document' || file.mediaType !== 'application/pdf')) {
    throw new VisionToolkitError('input', 'Anthropic native media supports images and PDF only; use the OpenAI relay protocol for other inputs')
  }
  return { type: file.kind === 'image' ? 'image' : 'document', source: { type: 'base64', media_type: file.mediaType, data: base64 } }
}

export async function boundedBody(response: Response, maxBytes: number, onProgress?: () => void): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('Relay response exceeds its byte limit') }
  if (response.body === null) throw new Error('Relay returned no body')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (value.length > 0) onProgress?.()
      size += value.length
      if (size > maxBytes) throw new Error('Relay response exceeds its byte limit')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  return Buffer.concat(chunks, size)
}

/** Classify untrusted relay diagnostics without reflecting their raw text/codes. */
export function relayFailure(payload: unknown, status?: number): LlmError {
  const root = payload !== null && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const response = root.response as Record<string, unknown> | undefined
  const value = root.error ?? response?.error ?? root
  const error = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
  const detail = [error.code, error.type, error.message].filter((value): value is string => typeof value === 'string').map(value => value.slice(0, 4096)).join(' ')
  let code = 'NATIVE_MEDIA_PROVIDER_ERROR'
  let reason = 'unspecified provider error; inspect relay-side diagnostics'
  if (isContextWindowExceededError(detail)) { code = CONTEXT_WINDOW_EXCEEDED_CODE; reason = 'context window exceeded; compact the Session or start a new one' }
  else if (isQuotaExceededError(detail)) { code = QUOTA_EXCEEDED_CODE; reason = 'account quota/balance exhausted; check the relay account' }
  else if (status === 401 || status === 403 || /\b(?:invalid_api_key|authentication_error|permission_denied)\b/iu.test(detail)) { code = 'NATIVE_MEDIA_AUTH'; reason = 'authentication/permission rejected; check the relay credential' }
  else if (status === 408 || status === 504 || /\b(?:timeout|timed_out|deadline_exceeded)\b/iu.test(detail)) { code = 'NATIVE_MEDIA_RELAY_TIMEOUT'; reason = 'relay/upstream timed out; inspect its request deadline' }
  else if (status === 429 || /\brate_limit(?:_exceeded|_error)?\b/iu.test(detail)) { code = 'NATIVE_MEDIA_RATE_LIMIT'; reason = 'rate limit reached; wait before retrying' }
  else if ((status !== undefined && status >= 500) || /\b(?:server_error|internal_server_error|upstream_error|overloaded_error)\b/iu.test(detail)) { code = 'NATIVE_MEDIA_SERVER'; reason = 'upstream server failed; inspect relay health' }
  else if ((status !== undefined && status >= 400 && status < 500) || /\b(?:invalid_request_error|invalid_request|unsupported_parameter|unsupported_value|model_not_found)\b/iu.test(detail)) {
    code = 'NATIVE_MEDIA_BAD_REQUEST'
    const param = typeof error.param === 'string' && ['reasoning.effort', 'reasoning_effort', 'tools', 'model', 'input', 'messages', 'max_output_tokens', 'max_completion_tokens', 'temperature', 'stop'].includes(error.param) ? ` (${error.param})` : ''
    reason = `request rejected${param}; check model, protocol and generation support`
  }
  // Native transient codes stay outside normal Host retry policy: a failed
  // image generation may already have been billed. No implicit paid resubmit.
  return new LlmError(`Relay request failed${status === undefined ? '' : ` (HTTP ${status})`}: ${reason}`, code, status === undefined ? undefined : { status })
}

/** Events are decoded across arbitrary network/UTF-8 boundaries, not per chunk. */
export async function* relayEvents(response: Response, maxBytes = 64 * 1024 * 1024, onProgress?: () => void): AsyncGenerator<Record<string, unknown>> {
  if (!response.ok) {
    let payload: unknown
    try {
      payload = JSON.parse(Buffer.from(await boundedBody(response, Math.min(maxBytes, 16 * 1024), onProgress)).toString('utf8'))
    } catch { /* Invalid/oversized error bodies retain the safe HTTP diagnosis. */ }
    throw relayFailure(payload, response.status)
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const value: unknown = JSON.parse(Buffer.from(await boundedBody(response, maxBytes, onProgress)).toString('utf8'))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Relay returned invalid JSON')
    yield value as Record<string, unknown>
    return
  }
  if (response.body === null) throw new Error('Relay returned no stream')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let trailingCR = false
  let received = 0
  const append = (text: string, final = false): void => {
    if (trailingCR) { text = `\r${text}`; trailingCR = false }
    if (!final && text.endsWith('\r')) { text = text.slice(0, -1); trailingCR = true }
    pending += text.replace(/\r\n?/gu, '\n')
  }
  const parse = (event: string): Record<string, unknown> | null | undefined => {
    const lines = event.split('\n')
    const text = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    if (text.trim() === '[DONE]') return null
    if (text === '') return undefined
    const value: unknown = JSON.parse(text)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid relay event')
    const record = value as Record<string, unknown>
    const type = lines.find(line => line.startsWith('event:'))?.slice(6).trim()
    // Some relays put the Responses type only in the standard SSE event field.
    return record.type === undefined && type ? { ...record, type } : record
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (value.length > 0) onProgress?.()
      received += value.length
      if (received > maxBytes) throw new Error('Relay stream exceeds its byte limit')
      append(decoder.decode(value, { stream: true }))
      let boundary: number
      while ((boundary = pending.indexOf('\n\n')) !== -1) {
        const event = parse(pending.slice(0, boundary))
        pending = pending.slice(boundary + 2)
        if (event === null) return
        if (event !== undefined) yield event
      }
    }
    append(decoder.decode(), true)
    if (pending.trim() !== '') { const event = parse(pending); if (event !== undefined && event !== null) yield event }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
