// @vitest-environment jsdom

import { createElement, type ComponentType } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, VisionSettingsController } from '../src/client/index.tsx'
import { installPasteImages, PASTE_POLICY_ROUTE, PasteImageController } from '../src/client/paste-images.tsx'

const SOURCE = 'vision-toolkit-pasted-image'
const disposers: Array<() => void> = []
const response = (value: unknown) => Response.json({ ok: true, value })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

afterEach(() => {
  cleanup()
  disposers.splice(0).reverse().forEach(dispose => { dispose() })
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

interface Occurrence { occurrenceId: number; source: string; ref: string; label: string; offset: number; length: number }
function inputMachine(shell = false) {
  let snapshot = { draft: '', draftRev: 0, phase: 'plain' as const, occurrences: [] as Occurrence[] }
  const listeners = new Set<() => void>()
  const publish = (next: typeof snapshot) => { snapshot = next; listeners.forEach(listener => { listener() }) }
  const input = {
    state: { getSnapshot: () => snapshot, subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    } },
    listenerCount: () => listeners.size,
    setDraft: (draft: string) => {
      let start = 0
      while (start < snapshot.draft.length && start < draft.length && snapshot.draft[start] === draft[start]) start += 1
      let oldEnd = snapshot.draft.length
      let newEnd = draft.length
      while (oldEnd > start && newEnd > start && snapshot.draft[oldEnd - 1] === draft[newEnd - 1]) { oldEnd -= 1; newEnd -= 1 }
      const delta = newEnd - oldEnd
      const occurrences = snapshot.occurrences.flatMap(row => row.offset + row.length <= start ? [row] : row.offset >= oldEnd ? [{ ...row, offset: row.offset + delta }] : [])
      publish({ ...snapshot, draft, draftRev: snapshot.draftRev + 1, occurrences })
    },
    restore: (saved: typeof snapshot) => { publish({ ...saved, draftRev: snapshot.draftRev + 1 }) },
    insertReference: (reference: { source: string; ref: string; label: string }, span: { start: number; end: number; draftRev: number }) => {
      if (span.draftRev !== snapshot.draftRev) return false
      const occurrence = { ...reference, occurrenceId: snapshot.occurrences.length + 1, offset: span.start, length: 1 }
      publish({ ...snapshot, draft: snapshot.draft.slice(0, span.start) + '\uFFFC ' + snapshot.draft.slice(span.end), draftRev: snapshot.draftRev + 1, occurrences: [...snapshot.occurrences, occurrence] })
      return true
    },
    notify: vi.fn(),
    ...(shell ? { caretSpan: () => ({ start: snapshot.draft.length, end: snapshot.draft.length }), focus: () => {} } : {}),
  }
  return input
}

function clientBench(settings = false, modern = false, shell = false) {
  const inputs = { a: inputMachine(shell), b: inputMachine(shell) }
  let current = 'a'
  const registrations: Array<{ options: Record<string, unknown>; component: ComponentType<Record<string, unknown>> }> = []
  let source!: ReturnType<PasteImageController['source']>
  const ctx = {
    sessions: { list: { getSnapshot: () => modern ? {} : { current } }, scope: (id: string) => ({ id }) },
    conversation: { input: { for: (scope: { id: keyof typeof inputs }) => inputs[scope.id] } },
    inputTriggers: { registerSource: (next: typeof source) => { source = next; return () => {} } },
    slots: {
      inject: (_name: string, callback: () => unknown) => {
        const result = callback()
        if (result && typeof result === 'object' && Symbol.iterator in result) {
          for (const dispose of result as Iterable<() => void>) disposers.push(dispose)
        } else if (typeof result === 'function') disposers.push(result as () => void)
      },
      register: (options: Record<string, unknown>, component: ComponentType<Record<string, unknown>>) => {
        registrations.push({ options, component }); return () => {}
      },
    },
    effect: (setup: () => unknown) => { const dispose = setup(); if (typeof dispose === 'function') disposers.push(dispose as () => void) },
    locale: { register: () => () => {}, bind: () => (key: string) => key },
    remote: { $on: () => () => {} },
    on: () => () => {},
    get: (_key: string) => undefined,
    inject: (services: string[], callback: (scope: unknown) => void) => { if (services.every(service => service in ctx)) callback(ctx) },
  }
  if (settings) apply(ctx as never)
  else installPasteImages(ctx as never)
  const dock = registrations.find(row => row.options.id === 'vision-toolkit-pasted-images')!
  const injectDock = dock.options.inject as (id: string) => { sessionId: string; controller: PasteImageController; remove: (row: Occurrence) => void }
  let injected = injectDock('a')
  return {
    inputs, registrations, controller: injected.controller, codec: () => source.codec!,
    focus: (id: 'a' | 'b') => { current = id; injected = injectDock(id) },
    dock: (id: 'a' | 'b') => createElement(dock.component, { input: inputs[id].state.getSnapshot(), ...injectDock(id) }),
  }
}

function settingsSnapshot(revision = 1, model = 'old') {
  return {
    schemaVersion: 1, writable: true,
    settings: { value: { provider: { model, baseUrl: 'https://fixture.invalid/v1', credential: 'FIXTURE_ONLY', protocol: 'openai' }, language: 'en' }, revision, applies: 'live' },
    credential: { ref: 'FIXTURE_ONLY', configured: false, writable: true },
    capabilities: { model, effective: { image: true, video: false, audio: false, document: false }, detected: { image: true, video: false, audio: false, document: false }, overridden: false },
    runtime: { ready: true, generation: revision },
    release: { pluginVersion: 'fixture', upstreamRepository: 'fixture', upstreamVersion: 'fixture', upstreamCommit: 'fixture', update: { supported: false } },
    artifactRouteAvailable: false,
  }
}

function composer(shell = false) {
  const card = document.createElement('div')
  card.dataset.composerCard = ''
  const target = document.createElement(shell ? 'div' : 'textarea')
  if (shell) target.setAttribute('contenteditable', 'true')
  card.append(target); document.body.append(card)
  return target
}
function paste(target: HTMLElement, files: File[]) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { items: files.map(file => ({ kind: 'file', getAsFile: () => file })), files, getData: () => '' } })
  fireEvent(target, event)
  return event
}
const pdf = (name = 'fixture.pdf') => new File(['fixture'], name, { type: 'application/pdf' })
const modalities = { image: true, video: true, audio: true, document: true }

