// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SessionMediaControls } from '../src/client/session-media.tsx'
import { defaultSessionMedia } from '../src/session-media.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const snapshot = (sessionId: string, revision = 0) => ({ sessionId, revision, settings: defaultSessionMedia(), persistent: true })
const response = (value: unknown) => Response.json({ ok: true, value })
const openMedia = async () => { fireEvent.click(await screen.findByLabelText('Медиа в этой сессии · Vision Toolkit')) }
describe('session media controls', () => {
  it('keeps Host dock geometry even before the plugin stylesheet is installed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(snapshot('a'))))
    const view = render(createElement(SessionMediaControls, { sessionId: 'a' }))
    await screen.findByLabelText('Медиа в этой сессии · Vision Toolkit')
    const root = view.container.querySelector('.dvt-session-media') as HTMLElement
    expect(root.style.boxSizing).toBe('border-box')
    expect(root.style.width).toContain('--dsh-composer-side-clearance')
    expect(root.style.maxWidth).toBe('var(--dsh-composer-card-max-width, 960px)')
    expect(root.style.minWidth).toBe('0px')
    expect(root.style.flex).toBe('0 0 auto')
    expect(root.style.marginLeft).toBe('auto')
    expect(root.style.marginRight).toBe('auto')
    expect(document.querySelector('style')).toBeNull()
  })
  it('starts compact and hides native protocol and explanations in proxy mode', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(snapshot('a'))))
    const view = render(createElement(SessionMediaControls, { sessionId: 'a' }))
    const summary = await screen.findByLabelText('Медиа в этой сессии · Vision Toolkit')
    expect(summary.textContent).toBe('МедиаVision Toolkit')
    const menu = summary.parentElement as HTMLDetailsElement
    expect(menu.open).toBe(false)
    expect(screen.queryByLabelText('Протокол native')).toBeNull()
    expect(view.container.querySelector('.dvt-session-media-help')?.hasAttribute('open')).toBe(false)
    fireEvent.click(summary)
    expect(menu.open).toBe(true)
    expect(screen.getByLabelText('Передача')).toBeTruthy()
    expect(screen.getByLabelText('Нативная генерация изображений текущей моделью')).toBeTruthy()
    expect(['Изображения', 'Видео', 'Аудио', 'Документы'].every(label => screen.getByLabelText(label))).toBe(true)
  })
  it('reveals the native protocol after selecting direct mode and closes on session switch', async () => {
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => init?.method === 'POST' ? response({ ...snapshot('a', 1), settings: JSON.parse(String(init.body)).settings }) : response(snapshot(String(_url).includes('sessionId=b') ? 'b' : 'a')))
    vi.stubGlobal('fetch', fetch)
    const view = render(createElement(SessionMediaControls, { sessionId: 'a' }))
    await openMedia()
    fireEvent.change(screen.getByLabelText('Передача'), { target: { value: 'direct' } })
    const protocol = await screen.findByLabelText('Протокол native')
    expect((protocol as HTMLSelectElement).value).toBe('responses')
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toMatchObject({ expectedRevision: 0, settings: { mode: 'direct' } })
    view.rerender(createElement(SessionMediaControls, { sessionId: 'b' }))
    await screen.findByLabelText('Медиа в этой сессии · Vision Toolkit')
    expect((view.container.querySelector('.dvt-session-media-menu') as HTMLDetailsElement).open).toBe(false)
    expect(screen.queryByLabelText('Протокол native')).toBeNull()
  })
  it('explains an empty missing route instead of exposing a JSON SyntaxError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    render(createElement(SessionMediaControls, { sessionId: 'a' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Полностью перезапустите DSH')
    expect(screen.getByLabelText('Медиа в этой сессии · недоступно')).toBeTruthy()
    expect(screen.queryByLabelText('Обработка медиа')).toBeNull()
  })
  it('keeps saved consent when a save returns an empty response', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => init?.method === 'POST' ? new Response('', { status: 502 }) : response(snapshot('a'))))
    render(createElement(SessionMediaControls, { sessionId: 'a' }))
    await openMedia()
    fireEvent.click(await screen.findByLabelText('Обработка медиа'))
    expect((await screen.findByRole('alert')).textContent).toContain('пустой ответ (HTTP 502)')
    expect((screen.getByLabelText('Обработка медиа') as HTMLInputElement).checked).toBe(true)
  })
  it('saves generation with the current-model Responses protocol and revision', async () => {
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => init?.method === 'POST' ? response({ ...snapshot('a', 1), settings: { ...defaultSessionMedia(), imageGeneration: true } }) : response(snapshot('a')))
    vi.stubGlobal('fetch', fetch)
    render(createElement(SessionMediaControls, { sessionId: 'a' }))
    await openMedia()
    const toggle = await screen.findByLabelText('Нативная генерация изображений текущей моделью')
    fireEvent.click(toggle)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toMatchObject({ expectedRevision: 0, settings: { imageGeneration: true, directProtocol: 'responses' } })
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(true))
  })
  it('does not let a stale save overwrite another session', async () => {
    let resolveSave!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => init?.method === 'POST' ? new Promise<Response>(resolve => { resolveSave = resolve }) : response(snapshot(String(url).includes('sessionId=b') ? 'b' : 'a'))))
    const view = render(createElement(SessionMediaControls, { sessionId: 'a' }))
    await openMedia()
    fireEvent.click(await screen.findByLabelText('Обработка медиа'))
    view.rerender(createElement(SessionMediaControls, { sessionId: 'b' }))
    await waitFor(() => expect((screen.getByLabelText('Обработка медиа') as HTMLInputElement).checked).toBe(true))
    await act(async () => { resolveSave(response({ ...snapshot('a', 1), settings: { ...defaultSessionMedia(), enabled: false } })) })
    expect((screen.getByLabelText('Обработка медиа') as HTMLInputElement).checked).toBe(true)
  })
})
