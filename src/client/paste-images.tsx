/** Clipboard-only file input for DSH Web: images, video, audio, and documents. */

import { useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

const SOURCE = 'vision-toolkit-pasted-image'
export const PASTE_IMAGES_ROUTE = '/_dsh/vision-toolkit/paste-images'
export const PASTE_POLICY_ROUTE = '/_dsh/vision-toolkit/paste-policy'
const MAX_IMAGES = 20
const MAX_MEDIA_FILES = 8
/** Hard per-image paste ceiling; must match MAX_PASTE_IMAGE_BYTES on the server. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
/** Hard per-media-file paste ceiling; must match MAX_PASTE_MEDIA_BYTES on the server. */
const MAX_MEDIA_BYTES = 100 * 1024 * 1024
const MAX_BATCH_BYTES = 240 * 1024 * 1024
/** A confirmed paste verdict older than this is unknown again, even while a refresh is in flight. */
const VERDICT_MAX_AGE_MS = 15000

/** Media-type prefixes and document types the plugin can paste for the model. */
const PASTEABLE_TYPE_PREFIXES = ['image/', 'video/', 'audio/'] as const
const PASTEABLE_DOCUMENT_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

/** Fallback extension sniffing for clipboard entries without a media type. */
const PASTEABLE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.avif', '.heic', '.heif', '.svg',
  '.mp4', '.m4v', '.webm', '.mkv', '.mov', '.avi', '.3gp',
  '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.opus', '.flac',
  '.pdf', '.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt',
])

function isPasteableFile(file: File): boolean {
  const type = file.type.toLowerCase()
  if (PASTEABLE_TYPE_PREFIXES.some(prefix => type.startsWith(prefix))) return true
  if (PASTEABLE_DOCUMENT_TYPES.has(type)) return true
  const name = file.name.toLowerCase()
  const dot = name.lastIndexOf('.')
  return dot >= 0 && PASTEABLE_EXTENSIONS.has(name.slice(dot))
}

function isImageFile(file: File): boolean {
  return file.type.toLowerCase().startsWith('image/')
    || (file.type === '' && /\.(?:png|jpe?g|gif|webp|bmp|tiff|avif|heic|heif|svg)$/iu.test(file.name.toLowerCase()))
}

/** One pending paste awaiting the user's attach confirmation. */
interface PasteConfirmState {
  sessionId: string
  files: File[]
  text: string
  /** The composer element the paste landed on (textarea or contenteditable), for caret restoration. */
  target: HTMLElement
  /** Labels for the confirm card: what kinds are in the batch. */
  kinds: string[]
}

/**
 * The Client Session registry face this controller reads. DSH 0.1.5 publishes
 * it as `Context.sessions` from `@deepseek-ai/dsh-api-session-controller/client`,
 * whose peer set spans the whole host package graph and therefore cannot be a
 * peer of a Web-only plugin; only these two members are used, so the face is
 * declared structurally instead of importing that package.
 */
interface ClientSessionRegistry {
  /** Resolve the Session-scoped Context; undefined once the Session has closed. */
  scope(sessionId: never): ClientContext | undefined
  /**
   * Live Session list projection. 0.1.5 publishes the focused Session as
   * `current`; 0.2.0-rc hosts moved view selection out of the controller, so
   * `current` is gone there and the dock slot's last injected Session id is
   * the focused-session source instead.
   */
  readonly list: { getSnapshot(): { readonly current?: string | undefined } }
}

/**
 * @param ctx - the browser plugin Context.
 * @returns the host's Session registry through the structural face above.
 */
function sessionRegistry(ctx: ClientContext): ClientSessionRegistry {
  return (ctx as unknown as { readonly sessions: ClientSessionRegistry }).sessions
}

interface PasteRecord {
  ref: string
  file: File
  batch: PasteBatch
  status: 'ready' | 'copying' | 'copied' | 'error'
  error?: string | undefined
  absolutePath?: string | undefined
}

interface PasteBatch {
  sessionId: string
  records: PasteRecord[]
  inflight?: Promise<void> | undefined
  unsubscribe?: (() => void) | undefined
}

/** One model route the host asks the browser to switch to before the native paste flow. */
interface PasteSwitchRoute {
  provider: string
  model: string
  label: string
  reasoningEffort?: string
}

/** A fresh host verdict for one Session and model label. */
interface PasteVerdictValue {
  takeOver: boolean
  autoSwitch?: PasteSwitchRoute
}

interface PasteResponse {
  ok: boolean
  value?: { absolutePath?: string }
  error?: { message?: string }
}

interface PasteOccurrence {
  occurrenceId: number
  source: string
  ref: string
  offset: number
  /** DSH rc.8+ stores the full @label text; older releases used one placeholder. */
  length?: number
  label: string
}

/** Snapshot view of the input state the coordinate helpers read. */
interface PasteInputStateView {
  readonly draft: string
  readonly occurrences: readonly PasteOccurrence[]
}

/**
 * The per-session input face this controller drives. Structurally narrower
 * than the host's published `SessionInput` so both the runtime face and the
 * test stand-ins satisfy it; the Lexical-composer shell additionally carries
 * the detect-coordinate verbs read through {@link ComposerShellExtras}.
 */