// Refresh is a public focus/paste path, not a private verdict-cache mutation.
async function seedPolicy(bench: ReturnType<typeof clientBench>, sessionMedia: { enabled: boolean; modalities: typeof modalities }) {
  const consumed = deferred<void>()
  const body = { ok: true, value: { takeOver: false, sessionMedia } }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => { consumed.resolve(); return JSON.stringify(body) } })))
  bench.controller.prefetchVerdict()
  await consumed.promise
  await act(async () => { await Promise.resolve() })
}

function attach(bench: ReturnType<typeof clientBench>, target: HTMLElement, files: File[], id: 'a' | 'b' = 'a') {
  paste(target, files)
  const view = render(bench.dock(id))
  fireEvent.click(screen.getByRole('button', { name: 'Прикрепить' }))
  view.unmount()
}

describe('R18 Settings response ownership', () => {
  it.each(['get-first', 'save-first'])('preserves the saved form when old GET resolves %s', async (order) => {
    const stale = deferred<Response>()
    const save = deferred<Response>()
    const fetchMock = vi.fn().mockResolvedValueOnce(response(settingsSnapshot())).mockReturnValueOnce(stale.promise).mockReturnValueOnce(save.promise)
    vi.stubGlobal('fetch', fetchMock)
    const bench = clientBench(true)
    const controller = new VisionSettingsController()
    await controller.load()
    const settings = bench.registrations.find(row => row.options.name === 'settings.section')!
    render(createElement(settings.component, { controller, t: (key: string) => key }))
    const model = screen.getByLabelText('model') as HTMLInputElement
    fireEvent.change(model, { target: { value: 'saved' } })
    let reload!: Promise<void>
    act(() => { reload = controller.load(true) })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    expect(controller.snapshot().action).toBe('save')
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({ action: 'save', expectedRevision: 1, value: { provider: { model: 'saved' } } })
    if (order === 'get-first') {
      await act(async () => { stale.resolve(response(settingsSnapshot())); await reload })
      expect(controller.snapshot().action).toBe('save')
      expect(model.value).toBe('saved')
    }
    await act(async () => { save.resolve(response(settingsSnapshot(2, 'saved'))) })
    await screen.findByText('saved')
    if (order === 'save-first') await act(async () => { stale.resolve(response(settingsSnapshot())); await reload })
    expect(controller.snapshot().snapshot?.settings.revision).toBe(2)
    expect(controller.snapshot().reloadSeq).toBe(0)
    expect(model.value).toBe('saved')
  }, 30_000)

  it('keeps a credential-only mutation authoritative and suppresses loads during Save', async () => {
    const stale = deferred<Response>()
    const credential = deferred<Response>()
    const fetchMock = vi.fn().mockResolvedValueOnce(response(settingsSnapshot())).mockReturnValueOnce(stale.promise).mockReturnValueOnce(credential.promise)
    vi.stubGlobal('fetch', fetchMock)
    const controller = new VisionSettingsController()
    await controller.load()
    const load = controller.load()
    const save = controller.save({}, 1, 'synthetic-key', false)
    await controller.load(true)
    controller.refreshIfLoaded()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    credential.resolve(response({ ...settingsSnapshot(), credential: { ref: 'FIXTURE_ONLY', configured: true, writable: true } }))
    expect(await save).toBe(true)
    stale.reject(new Error('obsolete GET failed'))
    await load
    expect(controller.snapshot()).toMatchObject({ status: 'ready', message: 'saved', snapshot: { credential: { configured: true } } })
    expect(controller.snapshot().error).toBeUndefined()
  })

  it('rejects lower revision GETs but accepts fresh GETs and explicit same-revision reloads', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(settingsSnapshot(2, 'saved'))).mockResolvedValueOnce(response(settingsSnapshot(1))).mockResolvedValueOnce(response(settingsSnapshot(2, 'restored'))).mockResolvedValueOnce(response(settingsSnapshot(3, 'newer')))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new VisionSettingsController()
    await controller.load()
    await controller.load(true)
    expect(controller.snapshot().snapshot?.settings.value.provider?.model).toBe('saved')
    expect(controller.snapshot().reloadSeq).toBe(0)
    await controller.load(true)
    expect(controller.snapshot().snapshot?.settings.value.provider?.model).toBe('restored')
    expect(controller.snapshot().reloadSeq).toBe(1)
    await controller.load()
    expect(controller.snapshot().snapshot?.settings.revision).toBe(3)
  })
})

