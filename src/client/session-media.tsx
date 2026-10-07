/** Compact session controls beside the composer; consent lives on the Host. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { readApiResponse } from './api-response.ts'
interface Settings { enabled: boolean; mode: 'proxy' | 'direct'; modalities: Record<'image' | 'video' | 'audio' | 'document', boolean>; imageGeneration: boolean; directProtocol: 'openai' | 'responses' }
interface Snapshot { sessionId: string; revision: number; settings: Settings; persistent: boolean }
const route = '/_dsh/vision-toolkit/session-media'
const labels = { image: 'Изображения', video: 'Видео', audio: 'Аудио', document: 'Документы' } as const

export function SessionMediaControls({ sessionId }: { sessionId: string }): ReactNode {
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const active = useRef<{ sessionId: string; signal: AbortSignal }>()
  const saving = useRef(false)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    active.current = { sessionId, signal: controller.signal }
    saving.current = false
    setSnapshot(undefined); setError(''); setBusy(false)
    void fetch(`${route}?${new URLSearchParams({ sessionId })}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) }).then(async response => {
      const body = await readApiResponse<{ ok: boolean; value: Snapshot; error?: { message: string } }>(response)
      if (!response.ok || !body.ok) throw new Error(body.error?.message ?? 'Не удалось загрузить настройки медиа')
      if (!controller.signal.aborted) setSnapshot(body.value)
    }).catch(error => { if (!controller.signal.aborted) setError(String(error)) })
    return () => { controller.abort() }
  }, [sessionId, reload])
  const save = async (settings: Settings): Promise<void> => {
    const operation = active.current
    if (snapshot?.sessionId !== sessionId || operation?.sessionId !== sessionId || operation.signal.aborted || saving.current) return
    saving.current = true
    setBusy(true); setError('')
    try {
      const response = await fetch(`${route}?${new URLSearchParams({ sessionId })}`, { method: 'POST', signal: AbortSignal.any([operation.signal, AbortSignal.timeout(30000)]), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: snapshot.revision, settings }) })
      const body = await readApiResponse<{ ok: boolean; value: Snapshot; error?: { message: string } }>(response)
      if (!response.ok || !body.ok) throw new Error(body.error?.message ?? 'Не удалось сохранить настройки медиа')
      if (operation.signal.aborted) return
      setSnapshot(body.value)
      document.dispatchEvent(new CustomEvent('dvt-session-media-changed', { detail: { sessionId } }))
    } catch (error) { if (!operation.signal.aborted) setError(String(error)) } finally { if (!operation.signal.aborted) { saving.current = false; setBusy(false) } }
  }
  const settings = snapshot?.sessionId === sessionId ? snapshot.settings : undefined
  const modeLabel = settings === undefined ? error ? 'недоступно' : 'загрузка…' : !settings.enabled ? 'выключено' : settings.imageGeneration ? 'Native + генерация' : settings.mode === 'direct' ? 'Native' : 'Vision Toolkit'
  // Keep dock geometry on the rendered node: its Host slot is display:contents,
  // and a missing/late plugin stylesheet must not leave this row at the window edge.
  return <div className="dvt-session-media" style={{
    boxSizing: 'border-box',
    width: 'calc(100% - 2 * var(--dsh-composer-side-clearance, 16px))',
    maxWidth: 'var(--dsh-composer-card-max-width, 960px)',
    minWidth: 0,
    flex: 'none',
    margin: '0 auto 4px',
  }}>
    <details className="dvt-session-media-menu" key={sessionId}>
      <summary aria-label={`Медиа в этой сессии · ${modeLabel}`} title="Настройки медиа в этой сессии">
        <span>Медиа</span><span className="dvt-session-media-mode" role="status">{busy ? 'Сохранение…' : modeLabel}</span>
        <svg className="dvt-session-media-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
      </summary>
      {settings === undefined ? null : <fieldset className="dvt-session-media-panel" disabled={busy} aria-label="Настройки медиа">
        <label className="dvt-session-toggle"><input type="checkbox" checked={settings.enabled} onChange={event => { void save({ ...settings, enabled: event.target.checked }) }} /> Обработка медиа</label>
        <div className="dvt-session-modalities">{(Object.keys(labels) as Array<keyof typeof labels>).map(kind => <label className="dvt-session-toggle" key={kind}><input type="checkbox" disabled={!settings.enabled} checked={settings.modalities[kind]} onChange={event => { void save({ ...settings, modalities: { ...settings.modalities, [kind]: event.target.checked } }) }} />{labels[kind]}</label>)}</div>
        <label className="dvt-session-select">Передача <select disabled={!settings.enabled} value={settings.mode} onChange={event => { void save({ ...settings, mode: event.target.value as Settings['mode'] }) }}><option value="proxy">Vision Toolkit</option><option value="direct">Напрямую модели</option></select></label>
        {settings.mode === 'direct' || settings.imageGeneration ? <label className="dvt-session-select">Протокол native <select disabled={!settings.enabled || settings.imageGeneration} value={settings.directProtocol} onChange={event => { void save({ ...settings, directProtocol: event.target.value as Settings['directProtocol'] }) }}><option value="responses">Responses</option><option value="openai">Chat Completions</option></select></label> : null}
        <label className="dvt-session-toggle"><input type="checkbox" aria-label="Нативная генерация изображений текущей моделью" disabled={!settings.enabled} checked={settings.imageGeneration} onChange={event => { void save({ ...settings, imageGeneration: event.target.checked, ...(event.target.checked ? { directProtocol: 'responses' } : {}) }) }} /> Генерация изображений</label>
        <details className="dvt-session-media-help">
          <summary>Как это работает</summary>
          <p>Vision Toolkit передаёт основной модели описание. Native отправляет медиа текущей модели через relay плагина. Responses — изображения и документы; Chat Completions — изображения, аудио, видео и документы.</p>
          <p>Генерация использует Responses и image_generation, без смены модели. Аудио и видео требуют Chat Completions или режима Vision Toolkit. Возможности endpoint зависят от relay. Native работает только для провайдеров, разрешённых в конфигурации плагина.</p>
        </details>
        {!snapshot?.persistent ? <p role="status">Настройки действуют до перезапуска DSH: хранилище сессий недоступно.</p> : null}
      </fieldset>}
    </details>
    {error ? <p className="dvt-session-media-error" role="alert">{error} <button type="button" onClick={() => { setReload(value => value + 1) }}>Перезагрузить настройки</button></p> : null}
  </div>
}

export function installSessionMediaControls(ctx: Context): void {
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'vision-toolkit-session-media', order: 5, inject: sessionId => ({ sessionId: String(sessionId) }) }, SessionMediaControls))
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = `
.dvt-session-media{container-type:inline-size;font:inherit;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dvt-session-media *{box-sizing:border-box}
.dvt-session-media-menu>summary{display:flex;align-items:center;gap:8px;width:fit-content;max-width:100%;min-height:28px;padding:4px 6px;border-radius:6px;list-style:none;cursor:pointer;font-weight:500}
.dvt-session-media-menu>summary::-webkit-details-marker{display:none}
.dvt-session-media-mode{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-weight:400}
.dvt-session-media-chevron{flex:none;color:var(--dsw-alias-label-secondary)}
.dvt-session-media-menu[open]>summary>.dvt-session-media-chevron{transform:rotate(90deg)}
.dvt-session-media-panel{display:grid;gap:8px;min-width:0;margin:4px 0 6px;padding:10px 6px;border:0;border-top:1px solid var(--dsw-alias-border-l1)}
.dvt-session-toggle{display:flex;align-items:center;gap:8px;min-width:0;min-height:24px;cursor:pointer}
.dvt-session-media input[type=checkbox]{flex:none;width:14px;height:14px;margin:0;accent-color:var(--dsw-alias-state-business-primary)}
.dvt-session-modalities{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px 12px}
.dvt-session-select{display:grid;grid-template-columns:110px minmax(0,1fr);align-items:center;gap:8px;min-width:0}
.dvt-session-media select{display:block;width:100%;min-width:0;max-width:100%;min-height:30px;padding:4px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit}
.dvt-session-media input:disabled,.dvt-session-media select:disabled{cursor:not-allowed}
.dvt-session-media label:has(input:disabled),.dvt-session-media select:disabled{opacity:.55}
.dvt-session-media-help>summary{width:fit-content;cursor:pointer;color:var(--dsw-alias-label-secondary)}
.dvt-session-media p{margin:0;line-height:1.5;overflow-wrap:anywhere}
.dvt-session-media-help p{margin-top:8px;color:var(--dsw-alias-label-secondary)}
.dvt-session-media :focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:3px}
.dvt-session-media-error{padding:6px;color:var(--dsw-alias-state-error-primary)}
.dvt-session-media-error button{padding:2px 0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
@media(hover:hover){.dvt-session-media-menu>summary:hover{background:var(--dsw-alias-bg-layer-2)}}
@container(max-width:480px){.dvt-session-modalities{grid-template-columns:repeat(2,minmax(0,1fr))}.dvt-session-select{grid-template-columns:100px minmax(0,1fr)}}
@media(max-width:600px){.dvt-session-media-menu>summary{min-height:32px}.dvt-session-toggle{min-height:32px}.dvt-session-media select{min-height:36px;font-size:16px}.dvt-session-modalities{grid-template-columns:repeat(2,minmax(0,1fr))}.dvt-session-select{grid-template-columns:100px minmax(0,1fr)}}
`
    document.head.append(style)
    return () => { style.remove() }
  }, 'vision toolkit session media styles')
}