interface PasteSessionInput {
  /** Insert one reference chip over a span (revision-CAS'd). */
  insertReference(reference: {
    source: string
    ref: string
    label: string
    clipboardText: string
  }, span: { start: number; end: number; draftRev: number }): boolean
  /** Replace the whole draft. */
  setDraft(text: string): void
  /** Surface a composer notice. */
  notify(level: 'info' | 'error', text: string): void
  readonly state: {
    getSnapshot(): {
      readonly draft: string
      readonly draftRev: number
      readonly phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
      readonly occurrences: readonly PasteOccurrence[]
    }
    subscribe(listener: () => void): () => void
  }
}

/**
 * Lexical-composer shell verbs beyond the published `SessionInput` face: the
 * resident shell satisfies `ComposerKeyboard` structurally, so the members are
 * probed at runtime instead of imported. A textarea-era input answers none of
 * them, which is exactly how the two composer generations are told apart.
 */
interface ComposerShellExtras {
  /** Live selection as a detect-coordinate span; end-of-draft when nothing is selected. */
  caretSpan?(): { start: number; end: number }
  /** Return keyboard focus to the composer with the caret Lexical last held. */
  focus?(): void
  /** Replace one detect-coordinate span with plain text (revision-CAS'd). */
  insertText?(text: string, span: { start: number; end: number; draftRev: number }): boolean
}

/**
 * The shell's plain-text span verb. `insertText` ships on the composer shell
 * but not on the `SessionInput` contract the plugin compiles against, so it
 * is read structurally; an absent face answers false and the caller treats
 * that as a composer change.
 */
function shellInsertText(
  input: PasteSessionInput,
  text: string,
  span: { start: number; end: number; draftRev: number },
): boolean {
  const insert = (input as PasteSessionInput & ComposerShellExtras).insertText
  return typeof insert === 'function' && insert.call(input, text, span) === true
}

/**
 * Whether the input face is a Lexical-composer shell (detect-coordinate
 * spans) rather than a textarea-era machine (single-coordinate spans). The
 * `caretSpan` verb exists only on the composer shell.
 */
function isComposerShell(input: PasteSessionInput): boolean {
  return typeof (input as PasteSessionInput & ComposerShellExtras).caretSpan === 'function'
}

/**
 * Detect projection of one input snapshot: the clipboard draft with every
 * reference chip's clipboard expansion folded to its single detect character.
 * DSH's composer is a Lexical contenteditable whose insertion spans
 * (`insertText`/`insertReference`) address this projection, while the
 * published draft and occurrence offsets stay in clipboard coordinates.
 */
function detectTextOf(state: PasteInputStateView): string {
  let text = ''
  let at = 0
  for (const occurrence of state.occurrences) {
    const end = occurrence.offset + (occurrence.length ?? 1)
    text += state.draft.slice(at, occurrence.offset) + '\uFFFC'
    at = end
  }
  return text + state.draft.slice(at)
}

/**
 * Fold one clipboard-projection boundary to its detect twin, mirroring the
 * host's own `detectOffsetOfClipboardOffset`: a boundary inside a chip snaps
 * to that chip's detect end, and a boundary after a chip subtracts the chip's
 * expansion overhead. Occurrences are published sorted by offset.
 */
function detectOffsetOfClipboardBoundary(state: PasteInputStateView, clipboardOffset: number): number {
  let detect = 0
  let at = 0
  for (const occurrence of state.occurrences) {
    const length = occurrence.length ?? 1
    const end = occurrence.offset + length
    if (clipboardOffset <= occurrence.offset) break
    if (clipboardOffset >= end) {
      detect += (occurrence.offset - at) + 1
      at = end
      continue
    }
    // Inside the chip's expansion: the host snaps to the chip's trailing edge.
    return detect + (occurrence.offset - at) + 1
  }
  return detect + (clipboardOffset - at)
}

type PasteDockProps = PropsRuntime<'conversation.input.dock'> & {
  controller: PasteImageController
  remove: (occurrence: PasteOccurrence) => void
}

interface ReferenceSourceRegistry {
  registerSource: (source: InputTriggerSource) => () => void
}

interface ReferenceSourceRegistration {
  dispose: () => void
  owners: number
}

interface LegacyTriggerContext {
  inputTriggers: ReferenceSourceRegistry
}

interface LegacySlashContext {
  slash: ReferenceSourceRegistry
}

const CORDIS_ORIGINAL = Symbol.for('cordis.original')

function registryIdentity(registry: ReferenceSourceRegistry): object {
  let current: object = registry
  while (true) {
    const original = (current as Record<symbol, unknown>)[CORDIS_ORIGINAL]
    if ((typeof original !== 'object' && typeof original !== 'function') || original === null || original === current) {
      return current
    }
    current = original
  }
}

let fallbackId = 0

function id(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  fallbackId += 1
  return `paste-${Date.now()}-${fallbackId}`
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function pastedFiles(data: DataTransfer | null): File[] {
  if (data === null) return []
  const itemFiles = Array.from(data.items)
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null)
  const candidates = itemFiles.length > 0 ? itemFiles : Array.from(data.files)
  return candidates.filter(isPasteableFile)
}

/**
 * The selector label the model picker currently shows, or '' when none is
 * readable. Matches the host ModelSelect trigger aria-labels ("Select model,
 * current …" / "选择模型，当前 …"); any other label wording falls back to the
 * session-header verdict, which is stale until the next request.
 */
