/**
 * Relay model catalog: fetch and parse the model list from the configured
 * OpenAI-compatible (or Anthropic) relay endpoint. The Settings page uses it
 * to offer a model picker instead of hand-typed ids, and to attach detected
 * input-modality capabilities to every listed model.
 * @module dsh-vision-toolkit/relay-models
 */

import { detectModelCapabilities, type ModelCapabilities } from './model-capabilities.ts'
import type { ResolvedVisionToolkitConfig } from './config.ts'
import { redactText } from './errors.ts'

/** One relay catalog entry: model id plus detected capabilities. */
export interface RelayModelEntry {
  id: string
  capabilities: ModelCapabilities
}

/** Parsed relay model catalog. */
export interface RelayModelCatalog {
  models: RelayModelEntry[]
}

/** Hard cap so a hostile or broken relay cannot flood the Settings page. */
const MAX_RELAY_MODELS = 500

/** Cap on the /models response body. */
const MAX_MODELS_BODY_BYTES = 4 * 1024 * 1024

/** Dedicated budget for the catalog request; short, it is a picker action. */
const RELAY_MODELS_TIMEOUT_MS = 15_000

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Extract model ids from one `/models` response payload. Accepts the
 * OpenAI-compatible shape (`{ data: [{ id }] }`), the Anthropic Messages
 * shape (`{ data: [{ id }] }`), and a bare array of ids or objects.
 */
export function parseRelayModelIds(payload: unknown): string[] {
  const rows: unknown[] = Array.isArray(payload)
    ? payload
    : typeof payload === 'object' && payload !== null && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : []
  const ids: string[] = []
  for (const row of rows) {
    const id = typeof row === 'string'
      ? row
      : typeof row === 'object' && row !== null ? (row as { id?: unknown }).id : undefined
    if (typeof id !== 'string') continue
    const trimmed = id.trim()
    if (trimmed.length > 0 && trimmed.length <= 256) ids.push(trimmed)
  }
  return [...new Set(ids)].sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase())).slice(0, MAX_RELAY_MODELS)
}

/** Build the model-catalog fetch: URL, auth, and provider headers. */
function relayModelsRequest(
  provider: ResolvedVisionToolkitConfig['provider'],
  apiKey: string,
  extraHeaders: Record<string, string>,
): { url: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': provider.userAgent,
    ...extraHeaders,
  }
  if (provider.protocol === 'anthropic') {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else {
    headers.Authorization = `Bearer ${apiKey}`
  }
  return { url: `${provider.baseUrl}/models`, headers }
}

/**
 * Fetch the relay model catalog with detected capabilities. Errors carry the
 * provider-facing detail (HTTP status and a redacted body excerpt) so a broken
 * relay is diagnosable from Settings.
 * @param provider - resolved provider configuration.
 * @param apiKey - resolved credential value.
 * @param extraHeaders - provider/session headers (already resolved for this action).
 * @param signal - cancellation for the request.
 */
export async function fetchRelayModels(
  provider: ResolvedVisionToolkitConfig['provider'],
  apiKey: string,
  extraHeaders: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<RelayModelCatalog> {
  const { url, headers } = relayModelsRequest(provider, apiKey, extraHeaders)
  const timeout = AbortSignal.timeout(RELAY_MODELS_TIMEOUT_MS)
  const composite = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  let response: Response
  try {
    response = await fetch(url, { method: 'GET', redirect: 'error', headers, signal: composite })
  } catch (error) {
    if (signal?.aborted === true) throw error
    throw new Error(redactText(`relay model list could not be fetched from ${url}: ${message(error)}`, [apiKey, ...Object.values(extraHeaders)]))
  }
  const declaredLength = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MODELS_BODY_BYTES) {
    await response.body?.cancel()
    throw new Error(`relay model list at ${url} declares a body above the ${MAX_MODELS_BODY_BYTES}-byte limit`)
  }
  const reader = response.body?.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  if (reader !== undefined) {
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > MAX_MODELS_BODY_BYTES) {
          await reader.cancel()
          throw new Error(`relay model list at ${url} exceeds the ${MAX_MODELS_BODY_BYTES}-byte limit`)
        }
        chunks.push(chunk.value)
      }
    } finally { reader.releaseLock() }
  }
  const body = Buffer.concat(chunks, bytes).toString('utf8')
  if (!response.ok) {
    const excerpt = redactText(body, [apiKey, ...Object.values(extraHeaders)]).slice(0, 200).replace(/\s+/gu, ' ').trim()
    if (response.status === 401) throw new Error(`relay rejected the configured credential (HTTP 401) at ${url}`)
    if (response.status === 403) throw new Error(`relay is reachable but restricts GET /models (HTTP 403); the key may still work for vision requests`)
    if (response.status === 404 || response.status === 405) throw new Error(`relay does not expose GET /models (HTTP ${response.status}); type the model id manually`)
    throw new Error(`relay model list request failed with HTTP ${response.status}${excerpt.length === 0 ? '' : `: ${excerpt}`}`)
  }
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    throw new Error(`relay model list at ${url} is not valid JSON`)
  }
  const ids = parseRelayModelIds(payload)
  if (ids.length === 0) {
    throw new Error(`relay model list at ${url} contained no readable model ids`)
  }
  return { models: ids.map(id => ({ id, capabilities: detectModelCapabilities(id) })) }
}
