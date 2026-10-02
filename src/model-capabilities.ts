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
export type VisionModality = 'image' | 'video' | 'audio' | 'document'

/** Every modality in display order. */
export const VISION_MODALITIES: readonly VisionModality[] = ['image', 'video', 'audio', 'document']

/** Effective per-model input capabilities. Text is always assumed. */
export interface ModelCapabilities {
  image: boolean
  video: boolean
  audio: boolean
  document: boolean
}

/** Partial user overrides for one model. */
export type ModelCapabilityOverrides = Partial<ModelCapabilities>

/** Stored per-model override map keyed by exact (case-insensitive) model id. */
export type ModelCapabilityOverrideMap = Record<string, ModelCapabilityOverrides>

/** Capabilities with image input only (the legacy pre-capability behavior). */
export const IMAGE_ONLY_CAPABILITIES: ModelCapabilities = Object.freeze({
  image: true,
  video: false,
  audio: false,
  document: false,
})

/** Capabilities with every modality disabled. */
export const TEXT_ONLY_CAPABILITIES: ModelCapabilities = Object.freeze({
  image: false,
  video: false,
  audio: false,
  document: false,
})

/** Capabilities with every modality enabled. */
export const FULL_MULTIMODAL_CAPABILITIES: ModelCapabilities = Object.freeze({
  image: true,
  video: true,
  audio: true,
  document: true,
})

interface DetectionRule {
  /** Matched against the lowercased model id. */
  pattern: RegExp
  capabilities: ModelCapabilities
}

/**
 * Best-effort defaults by model id. Rules run in order; the first match wins.
 * Unknown ids assume image input (the plugin's core function) with every
 * newer modality off, so configuring a custom-named vision model keeps
 * working exactly as before this feature existed; text-only families and
 * image-generation models are positively excluded and can be re-enabled
 * per model in Settings.
 */
const DETECTION_RULES: readonly DetectionRule[] = [
  // Image-generation models consume text and emit images; describing an
  // image to them is a category error, so every input modality stays off.
  {
    pattern: /(?:^|[/.\-_])(?:qwen-image|wan[\w.\-]*image|z-image|dall-e|dalle|flux|sdxl|stable-diffusion|seedream|seededit|cogview|imagen|midjourney)(?:$|[/.\-_])/u,
    capabilities: TEXT_ONLY_CAPABILITIES,
  },
  // Qwen text tiers stay text-only even though the family has vision twins.
  {
    pattern: /(?:^|[/.\-_])qwen-(?:turbo|plus|textra|long)(?:$|[/.\-0-9])/u,
    capabilities: TEXT_ONLY_CAPABILITIES,
  },
  // Vision-language families (qwen-vl, llava, internvl, …): image and video
  // input; the dedicated -vl line also takes video. This rule runs before the
  // Qwen-Max rule so a "qwen-vl-max" stays a vision-language model.
  {
    pattern: /-vl|qwen[\w.\-]*vl|vision|pixtral|llava|internvl|glmv|moondream|minicpm-v|kosmos|cogvlm|ferret|qvq|gemma-3|molmo|smolvlm|glm-\d+(?:\.\d+)?v(?:$|[-.\d])/u,
    capabilities: { image: true, video: true, audio: false, document: false },
  },
  // Qwen-Max family (qwen-max, qwen3.8-max, qwen3.8-max-0902, …) and every
  // omni model accept images, video, audio, and documents natively.
  {
    pattern: /(?:^|[/.\-_])qwen[\w.\-]*-?max(?:$|[/.\-_0-9])/u,
    capabilities: FULL_MULTIMODAL_CAPABILITIES,
  },
  {
    pattern: /(?:^|[/.\-_])qwen[\w.\-]*omni(?:$|[/.\-_])/u,
    capabilities: FULL_MULTIMODAL_CAPABILITIES,
  },
  // Gemini models take images, video, audio, and PDF documents.
  {
    pattern: /^gemini[\w.\-]*$/u,
    capabilities: FULL_MULTIMODAL_CAPABILITIES,
  },
  {
    pattern: /(?:^|[/.\-_])(?:minimax|abab)[\w.\-]*omni/u,
    capabilities: FULL_MULTIMODAL_CAPABILITIES,
  },
  // GPT-4o family: images and audio (no native video or documents).
  {
    pattern: /(?:^|[/.\-_])(?:gpt-4o|chatgpt-4o|gpt-4\.1)(?:$|[/.\-_])/u,
    capabilities: { image: true, video: false, audio: true, document: false },
  },
  // Claude: images and PDF documents.
  {
    pattern: /(?:^|[/.\-_])claude/u,
    capabilities: { image: true, video: false, audio: false, document: true },
  },
  {
    pattern: /(?:^|[/.\-_])(?:grok[\w.\-]*(?:vision|4))(?:$|[/.\-_])/u,
    capabilities: { image: true, video: false, audio: false, document: true },
  },
  // Vision-language families (qwen-vl, gpt-4.5, gpt-5, o3/o4, llava, …):
  // image input, and video for the dedicated -vl line.
  {
    pattern: /(?:^|[/.\-_])(?:gpt-4-turbo|gpt-4-vision|gpt-5|gpt-6|o3|o4)(?:$|[/.\-_])/u,
    capabilities: { image: true, video: false, audio: false, document: false },
  },
  // Known text-only families without vision twins in their naming.
  {
    pattern: /(?:^|[/.\-_])(?:deepseek|glm|kimi|mistral|mixtral|o1|doubao|hunyuan|ernie|command|phi-|granite)(?:$|[/.\-_])/u,
    capabilities: TEXT_ONLY_CAPABILITIES,
  },
]

