/** Session consent and multimodal routing without rewriting the durable log. */
import type { Context } from '@deepseek-ai/cordis';
import type { ResolvedVisionToolkitConfig } from './config.ts';
import { type MediaReferenceAuthority } from './media-references.ts';
import type { VisionToolkitRuntime } from './runtime.ts';
import type { SessionMediaStore } from './session-media.ts';
export declare function installMediaRouting(ctx: Context, store: SessionMediaStore, config: () => ResolvedVisionToolkitConfig, runtime: () => VisionToolkitRuntime | undefined, lifecycle: AbortSignal, mediaReferences?: MediaReferenceAuthority): () => void;
//# sourceMappingURL=media-routing.d.ts.map