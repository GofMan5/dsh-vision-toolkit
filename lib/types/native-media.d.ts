import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { Context } from '@deepseek-ai/cordis';
import { type ContentBlock, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { type ArtifactDescriptor } from './artifacts.ts';
import { type ResolvedVisionToolkitConfig } from './config.ts';
import { type WireMedia } from './media-wire.ts';
import type { SessionMediaSettings } from './session-media.ts';
import type { MediaReferenceAuthority } from './media-references.ts';
/** Legacy text-only parser; never grants automatic upload authority. */
export declare function pastedMediaReferences(text: string): Array<{
    marker: string;
    path: string;
}>;
export declare function readWireFile(path: string, workspace: string, config: ResolvedVisionToolkitConfig, signal?: AbortSignal): Promise<WireMedia>;
/** Persist and validate final generated images; partial previews never become final artifacts. */
export declare function saveGeneratedImage(ctx: Context, base64: string, workspace: string, config: ResolvedVisionToolkitConfig, signal?: AbortSignal): Promise<{
    artifact: ArtifactDescriptor;
    block: ContentBlock;
}>;
export declare function nativeMessages(ctx: Context, options: GenerateOptions, settings: SessionMediaSettings, config: ResolvedVisionToolkitConfig, protocol: 'responses' | 'openai', mediaReferences?: MediaReferenceAuthority): Promise<Record<string, unknown>[]>;
/** Read durable file bytes only through the host's integrity-verifying attachment service. */
export declare function readWireAttachment(ctx: Context, ref: FileAttachmentRef, config: ResolvedVisionToolkitConfig, signal?: AbortSignal): Promise<WireMedia | undefined>;
export declare function relayEndpoint(baseUrl: string, endpoint: string): string;
/** Full Responses stream including function calls and native image_generation output. */
export declare function streamNativeMedia(ctx: Context, options: GenerateOptions, settings: SessionMediaSettings, config: ResolvedVisionToolkitConfig, lifecycle: AbortSignal, mediaReferences?: MediaReferenceAuthority): AsyncGenerator<StreamChunk>;
//# sourceMappingURL=native-media.d.ts.map