function currentModelLabel(): string {
  const buttons = document.querySelectorAll('button[aria-label]')
  for (const button of buttons) {
    const label = button.getAttribute('aria-label') ?? ''
    if (/select model|current model|选择模型/iu.test(label)) return label
  }
  return ''
}

/** Verdict cache key: the model label is part of the answer, so a switch invalidates it. */
function verdictKey(sessionId: string, modelLabel: string): string {
  return `${sessionId}|${modelLabel}`
}

function validateImages(files: readonly File[]): void {
  const images = files.filter(isImageFile)
  const media = files.filter(file => !isImageFile(file))
  if (images.length > MAX_IMAGES) throw new Error(`Paste at most ${MAX_IMAGES} images at a time`)
  if (media.length > MAX_MEDIA_FILES) throw new Error(`Paste at most ${MAX_MEDIA_FILES} media or document files at a time`)
  let total = 0
  for (const file of files) {
    const cap = isImageFile(file) ? MAX_IMAGE_BYTES : MAX_MEDIA_BYTES
    if (file.size <= 0) throw new Error(`${file.name || 'clipboard item'} is empty`)
    if (file.size > cap) throw new Error(`${file.name || 'clipboard file'} exceeds ${(cap / (1024 * 1024)).toFixed(0)} MB`)
    total += file.size
  }
  if (total > MAX_BATCH_BYTES) throw new Error(`Pasted files exceed ${humanBytes(MAX_BATCH_BYTES)} in total`)
}

/** Human label for one pasted file kind, used in reference text and confirm UI. */
function fileKindLabel(file: File): string {
  const type = file.type.toLowerCase()
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  if (type !== '') return 'document'
  // Clipboard entries can carry an empty media type: fall back to the
  // extension so an empty-typed .mp4 still labels as video.
  const name = file.name.toLowerCase()
  if (/\.(?:mp4|m4v|webm|mkv|mov|avi|3gp)$/u.test(name)) return 'video'
  if (/\.(?:mp3|wav|m4a|aac|ogg|opus|flac)$/u.test(name)) return 'audio'
  if (/\.(?:png|jpe?g|gif|webp|bmp|tiff|avif|heic|heif|svg)$/u.test(name)) return 'image'
  return 'document'
}

async function responseJson(response: Response): Promise<PasteResponse> {
  const body = await response.json() as PasteResponse
  if (!response.ok || body.ok !== true) throw new Error(body.error?.message ?? `Image copy failed (${response.status})`)
  return body
}

function pasteLabel(file: File, index: number): string {
  return file.name.trim() || `clipboard-${fileKindLabel(file)}-${index + 1}`
}

function occurrenceEnd(occurrence: PasteOccurrence): number {
  return occurrence.offset + (occurrence.length ?? 1)
}

/** Owns browser File objects until DSH serializes the corresponding text references. */
export class PasteImageController {
  private readonly records = new Map<string, PasteRecord>()
  private readonly listeners = new Set<() => void>()
  private revision = 0
  private readonly verdicts = new Map<string, {
    takeOver: boolean
    autoSwitch?: PasteSwitchRoute
    at: number
    pending: boolean
  }>()
  /** A paste awaiting the user's attach confirmation, rendered in the dock. */
  private pendingConfirm: PasteConfirmState | undefined
  /** Session-scoped “don't ask again”: later pastes attach immediately. */
  private sessionAttachConfirmed = false
  /**
   * Session id last reported by the dock slot injection. 0.2.0-rc hosts
   * dropped `sessions.list.current`, so the session the dock renders for is
   * the focused-session source there; 0.1.5 keeps `current` authoritative.
   */
  private lastSessionId: string | undefined

  constructor(private readonly ctx: ClientContext) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  snapshot = (): number => this.revision

  private changed(): void {
    this.revision += 1
    for (const listener of this.listeners) listener()
  }

  source(): InputTriggerSource {
    return {
      trigger: '@',
      name: SOURCE,
      order: 1000,
      candidates: () => Promise.resolve([]),
      onPick: () => undefined,
      codec: {
        clipboardText: ref => {
          const record = this.records.get(ref)
          const kind = record === undefined ? 'file' : fileKindLabel(record.file)
          return `[pasted ${kind}: ${record?.file.name ?? ref}]`
        },
        serialize: (ref, signal) => this.serialize(ref, signal),
      },
    }
  }

  recordsFor(occurrences: readonly PasteOccurrence[]): PasteRecord[] {
    return occurrences
      .filter(occurrence => occurrence.source === SOURCE)
      .map(occurrence => this.records.get(occurrence.ref))
      .filter((record): record is PasteRecord => record !== undefined)
  }

  /** Record the Session the dock slot last rendered for (focused-session source on 0.2.0-rc hosts). */
  attachSession(sessionId: string): void {
    this.lastSessionId = sessionId
  }

  /**
   * The Session a composer paste belongs to. 0.1.5 answers from the Session
   * list's focused id; 0.2.0-rc hosts answer from the dock slot's last
   * injection, which follows the rendered conversation.
   */
  private currentSessionId(): string | undefined {
    const current = sessionRegistry(this.ctx).list.getSnapshot().current
    if (current !== undefined) return current
    return this.lastSessionId
  }

