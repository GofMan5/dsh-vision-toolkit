/**
 * Per-model input-modality capabilities: which content kinds the configured
 * vision model can actually accept (image, video, audio, document). One part
 * is a heuristic name-based default (good enough to prefill the Settings
 * matrix), the other is the user's per-model override map, which always wins.
 * The browser Settings panel keeps a copy of the detection table in
 * `src/client/index.tsx` for instant previews; this module is the enforcement
 * authority.
 * @module dsh-vision-toolkit/model-capabilities
 */
/** Input modalities the vision pipeline can route to a provider. */
export type VisionModality = 'image' | 'video' | 'audio' | 'document';
/** Every modality in display order. */
export declare const VISION_MODALITIES: readonly VisionModality[];
/** Effective per-model input capabilities. Text is always assumed. */
export interface ModelCapabilities {
    image: boolean;
    video: boolean;
    audio: boolean;
    document: boolean;
}
/** Partial user overrides for one model. */
export type ModelCapabilityOverrides = Partial<ModelCapabilities>;
/** Stored per-model override map keyed by exact (case-insensitive) model id. */
export type ModelCapabilityOverrideMap = Record<string, ModelCapabilityOverrides>;
/** Capabilities with image input only (the legacy pre-capability behavior). */
export declare const IMAGE_ONLY_CAPABILITIES: ModelCapabilities;
/** Capabilities with every modality disabled. */
export declare const TEXT_ONLY_CAPABILITIES: ModelCapabilities;
/** Capabilities with every modality enabled. */
export declare const FULL_MULTIMODAL_CAPABILITIES: ModelCapabilities;
/** Detect the default capabilities for one model id. */
export declare function detectModelCapabilities(model: string): ModelCapabilities;
/** Normalize one override map: trimmed keys (lowercased) and booleans only. */
export declare function normalizeModelCapabilityOverrides(overrides: ModelCapabilityOverrideMap | undefined, maxEntries: number): ModelCapabilityOverrideMap;
/** Whether any override entry actually differs from its detected default. */
export declare function overridesChangeBehavior(model: string, overrides: ModelCapabilityOverrides | undefined): boolean;
/**
 * Resolve the effective capabilities for one model: detected defaults merged
 * with the user's per-model overrides (overrides win on every named field).
 * @param model - exact model id as configured on the provider.
 * @param overrides - normalized override map.
 */
export declare function resolveModelCapabilities(model: string, overrides: ModelCapabilityOverrideMap | undefined): ModelCapabilities;
/** Comma-separated modality list for the Python runtime env (empty = none). */
export declare function visionModalitiesEnvValue(capabilities: ModelCapabilities): string;
/** Parse a VISION_MODALITIES-style comma/space separated list. */
export declare function parseVisionModalitiesEnvValue(raw: string | undefined): ReadonlySet<VisionModality>;
/** Image media types accepted by the glance pipeline (mirrors the Python map). */
export declare const IMAGE_MEDIA_TYPES: Readonly<Record<string, string>>;
/** Media-file extensions grouped by modality (mirrors the Python map). */
export declare const MEDIA_EXTENSION_KINDS: Readonly<Record<string, Exclude<VisionModality, 'image'>>>;
/** Media type by extension for every accepted media-file kind. */
export declare const MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, string>>;
/** Resolve the modality of one input path by extension; undefined = unknown. */
export declare function mediaKindOfPath(path: string): VisionModality | undefined;
//# sourceMappingURL=model-capabilities.d.ts.map