describe('R19 cached media consent', () => {
  it.each(['disabled', 'modality-disabled', 'expired'])('vetoes %s consent during a pending refresh', async (kind) => {
    const bench = clientBench()
    await seedPolicy(bench, { enabled: kind !== 'disabled', modalities: { ...modalities, document: kind === 'disabled' } })
    if (kind === 'expired') vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 20_000)
    const refresh = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn(() => refresh.promise))
    const event = paste(composer(), [pdf()])
    expect(event.defaultPrevented).toBe(true)
    expect(bench.inputs.a.notify).toHaveBeenCalledWith('error', expect.stringContaining('выключен'))
    expect(bench.controller.confirmState()).toBeUndefined()
    expect(bench.inputs.a.state.getSnapshot().occurrences).toEqual([])
    refresh.resolve(response({ takeOver: false, sessionMedia: { enabled: true, modalities } }))
    await act(async () => { await refresh.promise })
  })

  it('still offers attachment when cached consent allows the document', async () => {
    const bench = clientBench()
    await seedPolicy(bench, { enabled: true, modalities })
    vi.stubGlobal('fetch', vi.fn(async () => response({ takeOver: false, sessionMedia: { enabled: true, modalities } })))
    paste(composer(), [pdf()])
    render(bench.dock('a'))
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(bench.inputs.a.notify).not.toHaveBeenCalled()
  })
})

describe('R20 session-bound attachment confirmation', () => {
  it.each([false, true])('hides A confirmation in B and rejects a stale click (modern=%s)', (modern) => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ takeOver: false })))
    const bench = clientBench(false, modern)
    paste(composer(), [pdf()])
    const view = render(bench.dock('a'))
    const staleButton = screen.getByRole('button', { name: 'Прикрепить' })
    bench.focus('b')
    // The old DOM can still dispatch before React commits the new dock.
    fireEvent.click(staleButton)
    expect(bench.inputs.a.state.getSnapshot().occurrences).toEqual([])
    expect(bench.inputs.b.state.getSnapshot().occurrences).toEqual([])
    view.rerender(bench.dock('b'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    bench.focus('a')
    view.rerender(bench.dock('a'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    paste(composer(), [pdf('second.pdf')])
    fireEvent.click(screen.getByRole('button', { name: 'Прикрепить' }))
    expect(bench.inputs.a.state.getSnapshot().occurrences).toHaveLength(1)
    expect(bench.inputs.b.state.getSnapshot().occurrences).toEqual([])
  })

  it('does not render a foreign pending confirmation even without a click', () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ takeOver: false })))
    const bench = clientBench()
    paste(composer(), [pdf()])
    bench.focus('b')
    render(bench.dock('b'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(bench.controller.confirmState('a')?.sessionId).toBe('a')
  })
})