  private inputFor(sessionId: string): PasteSessionInput {
    const actx = sessionRegistry(this.ctx).scope(sessionId as never)
    if (actx === undefined) throw new Error('Open a live session before pasting images')
    return (this.ctx.conversation.input.for(actx) as PasteSessionInput)
  }

  private insertText(input: PasteSessionInput, text: string, start: number, end = start): number {
    if (text === '') return start
    const snapshot = input.state.getSnapshot()
    input.setDraft(snapshot.draft.slice(0, start) + text + snapshot.draft.slice(end))
    return start + text.length
  }

  private insertRecords(
    sessionId: string,
    input: PasteSessionInput,
    files: readonly File[],
    cursor: number,
  ): number {
    const batch: PasteBatch = { sessionId, records: [] }
    const draftBeforeReferences = input.state.getSnapshot().draft
    try {
      const before = input.state.getSnapshot().draft.slice(0, cursor)
      if (before !== '' && !/\s$/u.test(before)) cursor = this.insertText(input, ' ', cursor)
      for (const [index, file] of files.entries()) {
        const ref = id()
        const label = pasteLabel(file, index)
        const record: PasteRecord = { ref, file, batch, status: 'ready' }
        batch.records.push(record)
        this.records.set(ref, record)
        const snapshot = input.state.getSnapshot()
        const accepted = input.insertReference({
          source: SOURCE,
          ref,
          label,
          clipboardText: `[pasted ${fileKindLabel(file)}: ${label}]`,
        }, { start: cursor, end: cursor, draftRev: snapshot.draftRev })
        if (!accepted) throw new Error('The composer changed before pasted files could be inserted')
        const inserted = input.state.getSnapshot().occurrences.find(occurrence =>
          occurrence.source === SOURCE && occurrence.ref === ref)
        if (inserted === undefined) throw new Error('The pasted file reference was not present after insertion')
        cursor = occurrenceEnd(inserted)
        const hasNext = index + 1 < files.length
        const suffix = input.state.getSnapshot().draft.slice(cursor)
        if (hasNext || (suffix !== '' && !/^\s/u.test(suffix))) cursor = this.insertText(input, ' ', cursor)
      }
      batch.unsubscribe = input.state.subscribe(() => {
        const alive = new Set(input.state.getSnapshot().occurrences
          .filter(occurrence => occurrence.source === SOURCE)
          .map(occurrence => occurrence.ref))
        let changed = false
        for (const record of batch.records) {
          if (alive.has(record.ref) || record.batch.inflight !== undefined) continue
          changed = this.records.delete(record.ref) || changed
        }
        if (batch.records.every(record => !this.records.has(record.ref)) && batch.inflight === undefined) {
          batch.unsubscribe?.()
          batch.unsubscribe = undefined
        }
        if (changed) this.changed()
      })
      this.changed()
      return cursor
    } catch (error) {
      input.setDraft(draftBeforeReferences)
      for (const record of batch.records) this.records.delete(record.ref)
      throw error
    }
  }

  /**
   * Insert one batch of files as reference chips through the Lexical
   * composer shell's detect-coordinate, revision-CAS'd verbs. The host
   * appends exactly one separating space after every chip (unless one
   * already follows), so the insertion cursor walks the detect projection
   * chip by chip; mid-batch failures roll the already-inserted chips back
   * chip by chip instead of rewriting the whole draft, so chips this paste
   * does not own survive untouched.
   * @param sessionId - the live Session id.
   * @param input - the composer shell face.
   * @param files - the captured files, in paste order.
   * @param cursor - detect-coordinate insertion point.
   * @returns the final detect-coordinate cursor, right after the last chip.
   */
  private insertComposerRecords(
    sessionId: string,
    input: PasteSessionInput,
    files: readonly File[],
    cursor: number,
  ): number {
    const batch: PasteBatch = { sessionId, records: [] }
    const inserted: string[] = []
    try {
      for (const [index, file] of files.entries()) {
        const ref = id()
        const label = pasteLabel(file, index)
        const record: PasteRecord = { ref, file, batch, status: 'ready' }
        batch.records.push(record)
        this.records.set(ref, record)
        let snapshot = input.state.getSnapshot()
        const before = detectTextOf(snapshot).slice(0, cursor)
        if (before !== '' && !/\s$/u.test(before)) {
          if (!shellInsertText(input, ' ', { start: cursor, end: cursor, draftRev: snapshot.draftRev })) {
            throw new Error('The composer changed before pasted files could be inserted')
          }
          cursor += 1
          snapshot = input.state.getSnapshot()
        }
        const accepted = input.insertReference({
          source: SOURCE,
          ref,
          label,
          clipboardText: `[pasted ${fileKindLabel(file)}: ${label}]`,
        }, { start: cursor, end: cursor, draftRev: snapshot.draftRev })
        if (!accepted) throw new Error('The composer changed before pasted files could be inserted')
        inserted.push(ref)
        snapshot = input.state.getSnapshot()
        const occurrence = snapshot.occurrences.find(candidate =>
          candidate.source === SOURCE && candidate.ref === ref)
        if (occurrence === undefined) throw new Error('The pasted file reference was not present after insertion')
        const chipEnd = occurrenceEnd(occurrence)
        cursor = detectOffsetOfClipboardBoundary(snapshot, chipEnd)
        // Between consecutive chips, step over the host's separating space so
        // the next insertion starts after it (the trailing space after the
        // final chip stays behind the caret, like the textarea flow).
        if (index + 1 < files.length && snapshot.draft.slice(chipEnd, chipEnd + 1) === ' ') cursor += 1
      }
      batch.unsubscribe = input.state.subscribe(() => {
        const alive = new Set(input.state.getSnapshot().occurrences
          .filter(occurrence => occurrence.source === SOURCE)
          .map(occurrence => occurrence.ref))
        let changed = false
        for (const record of batch.records) {
          if (alive.has(record.ref) || record.batch.inflight !== undefined) continue
          changed = this.records.delete(record.ref) || changed
        }
        if (batch.records.every(record => !this.records.has(record.ref)) && batch.inflight === undefined) {
          batch.unsubscribe?.()
          batch.unsubscribe = undefined
        }
        if (changed) this.changed()
      })
      this.changed()
      return cursor
    } catch (error) {
      for (const ref of inserted.reverse()) this.removeComposerChip(input, ref)
      for (const record of batch.records) this.records.delete(record.ref)
      throw error
    }
  }

