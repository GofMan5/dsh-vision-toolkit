/** Native relay wire parts and bounded SSE/JSON transport. */
import { LlmError } from '@deepseek-ai/dsh-llm';
import type { VisionModality } from './model-capabilities.ts';
export interface WireMedia {
    kind: VisionModality;
    mediaType: string;
    filename: string;
    data: Uint8Array;
}
export type WireProtocol = 'openai' | 'responses' | 'anthropic';
export declare function mediaPart(file: WireMedia, protocol: WireProtocol): Record<string, unknown>;
export declare function boundedBody(response: Response, maxBytes: number, onProgress?: () => void): Promise<Uint8Array>;
/** Classify untrusted relay diagnostics without reflecting their raw text/codes. */
export declare function relayFailure(payload: unknown, status?: number): LlmError;
/** Events are decoded across arbitrary network/UTF-8 boundaries, not per chunk. */
export declare function relayEvents(response: Response, maxBytes?: number, onProgress?: () => void): AsyncGenerator<Record<string, unknown>>;
//# sourceMappingURL=media-wire.d.ts.map