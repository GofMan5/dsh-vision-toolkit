import { describe, expect, it } from 'vitest'
import {
  MEDIA_TYPE_BY_EXTENSION,
  detectModelCapabilities,
  mediaKindOfPath,
  normalizeModelCapabilityOverrides,
  overridesChangeBehavior,
  parseVisionModalitiesEnvValue,
  resolveModelCapabilities,
  visionModalitiesEnvValue,
} from '../src/model-capabilities.ts'

describe('detectModelCapabilities', () => {
  it('treats the Qwen Max family (including 0902) as fully multimodal', () => {
    for (const model of ['qwen-max', 'qwen3.8-max', 'qwen3.8-max-0902', 'qwen-max-latest', 'openai/qwen2.5-max']) {
      expect(detectModelCapabilities(model)).toEqual({ image: true, video: true, audio: true, document: true })
    }
  })

  it('treats omni and Gemini models as fully multimodal', () => {
    for (const model of ['qwen-omni-turbo', 'qwen2.5-omni-7b', 'gemini-2.5-flash', 'gemini-3.7-flash']) {
      expect(detectModelCapabilities(model)).toEqual({ image: true, video: true, audio: true, document: true })
    }
  })

  it('treats vision-language families as image+video without audio', () => {
    for (const model of ['qwen-vl-max', 'qwen2.5-vl-72b', 'qwen3-vl-plus', 'llava-34b', 'pixtral-12b']) {
      expect(detectModelCapabilities(model)).toEqual({ image: true, video: true, audio: false, document: false })
    }
  })

  it('treats Claude as image+document and GPT-4o as image+audio', () => {
    expect(detectModelCapabilities('claude-sonnet-5')).toEqual({ image: true, video: false, audio: false, document: true })
    expect(detectModelCapabilities('gpt-4o')).toEqual({ image: true, video: false, audio: true, document: false })
    expect(detectModelCapabilities('gpt-5.6-sol')).toEqual({ image: true, video: false, audio: false, document: false })
  })

  it('treats text-only families as text-only', () => {
    for (const model of ['glm-5.3-prime', 'deepseek-v4-pro-0813', 'kimi-k3', 'qwen-turbo', 'qwen-plus', 'mistral-medium-3.5']) {
      expect(detectModelCapabilities(model)).toEqual({ image: false, video: false, audio: false, document: false })
    }
  })

  it('treats image-generation models as consuming no visual input', () => {
    for (const model of ['qwen-image-max', 'qwen-image-3.0-pro', 'wan2.7-image', 'z-image-turbo', 'qwen-image-edit-plus']) {
      expect(detectModelCapabilities(model)).toEqual({ image: false, video: false, audio: false, document: false })
    }
  })

  it('assumes image input for unknown ids without the newer modalities', () => {
    expect(detectModelCapabilities('totally-unknown-model')).toEqual({ image: true, video: false, audio: false, document: false })
    expect(detectModelCapabilities('')).toEqual({ image: true, video: false, audio: false, document: false })
  })

  it('is case-insensitive', () => {
    expect(detectModelCapabilities('Qwen3.8-Max-0902')).toEqual(detectModelCapabilities('qwen3.8-max-0902'))
  })
})

describe('normalizeModelCapabilityOverrides', () => {
  it('trims and lowercases keys and keeps boolean flags only', () => {
    expect(normalizeModelCapabilityOverrides({
      '  Qwen3.8-Max-0902 ': { image: true, video: false, audio: 'yes' as unknown, document: undefined },
    }, 16)).toEqual({ 'qwen3.8-max-0902': { image: true, video: false } })
  })

  it('drops empty or non-object entries', () => {
    expect(normalizeModelCapabilityOverrides({ '': { image: true }, bad: 'nope' as unknown }, 16)).toEqual({})
  })

  it('caps the number of stored entries', () => {
    const overrides: Record<string, { image: boolean }> = {}
    for (let index = 0; index < 40; index += 1) overrides[`model-${index}`] = { image: true }
    expect(Object.keys(normalizeModelCapabilityOverrides(overrides, 8))).toHaveLength(8)
  })
})

describe('resolveModelCapabilities', () => {
  it('merges per-field overrides over detected defaults', () => {
    const resolved = resolveModelCapabilities('qwen3.8-max-0902', { 'qwen3.8-max-0902': { audio: false } })
    expect(resolved).toEqual({ image: true, video: true, audio: false, document: true })
  })

  it('falls back to detection without overrides', () => {
    expect(resolveModelCapabilities('glm-5.3', {})).toEqual({ image: false, video: false, audio: false, document: false })
    expect(resolveModelCapabilities('glm-5.3', undefined)).toEqual({ image: false, video: false, audio: false, document: false })
    expect(resolveModelCapabilities('custom-unknown-model', undefined)).toEqual({ image: true, video: false, audio: false, document: false })
  })

  it('enables modalities on a text-only default model', () => {
    const resolved = resolveModelCapabilities('glm-5.3-prime', { 'glm-5.3-prime': { image: true, video: true } })
    expect(resolved).toEqual({ image: true, video: true, audio: false, document: false })
  })
})

describe('overridesChangeBehavior', () => {
  it('marks only real deviations', () => {
    const detected = detectModelCapabilities('qwen3.8-max-0902')
    expect(overridesChangeBehavior('qwen3.8-max-0902', { image: detected.image })).toBe(false)
    expect(overridesChangeBehavior('qwen3.8-max-0902', { audio: !detected.audio })).toBe(true)
    expect(overridesChangeBehavior('qwen3.8-max-0902', undefined)).toBe(false)
  })
})

describe('visionModalitiesEnvValue', () => {
  it('joins enabled modalities in display order', () => {
    expect(visionModalitiesEnvValue({ image: true, video: true, audio: false, document: true })).toBe('image,video,document')
  })

  it('returns an empty string when nothing is accepted', () => {
    expect(visionModalitiesEnvValue({ image: false, video: false, audio: false, document: false })).toBe('')
  })
})

describe('parseVisionModalitiesEnvValue', () => {
  it('defaults to image-only when the variable is unset', () => {
    expect([...parseVisionModalitiesEnvValue(undefined)]).toEqual(['image'])
  })

  it('parses comma- and space-separated lists and ignores unknown tokens', () => {
    expect([...parseVisionModalitiesEnvValue('image, video  audio')].sort()).toEqual(['audio', 'image', 'video'])
    expect([...parseVisionModalitiesEnvValue('image,banana,document')].sort()).toEqual(['document', 'image'])
  })

  it('treats an explicitly empty value as no accepted modality', () => {
    expect([...parseVisionModalitiesEnvValue('')]).toEqual([])
  })
})

describe('mediaKindOfPath', () => {
  it('classifies paths by extension case-insensitively', () => {
    expect(mediaKindOfPath('C:/shots/frame.PNG')).toBe('image')
    expect(mediaKindOfPath('clip.Mp4')).toBe('video')
    expect(mediaKindOfPath('voice-note.mp3')).toBe('audio')
    expect(mediaKindOfPath('report.pdf')).toBe('document')
    expect(mediaKindOfPath('spreadsheet.xlsx')).toBe('document')
    expect(mediaKindOfPath('archive.zip')).toBeUndefined()
    expect(mediaKindOfPath('noextension')).toBeUndefined()
  })

  it('keeps the media-type map aligned with the extension kinds', () => {
    for (const [extension, kind] of Object.entries({ ...{ '.mp4': 'video' } })) {
      expect(MEDIA_TYPE_BY_EXTENSION[extension]).toBeDefined()
      expect(kind).toBe('video')
    }
  })
})