  /** Best-effort removal of one chip this batch already inserted (rollback path). */
  private removeComposerChip(input: PasteSessionInput, ref: string): void {
    try {
      const snapshot = input.state.getSnapshot()
      const occurrence = snapshot.occurrences.find(candidate =>
        candidate.source === SOURCE && candidate.ref === ref)
      if (occurrence === undefined) return
      const start = detectOffsetOfClipboardBoundary(snapshot, occurrence.offset)
      shellInsertText(input, '', { start, end: start + 1, draftRev: snapshot.draftRev })
    } catch {
      // Rollback is best-effort: the batch failure already surfaces a notice.
    }
  }

  /**
   * The host's verdict for one Session and selector label, when fresh. The
   * last CONFIRMED answer is authoritative while a background refresh is in
   * flight (the paste acts on what the host last said; the refresh only
   * covers the next paste). A label that changed since the confirmation
   * answers undefined, so the native attachment flow stays the default.
   * @param sessionId - the live Session the paste belongs to.
   * @param modelLabel - the model-selector label currently shown.
   * @returns the fresh confirmed verdict, or undefined when unconfirmed.
   */
  private verdictFor(sessionId: string, modelLabel: string): PasteVerdictValue | undefined {
    const entry = this.verdicts.get(verdictKey(sessionId, modelLabel))
    if (entry === undefined || entry.at === 0) return undefined
    if (Date.now() - entry.at > VERDICT_MAX_AGE_MS) return undefined
    return { takeOver: entry.takeOver, ...(entry.autoSwitch === undefined ? {} : { autoSwitch: entry.autoSwitch }) }
  }

  /**
   * The exact model route the live model catalog reports for one Session.
   * Unreadable routes answer undefined, so the verdict falls back to the
   * selector label alone.
   * @param sessionId - the live Session id.
   * @returns the current provider/model selection, when readable.
   */
  private async readSelection(sessionId: string): Promise<{ provider: string; model: string; reasoningEffort?: string } | undefined> {
    const connection = this.ctx.get('connection') as { api: { sessions: {
      models(request: { sessionId: string }): Promise<{ result: {
        ok: true
        value: { current?: { provider: string; model: string; reasoningEffort?: string } | null }
      } | { ok: false; error: { code: string; message: string } } }>
    } } } | undefined
    if (connection === undefined) return undefined
    try {
      const { result } = await connection.api.sessions.models({ sessionId })
      if (!result.ok) return undefined
      const current = result.value.current
      if (current === undefined || current === null || current.provider === '' || current.model === '') return undefined
      return {
        provider: current.provider,
        model: current.model,
        ...(current.reasoningEffort === undefined ? {} : { reasoningEffort: current.reasoningEffort }),
      }
    } catch {
      return undefined
    }
  }

  /**
   * Ask the host what to do with a paste for the current model, and cache the
   * answer per Session and selector label. A model switch changes the label,
   * which changes the cache key, so a stale verdict never outlives the model
   * it described. The exact selection rides along when the live model catalog
   * is readable, so the host can answer with an auto-switch route; a 404
   * simply leaves the verdict unconfirmed; the next focus or paste retries.
   * @param sessionId - the live Session to ask about.
   * @param modelLabel - the model-selector label currently shown.
   */
  refreshVerdict(sessionId: string, modelLabel: string): void {
    const key = verdictKey(sessionId, modelLabel)
    const cached = this.verdicts.get(key)
    // Dedupe only on an in-flight request, never on freshness: the host's
    // model route can change under an unchanged Session id.
    if (cached?.pending) return
    const entry = {
      pending: true,
      takeOver: cached ? cached.takeOver : false,
      at: cached ? cached.at : 0,
      ...(cached?.autoSwitch === undefined ? {} : { autoSwitch: cached.autoSwitch }),
    }
    this.verdicts.set(key, entry)
    void (async () => {
      const selection = await this.readSelection(sessionId)
      const query = new URLSearchParams({ sessionId })
      if (modelLabel !== '') query.set('model', modelLabel)
      if (selection !== undefined) {
        query.set('provider', selection.provider)
        query.set('modelId', selection.model)
        if (selection.reasoningEffort !== undefined) query.set('reasoningEffort', selection.reasoningEffort)
      }
      let request: Promise<Response>
      try {
        request = fetch(`${PASTE_POLICY_ROUTE}?${query.toString()}`)
      } catch {
        // No fetch surface (test runtime, pre-fetch bootstrap): leave the
        // verdict unconfirmed rather than letting the paste listener die.
        entry.pending = false
        return
      }
      request
        .then((response) => {
          if (response.status === 404) {
            // Route not mounted yet (plugin load race, hot reload): forget every
            // verdict and retry on the next focus or paste instead of standing
            // down for the page lifetime.
            this.verdicts.clear()
            return null
          }
          if (!response.ok) throw new Error(`paste policy ${response.status}`)
          return response.json() as Promise<{ ok: true; value: PasteVerdictValue }>
        })
        .then((body) => {
          entry.pending = false
          if (body !== null) {
            entry.takeOver = body.value.takeOver === true
            if (body.value.autoSwitch !== undefined) entry.autoSwitch = body.value.autoSwitch
            else delete entry.autoSwitch
            entry.at = Date.now()
          }
        })
        .catch(() => {
          entry.pending = false
        })
    })()
  }

