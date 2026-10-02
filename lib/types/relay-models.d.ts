/**
 * Relay model catalog: fetch and parse the model list from the configured
 * OpenAI-compatible (or Anthropic) relay endpoint. The Settings page uses it
 * to offer a model picker instead of hand-typed ids, and to attach detected
 * input-modality capabilities to every listed model.
 * @module dsh-vision-toolkit/relay-models
 */
import { type ModelCapabilities } from './model-capabilities.ts';
import type { ResolvedVisionToolkitConfig } from './config.ts';
/** One relay catalog entry: model id plus detected capabilities. */
export interface RelayModelEntry {
    id: string;
    capabilities: ModelCapabilities;
}
/** Parsed relay model catalog. */
export interface RelayModelCatalog {
    models: RelayModelEntry[];
}
/**
 * Extract model ids from one `/models` response payload. Accepts the
 * OpenAI-compatible shape (`{ data: [{ id }] }`), the Anthropic Messages
 * shape (`{ data: [{ id }] }`), and a bare array of ids or objects.
 */
export declare function parseRelayModelIds(payload: unknown): string[];
/**
 * Fetch the relay model catalog with detected capabilities. Errors carry the
 * provider-facing detail (HTTP status and a redacted body excerpt) so a broken
 * relay is diagnosable from Settings.
 * @param provider - resolved provider configuration.
 * @param apiKey - resolved credential value.
 * @param extraHeaders - provider/session headers (already resolved for this action).
 * @param signal - cancellation for the request.
 */
export declare function fetchRelayModels(provider: ResolvedVisionToolkitConfig['provider'], apiKey: string, extraHeaders?: Record<string, string>, signal?: AbortSignal): Promise<RelayModelCatalog>;
//# sourceMappingURL=relay-models.d.ts.map