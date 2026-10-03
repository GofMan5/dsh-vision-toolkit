// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ComponentType } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { Context, Service } from '@deepseek-ai/cordis'
import {
  installPasteImages,
  PASTE_IMAGES_ROUTE as CLIENT_PASTE_IMAGES_ROUTE,
  PASTE_POLICY_ROUTE,
  PasteImageController,
} from '../src/client/paste-images.tsx'
import { PASTE_IMAGES_ROUTE as SERVER_PASTE_IMAGES_ROUTE, PASTE_POLICY_ROUTE as SERVER_PASTE_POLICY_ROUTE } from '../src/paste-images.ts'

interface Occurrence {
  occurrenceId: number
  source: string
  ref: string
  offset: number
  length?: number
  label: string
  clipboardText: string
}

type ReferenceDraftMode = 'placeholder' | 'display-text'

/**
 * DSH 0.1.5 publishes the draft's admitted attachment ids as `attachmentIds`;
 * the older `imageIds` name is gone. The stand-in mirrors the 0.1.5 snapshot
 * shape so the suite certifies the contract the runtime actually ships.
 */
function inputMachine(initial = '', referenceDraftMode: ReferenceDraftMode = 'placeholder') {  let state = {
    draft: initial,
    draftRev: 0,
    phase: 'plain' as const,
    attachmentIds: [] as string[],
    occurrences: [] as Occurrence[],
    queue: [],
  }
  const listeners = new Set<() => void>()
  const publish = (next: typeof state) => {
    state = next
    for (const listener of listeners) listener()
  }
  return {
    state: {
      getSnapshot: () => state,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    setDraft: vi.fn((draft: string) => {
      let start = 0
      while (start < state.draft.length && start < draft.length && state.draft[start] === draft[start]) start += 1
      let oldEnd = state.draft.length
      let newEnd = draft.length
      while (oldEnd > start && newEnd > start && state.draft[oldEnd - 1] === draft[newEnd - 1]) {
        oldEnd -= 1
        newEnd -= 1
      }
      const insertedLength = newEnd - start
      const delta = insertedLength - (oldEnd - start)
      const occurrences = state.occurrences.flatMap((occurrence) => {
        const end = occurrence.offset + (occurrence.length ?? 1)
        if (end <= start) return [occurrence]
        if (occurrence.offset >= oldEnd) return [{ ...occurrence, offset: occurrence.offset + delta }]
        return []
      })
      publish({ ...state, draft, draftRev: state.draftRev + 1, occurrences })
    }),
    insertReference: vi.fn((reference: Omit<Occurrence, 'occurrenceId' | 'offset'>, span: { start: number; end: number; draftRev: number }) => {
      if (span.draftRev !== state.draftRev || span.start !== span.end) return false
      const text = referenceDraftMode === 'display-text' ? `@${reference.label}` : '\uFFFC'
      const tail = state.draft.slice(span.end)
      const inserted = text + (tail === '' || tail[0] !== ' ' ? ' ' : '')
      const occurrence = {
        ...reference,
        occurrenceId: state.occurrences.length + 1,
        offset: span.start,
        ...(referenceDraftMode === 'display-text' ? { length: text.length } : {}),
      }
      const shifted = state.occurrences.map(row => row.offset >= span.start ? { ...row, offset: row.offset + inserted.length } : row)
      publish({
        ...state,
        draft: state.draft.slice(0, span.start) + inserted + tail,
        draftRev: state.draftRev + 1,
        occurrences: [...shifted, occurrence].sort((a, b) => a.offset - b.offset),
      })
      return true
    }),
    insertText: vi.fn((text: string, span: { start: number; end: number; draftRev: number }) => {
      if (span.draftRev !== state.draftRev || span.start > span.end) return false
      const draft = state.draft.slice(0, span.start) + text + state.draft.slice(span.end)
      const delta = text.length - (span.end - span.start)
      const occurrences = state.occurrences
        .filter(row => row.offset < span.start || row.offset >= span.end)
        .map(row => row.offset >= span.end ? { ...row, offset: row.offset + delta } : row)
      publish({ ...state, draft, draftRev: state.draftRev + 1, occurrences })
      return true
    }),
    /** Mirrors the 0.1.5 `InputActions.addAttachments` admission verb. */
    addAttachments: vi.fn((files: File[]) => {
      const next = [...state.attachmentIds, ...files.map((_, index) => `draft-image-${state.attachmentIds.length + index}`)]
      publish({ ...state, attachmentIds: next })
      return true
    }),
    notify: vi.fn(),
  }
}

type TriggerService = 'slash' | 'inputTriggers'

/** One pre-existing reference chip the composer shell machine starts with. */
interface ChipSpec {
  source: string
  ref: string
  label: string
  clipboardText: string
}

/**
 * Faithful stand-in for the composer shell DSH 0.1.5-rc.1+ actually ships:
 * the published draft and occurrence offsets stay in clipboard coordinates
 * (each chip expands to its full clipboard text), while the insertion verbs
 * (`insertText`/`insertReference`) take detect-coordinate spans where a chip
 * occupies exactly one character, guarded by the revision CAS, and the host
 * appends one separating space after every inserted chip unless one already
 * follows. `caretSpan` and `focus` exist only on this shell face — their
 * presence is how the plugin tells the two composer generations apart.
 */
function composerShellMachine(parts: Array<string | ChipSpec> = []) {
  let draft = ''
  const seeded: Occurrence[] = []
  let occurrenceId = 0
  for (const part of parts) {
    if (typeof part === 'string') {
      draft += part
      continue
    }
    occurrenceId += 1
    seeded.push({
      occurrenceId,
      source: part.source,
      ref: part.ref,
      offset: draft.length,
      length: part.clipboardText.length,
      label: part.label,
      clipboardText: part.clipboardText,
    })
    draft += part.clipboardText
  }
  let state = {
    draft,
    draftRev: 0,
    phase: 'plain' as const,
    attachmentIds: [] as string[],
    occurrences: [...seeded] as Occurrence[],
    queue: [],
  }
  const listeners = new Set<() => void>()
  const publish = (next: typeof state) => {
    state = next
    for (const listener of listeners) listener()
  }
  /** Clipboard projection: every chip expands to its clipboard text. */
  const detectTextOf = (): string => {
    let text = ''
    let at = 0
    for (const occurrence of state.occurrences) {
      text += state.draft.slice(at, occurrence.offset) + '\uFFFC'
      at = occurrence.offset + (occurrence.length ?? 1)
    }
    return text + state.draft.slice(at)
  }
  /** Inverse projection: one detect boundary to its clipboard twin (chips snap to their end). */
  const clipboardOfDetect = (detectOffset: number): number => {
    let dd = 0
    let cc = 0
    for (const occurrence of state.occurrences) {
      const length = occurrence.length ?? 1
      const textBefore = occurrence.offset - cc
      if (detectOffset <= dd + textBefore) return cc + (detectOffset - dd)
      if (detectOffset <= dd + textBefore + 1) return occurrence.offset + length
      dd += textBefore + 1
      cc = occurrence.offset + length
    }
    return cc + (detectOffset - dd)
  }
  let caret = detectTextOf().length
  let insertCalls = 0
  let failInsertAt: number | undefined
  return {
    state: {
      getSnapshot: () => state,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    caretSpan: vi.fn(() => ({ start: caret, end: caret })),
    focus: vi.fn(),
    setCaret: (at: number) => {
      caret = at
    },
    /** Test hook: make the Nth insertReference call (1-based) fail like a lost revision CAS. */
    failInsertReferenceOnCall: (nth: number) => {
      failInsertAt = nth
    },
    insertReference: vi.fn((reference: Omit<Occurrence, 'occurrenceId' | 'offset' | 'length'>, span: { start: number; end: number; draftRev: number }) => {
      insertCalls += 1
      if (failInsertAt === insertCalls) return false
      if (span.draftRev !== state.draftRev || span.start > span.end) return false
      const cs = clipboardOfDetect(span.start)
      const ce = clipboardOfDetect(span.end)
      const chipText = reference.clipboardText
      // Host tail rule: one separating space unless one already follows.
      const added = detectTextOf().slice(span.end, span.end + 1) === ' ' ? '' : ' '
      const inserted = chipText + added
      occurrenceId += 1
      const occurrence: Occurrence = {
        occurrenceId,
        source: reference.source,
        ref: reference.ref,
        offset: cs,
        length: chipText.length,
        label: reference.label,
        clipboardText: reference.clipboardText,
      }
      const shifted = state.occurrences.flatMap((row) => {
        const end = row.offset + (row.length ?? 1)
        if (end <= cs) return [row]
        if (row.offset >= ce) return [{ ...row, offset: row.offset + inserted.length - (ce - cs) }]
        return []
      })
      publish({
        ...state,
        draft: state.draft.slice(0, cs) + inserted + state.draft.slice(ce),
        draftRev: state.draftRev + 1,
        occurrences: [...shifted, occurrence].sort((a, b) => a.offset - b.offset),
      })
      caret = span.start + 1 + (added === ' ' ? 1 : 0)
      return true
    }),
    insertText: vi.fn((text: string, span: { start: number; end: number; draftRev: number }) => {
      if (span.draftRev !== state.draftRev || span.start > span.end) return false
      const cs = clipboardOfDetect(span.start)
      const ce = clipboardOfDetect(span.end)
      const delta = text.length - (ce - cs)
      const occurrences = state.occurrences.flatMap((row) => {
        const end = row.offset + (row.length ?? 1)
        if (end <= cs || row.offset >= ce) {
          if (row.offset >= ce) return [{ ...row, offset: row.offset + delta }]
          return [row]
        }
        return []
      })
      publish({
        ...state,
        draft: state.draft.slice(0, cs) + text + state.draft.slice(ce),
        draftRev: state.draftRev + 1,
        occurrences,
      })
      caret = span.start + text.length
      return true
    }),
    setDraft: vi.fn((text: string) => {
      publish({ ...state, draft: text, draftRev: state.draftRev + 1, occurrences: [] })
    }),
    addAttachments: vi.fn(() => true),
    notify: vi.fn(),
  }
}

/** Benches still holding document-level listeners; afterEach sweeps failed tests' leaks. */
const liveBenches: Array<ReturnType<typeof fakeClient>> = []

function fakeClient(
  initial = '',
  triggerServices: readonly TriggerService[] = ['slash'],
  aliasTriggers = false,
  referenceDraftMode: ReferenceDraftMode = 'placeholder',
  options: {
    /** Install a composer-shell machine instead of the textarea stand-in. */
    input?: ReturnType<typeof composerShellMachine>
    /** Publish the 0.2.0-rc Session list face (no `current` field). */
    modernList?: boolean
  } = {},
) {
  const input = options.input ?? inputMachine(initial, referenceDraftMode)
  const effects: Array<() => void> = []
  const registrations: Array<{
    options: Record<string, unknown>
    component: ComponentType<Record<string, unknown>>
  }> = []
  let source: ReturnType<PasteImageController['source']> | undefined
  const createTriggerRegistry = () => {
    const dispose = vi.fn(() => { source = undefined })
    return {
      dispose,
      registerSource: vi.fn((next: ReturnType<PasteImageController['source']>) => {
        source = next
        return dispose
      }),
    }
  }
  const triggerRegistries = {
    slash: createTriggerRegistry(),
    inputTriggers: createTriggerRegistry(),
  }
  const ctx: Record<string, unknown> = {
    sessions: {
      list: { getSnapshot: () => options.modernList === true ? { byId: {} } : { current: 'session-1', byId: {} } },
      scope: () => ({}),
    },
    conversation: { input: { for: () => input } },
    slots: {
      inject: vi.fn((_name: string, callback: () => unknown) => { callback() }),
      register: vi.fn((options: Record<string, unknown>, component: ComponentType<Record<string, unknown>>) => {
        registrations.push({ options, component })
        return () => {}
      }),
    },
    effect: vi.fn((setup: () => void | (() => void)) => {
      const dispose = setup()
      if (typeof dispose === 'function') effects.push(dispose)
    }),
  }
  ctx.get = (key: string) => ctx[key]
  for (const service of triggerServices) {
    ctx[service] = aliasTriggers ? triggerRegistries.slash : triggerRegistries[service]
  }
  ctx.inject = vi.fn((services: string[], callback: (scope: typeof ctx) => void) => {
    if (services.every(service => ctx[service] !== undefined)) callback(ctx)
  })
  installPasteImages(ctx as never)
  const bench = {
    ctx,
    input,
    registrations,
    source: () => source,
    triggerRegistries,
    disposeEffect: (index: number) => {
      const dispose = effects[index]
      if (dispose === undefined) return
      effects[index] = () => {}
      dispose()
    },
    dispose: () => {
      const at = liveBenches.indexOf(bench)
      if (at >= 0) liveBenches.splice(at, 1)
      effects.reverse().forEach(fn => { fn() })
    },
  }
  liveBenches.push(bench)
  return bench
}

function file(name: string, type: string, bytes: number[]): File {
  const value = new File([Uint8Array.from(bytes)], name, { type })
  Object.defineProperty(value, 'arrayBuffer', { value: async () => Uint8Array.from(bytes).buffer })
  return value
}

function clipboardEvent(text: string, files: File[]): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  const data = {
    items: files.map(value => ({ kind: 'file', type: value.type, getAsFile: () => value })),
    files,
    getData: (type: string) => type === 'text/plain' ? text : '',
  }
  Object.defineProperty(event, 'clipboardData', { value: data })
  return event
}

function composer(): HTMLTextAreaElement {
  const card = document.createElement('div')
  card.dataset.composerCard = ''
  const textarea = document.createElement('textarea')
  card.appendChild(textarea)
  document.body.appendChild(card)
  return textarea
}

function policyResponse(takeOver: boolean, autoSwitch?: { provider: string; model: string; label: string; reasoningEffort?: string }): Response {
  return new Response(JSON.stringify({
    ok: true,
    value: { takeOver, ...(autoSwitch === undefined ? {} : { autoSwitch }) },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Wrap an upload fetch mock so host verdict re-asks short-circuit before any
 * upload assertion (every paste refreshes the verdict).
 */
function uploadMock(handle: (url: string, init: RequestInit) => Promise<Response>): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith('/_dsh/vision-toolkit/paste-policy')) return policyResponse(true)
    return handle(url, init ?? ({} as RequestInit))
  })
}

/** Upload-only calls of a fetch mock, excluding verdict re-asks. */
function uploadsOf(mock: ReturnType<typeof vi.fn>): Array<[string, RequestInit]> {
  return mock.mock.calls.filter(([url]) => !String(url).includes('paste-policy')) as Array<[string, RequestInit]>
}

/**
 * Seed a confirmed host verdict, the way a focus into the composer does.
 * Runs the policy fetch under its own stub, then restores the global fetch so
 * the test can stub the upload route next.
 */
async function confirmTakeover(bench: ReturnType<typeof fakeClient>): Promise<void> {
  const policy = vi.fn(async () => policyResponse(true))
  vi.stubGlobal('fetch', policy)
  document.dispatchEvent(new Event('focusin'))
  await vi.waitFor(() => { expect(policy).toHaveBeenCalledTimes(1) })
  // Let the response microtasks settle into the verdict cache.
  await new Promise(resolve => setTimeout(resolve, 0))
  vi.unstubAllGlobals()
}

/** The paste controller behind the registered dock, for confirm interactions. */
function controllerOf(bench: ReturnType<typeof fakeClient>): PasteImageController {
  const dock = bench.registrations.find(row => row.options.id === 'vision-toolkit-pasted-images')
  if (dock === undefined) throw new Error('paste dock was not registered')
  const injected = (dock.options.inject as ((sessionId: string) => {
    controller: PasteImageController
    remove: (row: Occurrence) => void
  }))('session-1')
  return injected.controller
}

/** Dispatch the paste and confirm the attach dialog in one step. */
function pasteAndConfirm(bench: ReturnType<typeof fakeClient>, textarea: HTMLTextAreaElement, event: ClipboardEvent): void {
  textarea.dispatchEvent(event)
  const controller = controllerOf(bench)
  if (controller.confirmState() === undefined) throw new Error('paste did not open the attach confirmation')
  controller.confirmAttach(false)
}

afterEach(() => {
  document.body.replaceChildren()
  // A failed assertion can skip a bench's own dispose(); without this sweep
  // its document-level paste/focusin listeners leak into the next test and
  // cascade one failure into many.
  while (liveBenches.length > 0) {
    liveBenches[liveBenches.length - 1]?.dispose()
  }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('clipboard image client', () => {
  it('uses the exact Web routes registered by the server', () => {
    expect(CLIENT_PASTE_IMAGES_ROUTE).toBe(SERVER_PASTE_IMAGES_ROUTE)
    expect(PASTE_POLICY_ROUTE).toBe(SERVER_PASTE_POLICY_ROUTE)
  })

  it('registers the reference codec through the legacy inputTriggers service', () => {
    const bench = fakeClient('', ['inputTriggers'])
    expect(bench.source()?.name).toBe('vision-toolkit-pasted-image')
    expect(bench.ctx.inject).toHaveBeenCalledWith(['slash'], expect.any(Function))
    expect(bench.ctx.inject).toHaveBeenCalledWith(['inputTriggers'], expect.any(Function))
    bench.dispose()
  })

  it('registers both distinct trigger-service generations in a transitional runtime', () => {
    const bench = fakeClient('', ['slash', 'inputTriggers'])
    expect(bench.triggerRegistries.slash.registerSource).toHaveBeenCalledTimes(1)
    expect(bench.triggerRegistries.inputTriggers.registerSource).toHaveBeenCalledTimes(1)
    bench.dispose()
  })

  it('registers once when a compatibility adapter aliases both service names', () => {
    const bench = fakeClient('', ['slash', 'inputTriggers'], true)
    expect(bench.triggerRegistries.slash.registerSource).toHaveBeenCalledTimes(1)
    expect(bench.triggerRegistries.inputTriggers.registerSource).not.toHaveBeenCalled()
    bench.disposeEffect(0)
    expect(bench.source()?.name).toBe('vision-toolkit-pasted-image')
    expect(bench.triggerRegistries.slash.dispose).not.toHaveBeenCalled()
    bench.disposeEffect(1)
    expect(bench.source()).toBeUndefined()
    expect(bench.triggerRegistries.slash.dispose).toHaveBeenCalledTimes(1)
    bench.dispose()
  })

  it('keeps an aliased registry live across real Cordis service removal and re-provision', async () => {
    const ctx = new Context()
    const unregister = vi.fn()
    const registerSource = vi.fn(() => unregister)
    class TriggerRegistryService extends Service {
      constructor(serviceCtx: Context) {
        super(serviceCtx, 'inputTriggers')
      }

      registerSource(): () => void {
        return registerSource()
      }
    }
    const mountAdapter = async () => {
      const fiber = ctx.plugin({
        inject: ['inputTriggers'],
        apply(scope: Context) {
          scope.provide('slash', (scope as Context & { inputTriggers: TriggerRegistryService }).inputTriggers)
        },
      })
      await fiber.await()
      return fiber
    }
    ctx.provide('sessions', {
      list: { getSnapshot: () => ({ current: 'session-1' }) },
      scope: () => ({}),
    })
    ctx.provide('conversation', { input: { for: () => inputMachine() } })
    ctx.provide('slots', {
      inject: (_name: string, callback: () => unknown) => { callback() },
      register: () => () => {},
    })
    let providerFiber = ctx.plugin(TriggerRegistryService)
    await providerFiber.await()
    let adapterFiber = await mountAdapter()
    const pasteFiber = ctx.plugin({ apply: scope => { installPasteImages(scope as never) } })
    await pasteFiber.await()
    await vi.waitFor(() => { expect(registerSource).toHaveBeenCalledTimes(1) })

    await adapterFiber.dispose()
    expect(unregister).not.toHaveBeenCalled()
    adapterFiber = await mountAdapter()
    expect(registerSource).toHaveBeenCalledTimes(1)

    await providerFiber.dispose()
    await vi.waitFor(() => { expect(unregister).toHaveBeenCalledTimes(1) })

    providerFiber = ctx.plugin(TriggerRegistryService)
    await providerFiber.await()
    await vi.waitFor(() => { expect(registerSource).toHaveBeenCalledTimes(2) })
    await adapterFiber.dispose()
    expect(unregister).toHaveBeenCalledTimes(1)
    await providerFiber.dispose()
    await vi.waitFor(() => { expect(unregister).toHaveBeenCalledTimes(2) })
    await pasteFiber.dispose()
  })

  it('preserves pasted text, inserts every image as a text reference, and blocks the native ImageBlock path', async () => {
    const bench = fakeClient('prefix ')
    await confirmTakeover(bench)
    const textarea = composer()
    textarea.value = 'prefix '
    textarea.setSelectionRange(7, 7)
    const nativePaste = vi.fn()
    textarea.addEventListener('paste', nativePaste)
    let uploads = 0
    const request = uploadMock(async (_url, init) => {
      expect(init.body).toBeInstanceOf(File)
      const index = uploads
      uploads += 1
      return new Response(JSON.stringify({
        ok: true,
        value: { absolutePath: index === 0
          ? '/workspace/.dsh-vision-toolkit/tmp/pasted-images/a/image-01.png'
          : '/workspace/.dsh-vision-toolkit/tmp/pasted-images/a/image-02.webp' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', request)

    const event = clipboardEvent('caption\uFFFC', [
      file('one.png', 'image/png', [1]),
      file('notes.txt', 'text/plain', [9]),
      file('two.webp', 'image/webp', [2, 3]),
    ])
    pasteAndConfirm(bench, textarea, event)

    expect(event.defaultPrevented).toBe(true)
    expect(nativePaste).not.toHaveBeenCalled()
    expect(bench.input.state.getSnapshot().draft).toContain('prefix caption')
    expect(bench.input.state.getSnapshot().draft.match(/\uFFFC/gu)).toHaveLength(2)
    expect(bench.input.state.getSnapshot().occurrences).toHaveLength(2)
    expect(bench.input.state.getSnapshot().attachmentIds).toEqual([])

    const codec = bench.source()?.codec
    if (codec === undefined) throw new Error('paste source was not registered')
    const refs = bench.input.state.getSnapshot().occurrences.map(row => row.ref)
    const serialized = await Promise.all(refs.map(ref => codec.serialize(ref, new AbortController().signal)))
    expect(uploads).toBe(2)
    expect(uploadsOf(request).every(([url]) => String(url).startsWith('/_dsh/vision-toolkit/paste-images?'))).toBe(true)
    expect(serialized).toEqual([
      '[Pasted image available at absolute path: "/workspace/.dsh-vision-toolkit/tmp/pasted-images/a/image-01.png"]',
      '[Pasted image available at absolute path: "/workspace/.dsh-vision-toolkit/tmp/pasted-images/a/image-02.webp"]',
    ])
    bench.dispose()
  })

  it.each([
    {
      name: 'the legacy one-character placeholder draft',
      mode: 'placeholder' as const,
      files: [file('one.png', 'image/png', [1]), file('two.webp', 'image/webp', [2])],
      expectedDraft: '\uFFFC \uFFFC ',
      expectedCaret: 3,
    },
    {
      name: 'the rc.8+ display-text draft',
      mode: 'display-text' as const,
      files: [file('one.png', 'image/png', [1]), file('two.webp', 'image/webp', [2])],
      expectedDraft: '@one.png @two.webp ',
      expectedCaret: 18,
    },
  ])('places every reference and the final caret correctly with $name', async ({ mode, files, expectedDraft, expectedCaret }) => {
    const bench = fakeClient('', ['slash'], false, mode)
    await confirmTakeover(bench)
    const textarea = composer()

    pasteAndConfirm(bench, textarea, clipboardEvent('', files))

    const snapshot = bench.input.state.getSnapshot()
    expect(snapshot.draft).toBe(expectedDraft)
    expect(snapshot.occurrences).toHaveLength(2)
    textarea.value = snapshot.draft
    await vi.waitFor(() => {
      expect(textarea.selectionStart).toBe(expectedCaret)
      expect(textarea.selectionEnd).toBe(expectedCaret)
    })
    bench.dispose()
  })

  it('ignores non-image clipboard files so ordinary text paste remains native', () => {
    const bench = fakeClient('before ')
    const textarea = composer()
    const nativePaste = vi.fn()
    textarea.addEventListener('paste', nativePaste)
    const event = clipboardEvent('plain text', [file('notes.txt', 'text/plain', [1])])

    textarea.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(nativePaste).toHaveBeenCalledTimes(1)
    expect(bench.input.state.getSnapshot().draft).toBe('before ')
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])
    bench.dispose()
  })

  it('preserves same-paste text when image admission fails', async () => {
    const bench = fakeClient('before ')
    await confirmTakeover(bench)
    const textarea = composer()
    textarea.value = 'before '
    textarea.setSelectionRange(7, 7)
    const images = Array.from({ length: 21 }, (_, index) => file(`${index}.png`, 'image/png', [index]))
    const event = clipboardEvent('caption', images)

    pasteAndConfirm(bench, textarea, event)

    expect(event.defaultPrevented).toBe(true)
    expect(bench.input.state.getSnapshot().draft).toBe('before caption')
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])
    expect(bench.input.notify).toHaveBeenCalledWith('error', 'Paste at most 20 images at a time')
    bench.dispose()
  })

  it('removes references through insertText so later occurrence offsets stay current', async () => {
    const bench = fakeClient('')
    await confirmTakeover(bench)
    const textarea = composer()
    pasteAndConfirm(bench, textarea, clipboardEvent('', [
      file('one.png', 'image/png', [1]),
      file('two.png', 'image/png', [2]),
      file('three.png', 'image/png', [3]),
    ]))
    const dock = bench.registrations.find(row => row.options.id === 'vision-toolkit-pasted-images')
    if (dock === undefined) throw new Error('paste dock was not registered')
    const injected = (dock.options.inject as ((sessionId: string) => {
      controller: PasteImageController
      remove: (row: Occurrence) => void
    }))('session-1')
    const original = bench.input.state.getSnapshot().occurrences
    const first = original[0]
    if (first === undefined) throw new Error('first occurrence was not inserted')
    const firstRev = bench.input.state.getSnapshot().draftRev

    injected.remove(first)

    expect(bench.input.insertText).toHaveBeenLastCalledWith('', {
      start: first.offset,
      end: first.offset + 1,
      draftRev: firstRev,
    })
    const afterFirst = bench.input.state.getSnapshot().occurrences
    expect(afterFirst.map(row => row.ref)).toEqual(original.slice(1).map(row => row.ref))
    expect(afterFirst.map(row => row.offset)).toEqual([1, 3])

    const staleLater = original[2]
    const currentLater = afterFirst[1]
    if (staleLater === undefined || currentLater === undefined) throw new Error('later occurrence was not retained')
    const laterRev = bench.input.state.getSnapshot().draftRev
    injected.remove(staleLater)

    expect(bench.input.insertText).toHaveBeenLastCalledWith('', {
      start: currentLater.offset,
      end: currentLater.offset + 1,
      draftRev: laterRev,
    })
    expect(bench.input.state.getSnapshot().occurrences.map(row => row.ref)).toEqual([original[1]?.ref])
    expect(injected.controller.recordsFor(original)).toHaveLength(1)
    bench.dispose()
  })

  it('removes the complete rc.8+ display-text reference instead of only its @ marker', async () => {
    const bench = fakeClient('', ['slash'], false, 'display-text')
    await confirmTakeover(bench)
    const textarea = composer()
    pasteAndConfirm(bench, textarea, clipboardEvent('', [file('one.png', 'image/png', [1])]))
    const dock = bench.registrations.find(row => row.options.id === 'vision-toolkit-pasted-images')
    if (dock === undefined) throw new Error('paste dock was not registered')
    const injected = (dock.options.inject as ((sessionId: string) => {
      controller: PasteImageController
      remove: (row: Occurrence) => void
    }))('session-1')
    const occurrence = bench.input.state.getSnapshot().occurrences[0]
    if (occurrence === undefined || occurrence.length === undefined) throw new Error('display-text occurrence was not inserted')
    const revision = bench.input.state.getSnapshot().draftRev

    injected.remove(occurrence)

    expect(bench.input.insertText).toHaveBeenLastCalledWith('', {
      start: occurrence.offset,
      end: occurrence.offset + occurrence.length,
      draftRev: revision,
    })
    expect(bench.input.state.getSnapshot().draft).toBe(' ')
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])
    expect(injected.controller.recordsFor([occurrence])).toEqual([])
    bench.dispose()
  })

  it('retains a pasted image record when the occurrence-aware removal is rejected', async () => {
    const bench = fakeClient('')
    await confirmTakeover(bench)
    const textarea = composer()
    pasteAndConfirm(bench, textarea, clipboardEvent('', [file('one.png', 'image/png', [1])]))
    const dock = bench.registrations.find(row => row.options.id === 'vision-toolkit-pasted-images')
    if (dock === undefined) throw new Error('paste dock was not registered')
    const injected = (dock.options.inject as ((sessionId: string) => {
      controller: PasteImageController
      remove: (row: Occurrence) => void
    }))('session-1')
    const occurrence = bench.input.state.getSnapshot().occurrences[0]
    if (occurrence === undefined) throw new Error('paste occurrence was not inserted')
    bench.input.insertText.mockReturnValueOnce(false)

    injected.remove(occurrence)

    expect(bench.input.state.getSnapshot().occurrences).toEqual([occurrence])
    expect(injected.controller.recordsFor([occurrence])).toHaveLength(1)
    bench.dispose()
  })

  it('reuses successful workspace paths and retries only records still missing a path', async () => {
    const bench = fakeClient('')
    await confirmTakeover(bench)
    const textarea = composer()
    let secondAttempts = 0
    const request = uploadMock(async (url) => {
      const name = new URL(String(url), 'http://localhost').searchParams.get('name')
      if (name === 'one.png') {
        return new Response(JSON.stringify({
          ok: true,
          value: { absolutePath: '/workspace/.dsh-vision-toolkit/tmp/pasted-images/a/stable-one.png' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      secondAttempts += 1
      if (secondAttempts === 1) {
        return new Response(JSON.stringify({
          ok: false,
          error: { message: 'second copy failed' },
        }), { status: 409, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        ok: true,
        value: { absolutePath: '/workspace/.dsh-vision-toolkit/tmp/pasted-images/a/retried-two.png' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', request)
    pasteAndConfirm(bench, textarea, clipboardEvent('', [
      file('one.png', 'image/png', [1]),
      file('two.png', 'image/png', [2]),
    ]))
    const occurrences = bench.input.state.getSnapshot().occurrences
    const first = occurrences[0]
    const second = occurrences[1]
    if (first === undefined || second === undefined) throw new Error('paste occurrences were not inserted')
    const codec = bench.source()?.codec
    if (codec === undefined) throw new Error('paste source was not registered')

    await expect(codec.serialize(first.ref, new AbortController().signal)).rejects.toThrow('second copy failed')
    expect(uploadsOf(request)).toHaveLength(2)

    const secondText = await codec.serialize(second.ref, new AbortController().signal)
    expect(uploadsOf(request)).toHaveLength(3)
    const names = uploadsOf(request).map(([url]) => new URL(String(url), 'http://localhost').searchParams.get('name'))
    expect(names).toEqual(['one.png', 'two.png', 'two.png'])
    expect(secondText).toBe('[Pasted image available at absolute path: "/workspace/.dsh-vision-toolkit/tmp/pasted-images/a/retried-two.png"]')

    const firstText = await codec.serialize(first.ref, new AbortController().signal)
    expect(uploadsOf(request)).toHaveLength(3)
    expect(firstText).toBe('[Pasted image available at absolute path: "/workspace/.dsh-vision-toolkit/tmp/pasted-images/a/stable-one.png"]')
    bench.dispose()
  })

  it('keeps failed serialization out of the model send and exposes retry/removal feedback', async () => {
    const bench = fakeClient('')
    await confirmTakeover(bench)
    const textarea = composer()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      error: { message: 'workspace copy failed' },
    }), { status: 409, headers: { 'Content-Type': 'application/json' } })))
    pasteAndConfirm(bench, textarea, clipboardEvent('', [file('broken.png', 'image/png', [1])]))
    const occurrence = bench.input.state.getSnapshot().occurrences[0]
    if (occurrence === undefined) throw new Error('paste occurrence was not inserted')
    const codec = bench.source()?.codec
    if (codec === undefined) throw new Error('paste source was not registered')
    const modelSink = vi.fn()
    const send = async () => { modelSink(await codec.serialize(occurrence.ref, new AbortController().signal)) }

    await expect(send()).rejects.toThrow('workspace copy failed')
    expect(modelSink).not.toHaveBeenCalled()
    const dock = bench.registrations.find(row => row.options.id === 'vision-toolkit-pasted-images')
    expect(dock).toBeDefined()

    const injected = (dock?.options.inject as ((sessionId: string) => { controller: PasteImageController; remove: (row: Occurrence) => void }))('session-1')
    const controller = injected.controller
    expect(controller.recordsFor([occurrence])[0]?.status).toBe('error')
    if (dock === undefined) throw new Error('paste dock was not registered')
    render(createElement(dock.component, { input: bench.input.state.getSnapshot(), ...injected }))
    expect(screen.getByText('broken.png')).toBeTruthy()
    expect(screen.getByText('workspace copy failed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove broken.png' }))
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])
    expect(controller.recordsFor([occurrence])).toEqual([])
    bench.dispose()
  })

  it('prefetches the paste verdict when the composer gains focus', async () => {
    const bench = fakeClient('')
    const policy = vi.fn(async () => policyResponse(true))
    vi.stubGlobal('fetch', policy)
    document.dispatchEvent(new Event('focusin'))
    await vi.waitFor(() => { expect(policy).toHaveBeenCalledTimes(1) })
    expect(String(policy.mock.calls[0]?.[0])).toContain('paste-policy')
    expect(String(policy.mock.calls[0]?.[0])).toContain(encodeURIComponent('session-1'))
    bench.dispose()
  })

  it('leaves pastes native while the host verdict is unconfirmed', async () => {
    const bench = fakeClient('')
    // A pending policy response: the safe default is the native flow, so the
    // first paste on a text-only model keeps its ordinary admission error.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    const textarea = composer()
    const nativePaste = vi.fn()
    textarea.addEventListener('paste', nativePaste)
    textarea.dispatchEvent(clipboardEvent('', [file('one.png', 'image/png', [1])]))

    expect(textarea.value).toBe('')
    expect(nativePaste).toHaveBeenCalledTimes(1)
    bench.dispose()
  })

  it('leaves pastes native when the host confirms an image-capable model', async () => {
    const bench = fakeClient('')
    vi.stubGlobal('fetch', vi.fn(async () => policyResponse(false)))
    document.dispatchEvent(new Event('focusin'))
    await new Promise(resolve => setTimeout(resolve, 0))
    const textarea = composer()
    const nativePaste = vi.fn()
    textarea.addEventListener('paste', nativePaste)
    textarea.dispatchEvent(clipboardEvent('', [file('one.png', 'image/png', [1])]))

    expect(textarea.value).toBe('')
    expect(nativePaste).toHaveBeenCalledTimes(1)
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])
    bench.dispose()
  })

  it('keeps pastes native while the policy route is down, then recovers on the next focus', async () => {
    const bench = fakeClient('')
    const policySpy = vi.fn(async () => new Response('not found', { status: 404 }))
    vi.stubGlobal('fetch', policySpy)
    document.dispatchEvent(new Event('focusin'))
    await new Promise(resolve => setTimeout(resolve, 0))
    const textarea = composer()
    const nativePaste = vi.fn()
    textarea.addEventListener('paste', nativePaste)
    textarea.dispatchEvent(clipboardEvent('', [file('one.png', 'image/png', [1])]))
    // The paste re-asks and gets the same 404: native, no reference inserted.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(nativePaste).toHaveBeenCalledTimes(1)
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])
    expect(policySpy).toHaveBeenCalledTimes(2)
    // The route comes back: the next focus re-asks instead of standing down
    // for the page lifetime, and the following paste is taken over.
    policySpy.mockResolvedValue(policyResponse(true))
    document.dispatchEvent(new Event('focusin'))
    await vi.waitFor(() => { expect(policySpy).toHaveBeenCalledTimes(3) })
    // Let the recovered verdict land before pasting.
    await new Promise(resolve => setTimeout(resolve, 0))
    const nativeAfter = vi.fn()
    textarea.addEventListener('paste', nativeAfter)
    pasteAndConfirm(bench, textarea, clipboardEvent('', [file('two.png', 'image/png', [2])]))
    expect(nativeAfter).not.toHaveBeenCalled()
    expect(bench.input.state.getSnapshot().occurrences).toHaveLength(1)
    bench.dispose()
  })

  it('keeps the paste native when the host vetoes the variant label', async () => {
    const bench = fakeClient('')
    const policy = vi.fn(async (url: string) => {
      const label = new URL(String(url), 'http://localhost').searchParams.get('model') ?? ''
      return policyResponse(!label.includes('(Vision Toolkit)'))
    })
    vi.stubGlobal('fetch', policy)
    const selector = document.createElement('button')
    selector.setAttribute('aria-label', 'Select model, current DeepSeek V4 Flash')
    document.body.appendChild(selector)
    document.dispatchEvent(new Event('focusin'))
    await vi.waitFor(() => { expect(policy).toHaveBeenCalledTimes(1) })
    await new Promise(resolve => setTimeout(resolve, 0))
    const textarea = composer()
    const nativePaste = vi.fn()
    textarea.addEventListener('paste', nativePaste)
    pasteAndConfirm(bench, textarea, clipboardEvent('', [file('one.png', 'image/png', [1])]))
    expect(nativePaste).not.toHaveBeenCalled()
    // Switching to the image-input variant: the host vetoes the takeover and
    // the paste goes native — no reference, no prevented default.
    selector.setAttribute('aria-label', 'Select model, current DeepSeek V4 Flash (Vision Toolkit)')
    document.dispatchEvent(new Event('focusin'))
    // The switch is asked at least once under the new label (the takeover's
    // focus() may prefetch once more; only the ask under the variant label
    // matters).
    await vi.waitFor(() => {
      expect(policy.mock.calls.some(([url]) =>
        new URL(String(url), 'http://localhost').searchParams.get('model')?.includes('(Vision Toolkit)') === true)).toBe(true)
    })
    // Let the veto response land before pasting, so the native path is the
    // host's verdict, not the unconfirmed default.
    await new Promise(resolve => setTimeout(resolve, 0))
    const nativeAgain = vi.fn()
    textarea.addEventListener('paste', nativeAgain)
    textarea.dispatchEvent(clipboardEvent('', [file('two.png', 'image/png', [2])]))
    expect(nativeAgain).toHaveBeenCalledTimes(1)
    expect(bench.input.state.getSnapshot().occurrences).toHaveLength(1)
    selector.remove()
    bench.dispose()
  })

  it('asks before attaching on a text-only model, keeps the model, and attaches after confirmation', async () => {
    const bench = fakeClient('')
    // The live model catalog reports the exact selection; a variant route
    // exists, but the fork must keep the model and attach files for the
    // plugin instead of switching routes.
    const select = vi.fn(async () => {})
    bench.ctx.connection = {
      api: {
        sessions: {
          models: vi.fn(async () => ({
            result: { ok: true, value: { current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } } },
          })),
        },
      },
    }
    bench.ctx.modelDirectories = { directoryFor: vi.fn(() => ({ select })) }
    const policy = vi.fn(async () => policyResponse(false, {
      provider: 'vision-toolkit-deepseek-official',
      model: 'deepseek-v4-flash',
      label: 'DeepSeek V4 Flash (Vision Toolkit)',
    }))
    vi.stubGlobal('fetch', policy)
    document.dispatchEvent(new Event('focusin'))
    await vi.waitFor(() => { expect(policy).toHaveBeenCalledTimes(1) })
    await new Promise(resolve => setTimeout(resolve, 0))

    const textarea = composer()
    const nativePaste = vi.fn()
    textarea.addEventListener('paste', nativePaste)
    const event = clipboardEvent('caption', [
      file('one.png', 'image/png', [1]),
      file('two.webp', 'image/webp', [2, 3]),
    ])
    textarea.dispatchEvent(event)

    // The paste was captured and parked behind the confirmation dialog: no
    // model switch, no references yet, no native admission.
    expect(event.defaultPrevented).toBe(true)
    expect(nativePaste).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])

    const dock = bench.registrations.find(row => row.options.id === 'vision-toolkit-pasted-images')
    if (dock === undefined) throw new Error('paste dock was not registered')
    const injected = (dock.options.inject as ((sessionId: string) => {
      controller: PasteImageController
      remove: (row: Occurrence) => void
    }))('session-1')
    render(createElement(dock.component, { input: bench.input.state.getSnapshot(), ...injected }))

    expect(screen.getByRole('alertdialog', { name: 'Подтверждение вставки' })).toBeTruthy()
    expect(screen.getByText(/Прикрепить image \(2\) для использования плагином Vision Toolkit/u)).toBeTruthy()
    expect(screen.getByLabelText('Больше не показывать в этой сессии')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Прикрепить' }))

    const snapshot = bench.input.state.getSnapshot()
    expect(snapshot.draft).toContain('caption')
    expect(snapshot.occurrences).toHaveLength(2)
    expect(bench.input.state.getSnapshot().attachmentIds).toEqual([])
    expect(select).not.toHaveBeenCalled()
    expect(bench.input.notify).not.toHaveBeenCalledWith('info', expect.anything())
    bench.dispose()
  })

  it('carries the reasoning effort through the policy query', async () => {
    const bench = fakeClient('')
    bench.ctx.connection = {
      api: {
        sessions: {
          models: vi.fn(async () => ({
            result: {
              ok: true,
              value: { current: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' } },
            },
          })),
        },
      },
    }
    const policy = vi.fn(async (url: string) => {
      const query = new URL(String(url), 'http://localhost').searchParams
      expect(query.get('provider')).toBe('deepseek-official')
      expect(query.get('modelId')).toBe('deepseek-v4-flash')
      expect(query.get('reasoningEffort')).toBe('high')
      return policyResponse(true)
    })
    vi.stubGlobal('fetch', policy)
    document.dispatchEvent(new Event('focusin'))
    await vi.waitFor(() => { expect(policy).toHaveBeenCalledTimes(1) })
    bench.dispose()
  })

  it('remembers the session confirmation and attaches later pastes without asking', async () => {
    const bench = fakeClient('')
    await confirmTakeover(bench)
    const textarea = composer()
    const first = clipboardEvent('', [file('one.png', 'image/png', [1])])
    textarea.dispatchEvent(first)
    const controller = controllerOf(bench)
    if (controller.confirmState() === undefined) throw new Error('first paste did not open the dialog')
    controller.confirmAttach(true)
    expect(bench.input.state.getSnapshot().occurrences).toHaveLength(1)

    // The remembered confirmation attaches the next paste immediately.
    const second = clipboardEvent('', [file('two.png', 'image/png', [2])])
    textarea.dispatchEvent(second)
    expect(second.defaultPrevented).toBe(true)
    expect(controller.confirmState()).toBeUndefined()
    expect(bench.input.state.getSnapshot().occurrences).toHaveLength(2)
    bench.dispose()
  })

  it('drops the pending paste when the user cancels the confirmation', async () => {
    const bench = fakeClient('')
    await confirmTakeover(bench)
    const textarea = composer()
    textarea.dispatchEvent(clipboardEvent('', [file('one.png', 'image/png', [1])]))
    const controller = controllerOf(bench)
    if (controller.confirmState() === undefined) throw new Error('paste did not open the dialog')

    controller.cancelConfirm()

    expect(controller.confirmState()).toBeUndefined()
    expect(bench.input.state.getSnapshot().draft).toBe('')
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])
    bench.dispose()
  })

  it('attaches pasted video and documents on an image-capable model', async () => {
    const bench = fakeClient('')
    // The model accepts images natively, but the host composer cannot attach
    // video or documents at all: the paste still routes through the plugin.
    const policy = vi.fn(async () => policyResponse(false))
    vi.stubGlobal('fetch', policy)
    document.dispatchEvent(new Event('focusin'))
    await vi.waitFor(() => { expect(policy).toHaveBeenCalledTimes(1) })
    await new Promise(resolve => setTimeout(resolve, 0))
    const textarea = composer()
    const uploads: Array<[string, RequestInit]> = []
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith('/_dsh/vision-toolkit/paste-policy')) return policyResponse(false)
      uploads.push([url, init ?? ({} as RequestInit)])
      return new Response(JSON.stringify({
        ok: true,
        value: { absolutePath: `/workspace/.dsh-vision-toolkit/tmp/pasted-images/a/clip-${uploads.length}` },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', request)

    textarea.dispatchEvent(clipboardEvent('смотри видео', [
      file('clip.mp4', 'video/mp4', [1, 2, 3]),
      file('report.pdf', 'application/pdf', [4]),
    ]))
    const controller = controllerOf(bench)
    if (controller.confirmState() === undefined) throw new Error('media paste did not open the dialog')
    controller.confirmAttach(false)

    const snapshot = bench.input.state.getSnapshot()
    expect(snapshot.draft).toContain('смотри видео')
    expect(snapshot.occurrences).toHaveLength(2)
    const codec = bench.source()?.codec
    if (codec === undefined) throw new Error('paste source was not registered')
    const refs = snapshot.occurrences.map(row => row.ref)
    const serialized = await Promise.all(refs.map(ref => codec.serialize(ref, new AbortController().signal)))
    expect(serialized).toEqual([
      '[Pasted video available at absolute path: "/workspace/.dsh-vision-toolkit/tmp/pasted-images/a/clip-1"]',
      '[Pasted document available at absolute path: "/workspace/.dsh-vision-toolkit/tmp/pasted-images/a/clip-2"]',
    ])
    expect(uploads.map(([url]) => new URL(String(url), 'http://localhost').searchParams.get('name')))
      .toEqual(['clip.mp4', 'report.pdf'])
    expect(uploads[0]?.[1].headers).toMatchObject({ 'Content-Type': 'video/mp4' })
    expect(uploads[1]?.[1].headers).toMatchObject({ 'Content-Type': 'application/pdf' })
    bench.dispose()
  })
})

describe('clipboard image client (Lexical composer shell)', () => {
  /** The contenteditable DSH actually ships inside the composer card. */
  function contenteditable(): HTMLElement {
    const card = document.createElement('div')
    card.dataset.composerCard = ''
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    card.appendChild(editable)
    document.body.appendChild(card)
    return editable
  }

  /** Seed a confirmed verdict the way focus into a mounted dock does. */
  async function confirmModernTakeover(bench: ReturnType<typeof fakeClient>): Promise<void> {
    // The dock mount publishes the rendered Session id: the focused-session
    // source on hosts whose Session list has no `current`.
    controllerOf(bench)
    await confirmTakeover(bench)
  }

  /** Dispatch the paste onto the contenteditable and confirm the dialog. */
  function pasteAndConfirmModern(bench: ReturnType<typeof fakeClient>, editable: HTMLElement, event: ClipboardEvent): void {
    editable.dispatchEvent(event)
    const controller = controllerOf(bench)
    if (controller.confirmState() === undefined) throw new Error('paste did not open the attach confirmation')
    controller.confirmAttach(false)
  }

  it('inserts pasted text and every file through detect-coordinate spans', async () => {
    const shell = composerShellMachine(['prefix '])
    const bench = fakeClient('', ['slash'], false, 'placeholder', { input: shell, modernList: true })
    await confirmModernTakeover(bench)
    const editable = contenteditable()
    shell.setCaret(7)

    const event = clipboardEvent('caption', [
      file('one.png', 'image/png', [1]),
      file('two.webp', 'image/webp', [2, 3]),
    ])
    pasteAndConfirmModern(bench, editable, event)

    expect(event.defaultPrevented).toBe(true)
    const snapshot = shell.state.getSnapshot()
    expect(snapshot.draft).toBe('prefix caption [pasted image: one.png] [pasted image: two.webp] ')
    expect(snapshot.occurrences.map(row => [row.offset, row.length])).toEqual([[15, 23], [39, 24]])
    expect(shell.insertText).toHaveBeenNthCalledWith(1, 'caption', { start: 7, end: 7, draftRev: 0 })
    expect(shell.insertText).toHaveBeenNthCalledWith(2, ' ', { start: 14, end: 14, draftRev: 1 })
    expect(shell.insertReference).toHaveBeenNthCalledWith(1, expect.objectContaining({ source: 'vision-toolkit-pasted-image' }), { start: 15, end: 15, draftRev: 2 })
    expect(shell.insertReference).toHaveBeenNthCalledWith(2, expect.objectContaining({ source: 'vision-toolkit-pasted-image' }), { start: 17, end: 17, draftRev: 3 })
    await vi.waitFor(() => { expect(shell.focus).toHaveBeenCalled() })
    bench.dispose()
  })

  it('places chips at the caret between pre-existing chips without disturbing them', async () => {
    const shell = composerShellMachine(['AA', { source: 'reference', ref: '@file', label: 'file', clipboardText: '@file' }, 'BB'])
    const bench = fakeClient('', ['slash'], false, 'placeholder', { input: shell, modernList: true })
    await confirmModernTakeover(bench)
    const editable = contenteditable()
    // Caret between the @file chip and the trailing text (detect offset 3).
    shell.setCaret(3)

    pasteAndConfirmModern(bench, editable, clipboardEvent('', [file('one.png', 'image/png', [1])]))

    const snapshot = shell.state.getSnapshot()
    expect(shell.insertText).toHaveBeenNthCalledWith(1, ' ', { start: 3, end: 3, draftRev: 0 })
    expect(shell.insertReference).toHaveBeenNthCalledWith(1, expect.anything(), { start: 4, end: 4, draftRev: 1 })
    expect(snapshot.draft).toBe('AA@file [pasted image: one.png] BB')
    expect(snapshot.occurrences.map(row => [row.ref, row.offset, row.length])).toEqual([
      ['@file', 2, 5],
      [expect.any(String), 8, 23],
    ])
    bench.dispose()
  })

  it('resolves the focused session from the dock injection when the Session list has no current', async () => {
    const shell = composerShellMachine()
    const bench = fakeClient('', ['slash'], false, 'placeholder', { input: shell, modernList: true })
    const editable = contenteditable()
    const nativePaste = vi.fn()
    editable.addEventListener('paste', nativePaste)
    const policy = vi.fn(async () => policyResponse(true))
    vi.stubGlobal('fetch', policy)

    // Without a dock mount there is no focused-session source: the paste
    // stays native and the verdict is never even asked.
    editable.dispatchEvent(clipboardEvent('', [file('one.png', 'image/png', [1])]))
    expect(nativePaste).toHaveBeenCalledTimes(1)
    expect(policy).not.toHaveBeenCalled()
    expect(shell.insertReference).not.toHaveBeenCalled()

    // Mounting the dock publishes the rendered Session; the focus prefetch
    // asks under that id and the next paste is taken over.
    controllerOf(bench)
    document.dispatchEvent(new Event('focusin'))
    await vi.waitFor(() => { expect(policy).toHaveBeenCalledTimes(1) })
    await new Promise(resolve => setTimeout(resolve, 0))
    pasteAndConfirmModern(bench, editable, clipboardEvent('', [file('two.png', 'image/png', [2])]))
    expect(shell.state.getSnapshot().occurrences).toHaveLength(1)
    bench.dispose()
  })

  it('removes one chip through its single detect character', async () => {
    const shell = composerShellMachine()
    const bench = fakeClient('', ['slash'], false, 'placeholder', { input: shell, modernList: true })
    await confirmModernTakeover(bench)
    const editable = contenteditable()
    pasteAndConfirmModern(bench, editable, clipboardEvent('', [
      file('one.png', 'image/png', [1]),
      file('two.png', 'image/png', [2]),
    ]))
    const dock = bench.registrations.find(row => row.options.id === 'vision-toolkit-pasted-images')
    if (dock === undefined) throw new Error('paste dock was not registered')
    const injected = (dock.options.inject as ((sessionId: string) => {
      controller: PasteImageController
      remove: (row: Occurrence) => void
    }))('session-1')
    const original = shell.state.getSnapshot().occurrences
    const first = original[0]
    if (first === undefined) throw new Error('first occurrence was not inserted')
    const revision = shell.state.getSnapshot().draftRev

    injected.remove(first)

    expect(shell.insertText).toHaveBeenLastCalledWith('', { start: 0, end: 1, draftRev: revision })
    const after = shell.state.getSnapshot()
    expect(after.occurrences.map(row => row.ref)).toEqual([original[1]?.ref])
    expect(after.occurrences[0]?.offset).toBe(1)
    expect(injected.controller.recordsFor(original)).toHaveLength(1)
    bench.dispose()
  })

  it('keeps the draft untouched when admission fails on the composer shell', async () => {
    const shell = composerShellMachine(['keep '])
    const bench = fakeClient('', ['slash'], false, 'placeholder', { input: shell, modernList: true })
    await confirmModernTakeover(bench)
    const editable = contenteditable()
    const images = Array.from({ length: 21 }, (_, index) => file(`${index}.png`, 'image/png', [index]))

    pasteAndConfirmModern(bench, editable, clipboardEvent('caption', images))

    const snapshot = shell.state.getSnapshot()
    expect(snapshot.draft).toBe('keep ')
    expect(snapshot.occurrences).toEqual([])
    expect(shell.insertReference).not.toHaveBeenCalled()
    expect(shell.insertText).not.toHaveBeenCalled()
    expect(shell.notify).toHaveBeenCalledWith('error', 'Paste at most 20 images at a time')
    bench.dispose()
  })

  it('rolls back already-inserted chips when the composer changes mid-batch', async () => {
    const shell = composerShellMachine()
    const bench = fakeClient('', ['slash'], false, 'placeholder', { input: shell, modernList: true })
    await confirmModernTakeover(bench)
    const editable = contenteditable()
    // The second reference insertion loses the revision CAS (the composer
    // changed under the pick-time span): the first chip must be rolled back.
    shell.failInsertReferenceOnCall(2)

    pasteAndConfirmModern(bench, editable, clipboardEvent('', [
      file('one.png', 'image/png', [1]),
      file('two.png', 'image/png', [2]),
    ]))

    expect(shell.notify).toHaveBeenCalledWith('error', 'The composer changed before pasted files could be inserted')
    expect(shell.state.getSnapshot().occurrences).toEqual([])
    // The rolled-back chip is gone; the host's separating space remains.
    expect(shell.state.getSnapshot().draft).toBe(' ')
    const controller = controllerOf(bench)
    expect(controller.recordsFor(shell.state.getSnapshot().occurrences)).toEqual([])
    bench.dispose()
  })
})