  /** Focus-time verdict prefetch for whichever Session the composer currently shows. */
  prefetchVerdict(): void {
    const sessionId = this.currentSessionId()
    if (sessionId !== undefined) this.refreshVerdict(sessionId, currentModelLabel())
  }

  /**
   * Path-takeover flow: insert the same-paste text and every file as a text
   * reference that serializes to the file's workspace path on send. The model
   * stays exactly where it is; the agent reads the path and calls the Vision
   * Toolkit tools on it.
   * @param sessionId - the live Session id.
   * @param target - the composer element the paste landed on.
   * @param files - the captured files.
   * @param text - same-paste text.
   */
  private takeoverPaste(
    sessionId: string,
    target: HTMLElement,
    files: readonly File[],
    text: string,
  ): void {
    if (target instanceof HTMLTextAreaElement) {
      this.takeoverPasteTextarea(sessionId, target, files, text)
      return
    }
    this.takeoverPasteComposer(sessionId, target, files, text)
  }

  /**
   * Takeover flow for the textarea composer the 0.1.5 test stand-in
   * publishes: single-coordinate draft splices through `setDraft`.
   */
  private takeoverPasteTextarea(
    sessionId: string,
    target: HTMLTextAreaElement,
    files: readonly File[],
    text: string,
  ): void {
    const input = this.inputFor(sessionId)
    const snapshot = input.state.getSnapshot()
    if (snapshot.phase !== 'plain') return
    const start = Math.max(0, Math.min(target.selectionStart ?? snapshot.draft.length, snapshot.draft.length))
    const end = Math.max(start, Math.min(target.selectionEnd ?? start, snapshot.draft.length))
    try {
      let cursor = this.insertText(input, text, start, end)
      validateImages(files)
      cursor = this.insertRecords(sessionId, input, files, cursor)
      requestAnimationFrame(() => {
        target.focus({ preventScroll: true })
        target.setSelectionRange(cursor, cursor)
      })
    } catch (error) {
      input.notify('error', message(error))
    }
  }

  /**
   * Takeover flow for the Lexical contenteditable DSH actually ships: the
   * same-paste text replaces the live caret span and every file lands as a
   * reference chip, all through the shell's detect-coordinate,
   * revision-CAS'd insertion verbs. Focus returns through the shell so
   * Lexical restores its caret instead of resetting it to the start.
   */
  private takeoverPasteComposer(
    sessionId: string,
    target: HTMLElement,
    files: readonly File[],
    text: string,
  ): void {
    let input: PasteSessionInput
    try {
      input = this.inputFor(sessionId)
    } catch {
      return
    }
    const shell = input as PasteSessionInput & ComposerShellExtras
    const snapshot = input.state.getSnapshot()
    if (snapshot.phase !== 'plain') return
    try {
      validateImages(files)
      const detectLength = detectTextOf(snapshot).length
      const caret = typeof shell.caretSpan === 'function'
        ? shell.caretSpan()
        : { start: detectLength, end: detectLength }
      const start = Math.max(0, Math.min(caret.start, detectLength))
      const end = Math.max(start, Math.min(caret.end, detectLength))
      let cursor = start
      if (text !== '') {
        if (!shellInsertText(input, text, { start, end, draftRev: input.state.getSnapshot().draftRev })) {
          throw new Error('The composer changed before the pasted text could be inserted')
        }
        cursor = start + text.length
      }
      cursor = this.insertComposerRecords(sessionId, input, files, cursor)
      requestAnimationFrame(() => {
        if (typeof shell.focus === 'function') shell.focus()
        else target.focus({ preventScroll: true })
      })
    } catch (error) {
      input.notify('error', message(error))
    }
  }

  /** The paste currently waiting for the attach confirmation, when any. */
  confirmState(): Readonly<PasteConfirmState> | undefined {
    return this.pendingConfirm
  }

  /**
   * Attach the pending paste after the user confirmed the dialog. With
   * `remember`, every later paste in this page session attaches without
   * asking again.
   */
  confirmAttach(remember: boolean): void {
    const pending = this.pendingConfirm
    if (pending === undefined) return
    if (remember) this.sessionAttachConfirmed = true
    this.pendingConfirm = undefined
    this.changed()
    this.takeoverPaste(pending.sessionId, pending.target, pending.files, pending.text)
  }