describe('R21 detached serialization cleanup', () => {
  it.each([false, true])('releases a cleared batch after all parallel serializers finish (shell=%s)', async (shell) => {
    const uploads = [deferred<Response>(), deferred<Response>()]
    let next = 0
    vi.stubGlobal('fetch', vi.fn((url: unknown) => String(url).startsWith(PASTE_POLICY_ROUTE) ? Promise.resolve(response({ takeOver: false })) : uploads[next++]!.promise))
    const bench = clientBench(false, shell, shell)
    attach(bench, composer(shell), [pdf('one.pdf'), pdf('two.pdf')])
    const sent = bench.inputs.a.state.getSnapshot()
    const record = bench.controller.recordsFor(sent.occurrences)[0]!
    const serialized = Promise.all(sent.occurrences.map(row => bench.codec().serialize(row.ref, new AbortController().signal)))
    bench.inputs.a.setDraft('') // Host optimistic commit after starting serializers.
    expect(bench.controller.recordsFor(sent.occurrences)).toHaveLength(2)
    expect(bench.inputs.a.listenerCount()).toBe(1)
    uploads[0]!.resolve(response({ absolutePath: '/fixture/one.pdf' }))
    await act(async () => { await uploads[0]!.promise })
    expect(bench.controller.recordsFor(sent.occurrences)).toHaveLength(2)
    uploads[1]!.resolve(response({ absolutePath: '/fixture/two.pdf' }))
    expect(await serialized).toEqual([
      '[Pasted document available at absolute path: "/fixture/one.pdf"]',
      '[Pasted document available at absolute path: "/fixture/two.pdf"]',
    ])
    await waitFor(() => expect(bench.controller.recordsFor(sent.occurrences)).toEqual([]))
    expect(bench.inputs.a.listenerCount()).toBe(0)
    expect(record.batch.records).toEqual([])
  })

  it('preserves a failed detached draft restored by the host and permits retry', async () => {
    const upload = deferred<Response>()
    let attempts = 0
    vi.stubGlobal('fetch', vi.fn((url: unknown) => {
      if (String(url).startsWith(PASTE_POLICY_ROUTE)) return Promise.resolve(response({ takeOver: false }))
      attempts += 1
      return attempts === 1 ? upload.promise : Promise.resolve(response({ absolutePath: '/fixture/retry.pdf' }))
    }))
    const bench = clientBench()
    attach(bench, composer(), [pdf()])
    const sent = bench.inputs.a.state.getSnapshot()
    // Mirrors host Promise.all rejection restoration, not private controller mutation.
    const send = Promise.all(sent.occurrences.map(row => bench.codec().serialize(row.ref, new AbortController().signal))).catch(error => {
      bench.inputs.a.restore(sent)
      throw error
    })
    const rejected = expect(send).rejects.toThrow('synthetic upload failure')
    bench.inputs.a.setDraft('')
    upload.reject(new Error('synthetic upload failure'))
    await rejected
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(bench.controller.recordsFor(sent.occurrences)).toHaveLength(1)
    expect(bench.inputs.a.listenerCount()).toBe(1)
    expect(await bench.codec().serialize(sent.occurrences[0]!.ref, new AbortController().signal)).toContain('/fixture/retry.pdf')
    bench.inputs.a.setDraft('')
    await waitFor(() => expect(bench.inputs.a.listenerCount()).toBe(0))
  })

  it('retries a later transport-restored chip using only its copied path', async () => {
    const fetchMock = vi.fn(async (url: unknown) => String(url).startsWith(PASTE_POLICY_ROUTE) ? response({ takeOver: false }) : response({ absolutePath: '/fixture/transport.pdf' }))
    vi.stubGlobal('fetch', fetchMock)
    const bench = clientBench()
    attach(bench, composer(), [pdf()])
    const sent = bench.inputs.a.state.getSnapshot()
    const original = bench.controller.recordsFor(sent.occurrences)[0]!
    const serialization = bench.codec().serialize(original.ref, new AbortController().signal)
    bench.inputs.a.setDraft('')
    const copied = await serialization
    await waitFor(() => expect(bench.inputs.a.listenerCount()).toBe(0))
    expect(original.batch.records).toEqual([])
    expect(bench.controller.recordsFor(sent.occurrences)).toEqual([])
    await expect(bench.codec().serialize(original.ref, new AbortController().signal)).rejects.toThrow('no longer available')
    bench.inputs.b.restore(sent)
    await expect(bench.codec().serialize(original.ref, new AbortController().signal)).rejects.toThrow('no longer available')
    bench.inputs.a.restore(sent) // Host restores its editor after delayed prompt failure.
    const requests = fetchMock.mock.calls.length
    expect(await bench.codec().serialize(original.ref, new AbortController().signal)).toBe(copied)
    expect(fetchMock).toHaveBeenCalledTimes(requests)
    expect(bench.inputs.a.listenerCount()).toBe(0)
    expect(bench.controller.recordsFor(sent.occurrences)).toEqual([])
  })

  it('prunes a cleared aborted upload without a host restoration', async () => {
    const upload = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn((url: unknown, init?: RequestInit) => {
      if (String(url).startsWith(PASTE_POLICY_ROUTE)) return Promise.resolve(response({ takeOver: false }))
      init?.signal?.addEventListener('abort', () => { upload.reject(new DOMException('Cancelled', 'AbortError')) }, { once: true })
      return upload.promise
    }))
    const bench = clientBench()
    attach(bench, composer(), [pdf()])
    const sent = bench.inputs.a.state.getSnapshot()
    const cancellation = new AbortController()
    const serialization = bench.codec().serialize(sent.occurrences[0]!.ref, cancellation.signal)
    const rejected = expect(serialization).rejects.toThrow('Cancelled')
    bench.inputs.a.setDraft('')
    cancellation.abort()
    await rejected
    await waitFor(() => expect(bench.controller.recordsFor(sent.occurrences)).toEqual([]))
    expect(bench.inputs.a.listenerCount()).toBe(0)
  })

  it('serializes the server-issued media authority unchanged, including restored retries', async () => {
    const signed = '[Pasted document available at absolute path: "/fixture/signed.pdf"; reference: payload.signature]'
    const fetcher = vi.fn(async (url: unknown) => String(url).startsWith(PASTE_POLICY_ROUTE) ? response({ takeOver: false }) : response({ absolutePath: '/fixture/signed.pdf', mediaReference: signed }))
    vi.stubGlobal('fetch', fetcher)
    const bench = clientBench(); attach(bench, composer(), [pdf()]); const sent = bench.inputs.a.state.getSnapshot()
    const serialized = bench.codec().serialize(sent.occurrences[0]!.ref, new AbortController().signal)
    bench.inputs.a.setDraft(''); expect(await serialized).toBe(signed)
    await waitFor(() => expect(bench.inputs.a.listenerCount()).toBe(0))
    bench.inputs.a.restore(sent)
    expect(await bench.codec().serialize(sent.occurrences[0]!.ref, new AbortController().signal)).toBe(signed)
    expect(fetcher.mock.calls.filter(([url]) => !String(url).startsWith(PASTE_POLICY_ROUTE))).toHaveLength(1)
  })

  it('drops removed siblings from the batch graph while keeping a live chip reusable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => String(url).startsWith(PASTE_POLICY_ROUTE) ? response({ takeOver: false }) : response({ absolutePath: '/fixture/kept.pdf' })))
    const bench = clientBench()
    attach(bench, composer(), [pdf('removed.pdf'), pdf('kept.pdf')])
    const sent = bench.inputs.a.state.getSnapshot()
    const kept = bench.controller.recordsFor(sent.occurrences)[1]!
    bench.inputs.a.restore({ ...sent, occurrences: [sent.occurrences[1]!] })
    expect(kept.batch.records).toEqual([kept])
    expect(bench.controller.recordsFor(sent.occurrences)).toEqual([kept])
    expect(await bench.codec().serialize(kept.ref, new AbortController().signal)).toContain('/fixture/kept.pdf')
    expect(await bench.codec().serialize(kept.ref, new AbortController().signal)).toContain('/fixture/kept.pdf')
    bench.inputs.a.setDraft('')
    expect(bench.inputs.a.listenerCount()).toBe(0)
  })
})