/** Detect the default capabilities for one model id. */
export function detectModelCapabilities(model: string): ModelCapabilities {
  const id = model.trim().toLowerCase()
  if (id.length === 0) return { ...IMAGE_ONLY_CAPABILITIES }
  for (const rule of DETECTION_RULES) {
    if (rule.pattern.test(id)) return { ...rule.capabilities }
  }
  return { ...IMAGE_ONLY_CAPABILITIES }
}

/** Normalize one override map: trimmed keys (lowercased) and booleans only. */
export function normalizeModelCapabilityOverrides(
  overrides: ModelCapabilityOverrideMap | undefined,
  maxEntries: number,
): ModelCapabilityOverrideMap {
  if (overrides === undefined) return {}
  const normalized: ModelCapabilityOverrideMap = {}
  for (const [rawKey, value] of Object.entries(overrides)) {
    const key = rawKey.trim().toLowerCase()
    if (key.length === 0 || value === undefined || typeof value !== 'object') continue
    const entry: ModelCapabilityOverrides = {}
    for (const modality of VISION_MODALITIES) {
      const flag = (value as Record<string, unknown>)[modality]
      if (typeof flag === 'boolean') entry[modality] = flag
    }
    if (Object.keys(entry).length === 0) continue
    normalized[key] = entry
    if (Object.keys(normalized).length >= maxEntries) break
  }
  return normalized
}

/** Whether any override entry actually differs from its detected default. */
export function overridesChangeBehavior(
  model: string,
  overrides: ModelCapabilityOverrides | undefined,
): boolean {
  if (overrides === undefined) return false
  const detected = detectModelCapabilities(model)
  return VISION_MODALITIES.some(modality => overrides[modality] !== undefined && overrides[modality] !== detected[modality])
}

/**
 * Resolve the effective capabilities for one model: detected defaults merged
 * with the user's per-model overrides (overrides win on every named field).
 * @param model - exact model id as configured on the provider.
 * @param overrides - normalized override map.
 */
export function resolveModelCapabilities(
  model: string,
  overrides: ModelCapabilityOverrideMap | undefined,
): ModelCapabilities {
  const detected = detectModelCapabilities(model)
  const entry = overrides?.[model.trim().toLowerCase()]
  if (entry === undefined) return detected
  return {
    image: entry.image ?? detected.image,
    video: entry.video ?? detected.video,
    audio: entry.audio ?? detected.audio,
    document: entry.document ?? detected.document,
  }
}

/** Comma-separated modality list for the Python runtime env (empty = none). */
export function visionModalitiesEnvValue(capabilities: ModelCapabilities): string {
  return VISION_MODALITIES.filter(modality => capabilities[modality]).join(',')
}

/** Parse a VISION_MODALITIES-style comma/space separated list. */
export function parseVisionModalitiesEnvValue(raw: string | undefined): ReadonlySet<VisionModality> {
  if (raw === undefined) return new Set<VisionModality>(['image'])
  const enabled = new Set<VisionModality>()
  for (const token of raw.split(/[\s,]+/u)) {
    const value = token.trim().toLowerCase() as VisionModality
    if ((VISION_MODALITIES as readonly string[]).includes(value)) enabled.add(value)
  }
  return enabled
}

/** Image media types accepted by the glance pipeline (mirrors the Python map). */
export const IMAGE_MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

/** Media-file extensions grouped by modality (mirrors the Python map). */
export const MEDIA_EXTENSION_KINDS: Readonly<Record<string, Exclude<VisionModality, 'image'>>> = {
  '.mp4': 'video',
  '.m4v': 'video',
  '.webm': 'video',
  '.mkv': 'video',
  '.mov': 'video',
  '.avi': 'video',
  '.3gp': 'video',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.m4a': 'audio',
  '.aac': 'audio',
  '.ogg': 'audio',
  '.opus': 'audio',
  '.flac': 'audio',
  '.pdf': 'document',
  '.docx': 'document',
  '.xlsx': 'document',
  '.pptx': 'document',
  '.doc': 'document',
  '.xls': 'document',
  '.ppt': 'document',
}

/** Media type by extension for every accepted media-file kind. */
export const MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.3gp': 'video/3gpp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.flac': 'audio/flac',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.doc': 'application/msword',
  '.xls': 'application/vnd.ms-excel',
  '.ppt': 'application/vnd.ms-powerpoint',
}

/** Resolve the modality of one input path by extension; undefined = unknown. */
export function mediaKindOfPath(path: string): VisionModality | undefined {
  const normalized = path.toLowerCase()
  const dot = normalized.lastIndexOf('.')
  const extension = dot < 0 ? '' : normalized.slice(dot)
  if (extension in IMAGE_MEDIA_TYPES) return 'image'
  return MEDIA_EXTENSION_KINDS[extension]
}