  /** Drop the pending paste after the user cancelled the dialog. */
  cancelConfirm(): void {
    if (this.pendingConfirm === undefined) return
    this.pendingConfirm = undefined
    this.changed()
  }

  handlePaste(event: ClipboardEvent): boolean {
    const files = pastedFiles(event.clipboardData)
    if (files.length === 0) return false
    const target = event.target
    // The composer card hosts both composer generations: a textarea (legacy
    // stand-ins) and the Lexical contenteditable DSH actually ships. Anything
    // outside the card (queue rows, settings fields) keeps its native paste.
    if (!(target instanceof HTMLElement)) return false
    if (target.closest('[data-composer-card]') === null) return false

    const sessionId = this.currentSessionId()
    if (sessionId === undefined) return false
    const modelLabel = currentModelLabel()
    this.refreshVerdict(sessionId, modelLabel)
    // Only a fresh host verdict changes the image flow; the native attachment
    // flow stays the default while the host is unconfirmed.
    const verdict = this.verdictFor(sessionId, modelLabel)
    // The host composer attaches images natively. Everything else — video,
    // audio, documents — and any image paste on a route confirmed text-only
    // (takeover or variant-autoSwitch verdict) needs the plugin flow, with
    // an explicit attach confirmation instead of a silent model switch.
    const needsPlugin = files.some(file => !isImageFile(file))
      || verdict?.takeOver === true
      || verdict?.autoSwitch !== undefined
    if (!needsPlugin) return false

    // Resolve the composer before swallowing the event: without a reachable
    // shell the plugin cannot insert anything, and the native flow is the
    // honest fallback for the host to answer.
    let input: PasteSessionInput
    try {
      input = this.inputFor(sessionId)
    } catch {
      return false
    }

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    if (input.state.getSnapshot().phase !== 'plain') return true

    const text = (event.clipboardData?.getData('text/plain') ?? '').replaceAll('\uFFFC', '')
    if (this.sessionAttachConfirmed) {
      this.takeoverPaste(sessionId, target, files, text)
      return true
    }
    this.pendingConfirm = {
      sessionId,
      files: [...files],
      text,
      target,
      kinds: [...new Set(files.map(fileKindLabel))],
    }
    this.changed()
    return true
  }

  remove(sessionId: string, occurrence: PasteOccurrence): void {
    const record = this.records.get(occurrence.ref)
    if (record?.batch.inflight !== undefined) return
    let input: PasteSessionInput
    try {
      input = this.inputFor(sessionId)
    } catch {
      return
    }
    const snapshot = input.state.getSnapshot()
    if (snapshot.phase !== 'plain') return
    const current = snapshot.occurrences.find(candidate =>
      candidate.source === SOURCE
      && candidate.occurrenceId === occurrence.occurrenceId
      && candidate.ref === occurrence.ref)
    if (current === undefined) return
    // The Lexical composer's chips occupy exactly one detect character; the
    // textarea-era machine spans the occurrence's full clipboard expansion.
    const span = isComposerShell(input)
      ? (() => {
        const start = detectOffsetOfClipboardBoundary(snapshot, current.offset)
        return { start, end: start + 1, draftRev: snapshot.draftRev }
      })()
      : { start: current.offset, end: occurrenceEnd(current), draftRev: snapshot.draftRev }
    if (!shellInsertText(input, '', span)) return
    this.records.delete(occurrence.ref)
    this.changed()
  }

  private async upload(batch: PasteBatch, signal: AbortSignal): Promise<void> {
    if (batch.inflight !== undefined) return batch.inflight
    const active = batch.records.filter(record => this.records.get(record.ref) === record)
    if (active.length === 0) throw new Error('Pasted files were removed before sending')
    const pending = active.filter(record => record.absolutePath === undefined)
    if (pending.length === 0) return
    const task = (async () => {
      for (const record of pending) {
        record.status = 'copying'
        record.error = undefined
      }
      this.changed()
      try {
        const failures = await Promise.all(pending.map(async (record) => {
          try {
            if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
            const query = new URLSearchParams({
              sessionId: batch.sessionId,
              name: record.file.name || `clipboard-${fileKindLabel(record.file)}`,
              size: String(record.file.size),
            })
            const body = await responseJson(await fetch(`${PASTE_IMAGES_ROUTE}?${query.toString()}`, {
              method: 'POST',
              headers: { 'Content-Type': record.file.type },
              body: record.file,
              signal,
            }))
            const absolutePath = body.value?.absolutePath
            if (typeof absolutePath !== 'string' || absolutePath === '') {
              throw new Error('Image copy response contained an invalid path')
            }
            record.absolutePath = absolutePath
            record.status = 'copied'
            record.error = undefined
            return undefined
          } catch (error) {
            const failure = error instanceof Error ? error : new Error(message(error))
            record.status = 'error'
            record.error = failure.message
            return failure
          }
        }))
        this.changed()
        const failure = failures.find((error): error is Error => error !== undefined)
        if (failure !== undefined) throw failure
      } finally {
        batch.inflight = undefined
        this.changed()
      }
    })()
    batch.inflight = task
    return task
  }

  private async serialize(ref: string, signal: AbortSignal): Promise<string> {
    const record = this.records.get(ref)
    if (record === undefined) throw new Error('Pasted file is no longer available in this browser tab')
    await this.upload(record.batch, signal)
    if (record.absolutePath === undefined) throw new Error('Pasted file was not copied into the workspace')
    return `[Pasted ${fileKindLabel(record.file)} available at absolute path: ${JSON.stringify(record.absolutePath)}]`
  }
}

/** One pending paste awaiting the user's attach confirmation. */
function PasteConfirmCard({ controller, kinds, count }: {
  controller: PasteImageController
  kinds: readonly string[]
  count: number
}): ReactNode {
  const [remember, setRemember] = useState(false)
  const kindText = kinds.join(', ')
  const reason = kinds.length === 1 && kinds[0] === 'image'
    ? 'текущая модель не поддерживает vision-вход напрямую'
    : 'видео, аудио и документы прикрепляются как файлы для Vision Toolkit'
  return <div className="dvt-paste-confirm" role="alertdialog" aria-label="Подтверждение вставки">
    <span className="dvt-paste-confirm-text">
      Прикрепить {kindText} ({count}) для использования плагином Vision Toolkit — {reason}.
    </span>
    <label className="dvt-paste-confirm-remember">
      <input
        type="checkbox"
        checked={remember}
        onChange={(event) => { setRemember(event.target.checked) }}
      />
      <span>Больше не показывать в этой сессии</span>
    </label>
    <div className="dvt-paste-confirm-actions">
      <button type="button" className="dvt-paste-confirm-attach" onClick={() => { controller.confirmAttach(remember) }}>Прикрепить</button>
      <button type="button" className="dvt-paste-confirm-cancel" onClick={() => { controller.cancelConfirm() }}>Отмена</button>
    </div>
  </div>
}

/** Minimal per-file progress, failure, removal, and attach-confirmation UI above the composer. */
export function PasteImageDock(props: PasteDockProps): ReactNode {
  useSyncExternalStore(props.controller.subscribe, props.controller.snapshot)
  const confirm = props.controller.confirmState()
  const occurrences = props.input.occurrences.filter(occurrence => occurrence.source === SOURCE)
  const records = props.controller.recordsFor(occurrences)
  if (confirm === undefined && records.length === 0) return null
  return <div className="dvt-paste-dock" role="status" aria-label="Pasted files">
    {confirm === undefined ? null : (
      <PasteConfirmCard
        controller={props.controller}
        kinds={confirm.kinds}
        count={confirm.files.length}
      />
    )}
    {occurrences.map((occurrence) => {
      const record = props.controller.recordsFor([occurrence])[0]
      if (record === undefined) return null
      const detail = record.status === 'copying' ? 'copying…'
        : record.status === 'copied' ? 'copied'
          : record.status === 'error' ? record.error ?? 'copy failed'
            : humanBytes(record.file.size)
      return <div className="dvt-paste-chip" data-status={record.status} key={occurrence.occurrenceId}>
        <span className="dvt-paste-name" title={record.file.name}>{record.file.name || 'clipboard file'}</span>
        <span className="dvt-paste-detail" title={record.error}>{detail}</span>
        <button
          type="button"
          aria-label={`Remove ${record.file.name || 'clipboard file'}`}
          disabled={props.input.phase !== 'plain' || record.status === 'copying'}
          onClick={() => { props.remove(occurrence) }}
        >×</button>
      </div>
    })}
  </div>
}

/** Install capture interception, the text-reference codec, and composer feedback. */
export function installPasteImages(ctx: ClientContext): void {
  const controller = new PasteImageController(ctx)
  const registered = new WeakMap<object, ReferenceSourceRegistration>()
  const register = (scope: ClientContext, registry: ReferenceSourceRegistry): void => {
    scope.effect(() => {
      const identity = registryIdentity(registry)
      let registration = registered.get(identity)
      if (registration === undefined) {
        registration = { dispose: registry.registerSource(controller.source()), owners: 0 }
        registered.set(identity, registration)
      }
      registration.owners += 1
      return () => {
        if (registered.get(identity) !== registration) return
        registration.owners -= 1
        if (registration.owners > 0) return
        registered.delete(identity)
        registration.dispose()
      }
    }, 'dsh-vision-toolkit: pasted image reference codec')
  }
  ctx.inject(['slash'], (scope: ClientContext) => {
    register(scope, (scope as unknown as LegacySlashContext).slash)
  })
  ctx.inject(['inputTriggers'], (scope: ClientContext) => {
    register(scope, (scope as unknown as LegacyTriggerContext).inputTriggers)
  })
  ctx.effect(() => {
    const listener = (event: ClipboardEvent): void => { controller.handlePaste(event) }
    // A focus-time prefetch has the verdict ready before the first paste can land.
    const onFocusIn = (): void => { controller.prefetchVerdict() }
    document.addEventListener('paste', listener, true)
    document.addEventListener('focusin', onFocusIn, true)
    return () => {
      document.removeEventListener('paste', listener, true)
      document.removeEventListener('focusin', onFocusIn, true)
    }
  }, 'dsh-vision-toolkit: clipboard image capture')
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'vision-toolkit-pasted-images',
    order: 6,
    inject: sessionId => {
      // The dock renders for exactly the Session whose composer is on
      // screen, so this is the focused-session source on hosts without
      // `sessions.list.current`.
      controller.attachSession(String(sessionId))
      return {
        controller,
        remove: (occurrence: PasteOccurrence) => { controller.remove(String(sessionId), occurrence) },
      }
    },
  }, PasteImageDock))
}
