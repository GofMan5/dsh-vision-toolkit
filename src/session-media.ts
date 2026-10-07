/** Durable, session-scoped media consent. Never stored in provider configuration. */
import type { Context, Fiber } from '@deepseek-ai/cordis'
import { defineDomain, type DomainGlobal } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { FULL_MULTIMODAL_CAPABILITIES, mediaKindOfPath, type ModelCapabilities } from './model-capabilities.ts'

export const SESSION_MEDIA_ROUTE = '/_dsh/vision-toolkit/session-media'
export const sessionMediaSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['proxy', 'direct']),
  modalities: z.object({ image: z.boolean(), video: z.boolean(), audio: z.boolean(), document: z.boolean() }).strict(),
  imageGeneration: z.boolean(),
  directProtocol: z.enum(['openai', 'responses']),
}).strict()
export type SessionMediaSettings = z.infer<typeof sessionMediaSchema>
export interface SessionMediaSnapshot { sessionId: string; revision: number; settings: SessionMediaSettings; persistent: boolean }
const storedSchema = z.object({ createdAt: z.number(), revision: z.number().int().nonnegative(), settings: sessionMediaSchema })
const stateSchema = z.object({ sessions: z.record(z.string(), storedSchema) })
const domainSpec = defineDomain({ name: 'vision_toolkit_sessions', version: 0, global: { schema: stateSchema, initial: { sessions: {} } }, tables: {} })

export function defaultSessionMedia(): SessionMediaSettings {
  return { enabled: true, mode: 'proxy', modalities: { ...FULL_MULTIMODAL_CAPABILITIES }, imageGeneration: false, directProtocol: 'responses' }
}

/** One serialized writer prevents simultaneous tabs from silently losing consent changes. */
export class SessionMediaStore {
  private global: DomainGlobal<z.infer<typeof stateSchema>> | undefined
  private fiber: (Fiber & PromiseLike<Fiber>) | undefined
  private ready: Promise<void> = Promise.resolve()
  private memory: z.infer<typeof stateSchema> = { sessions: {} }
  private tail: Promise<void> = Promise.resolve()
  constructor(private readonly ctx: Context) {
    if (typeof ctx.inject !== 'function') return
    this.fiber = ctx.inject(['storageDomain'], async scope => {
      const domain = await scope.storageDomain.open(domainSpec)
      const attach = this.tail.then(async () => {
        const global = domain.global as DomainGlobal<z.infer<typeof stateSchema>>
        const sessions: z.infer<typeof stateSchema>['sessions'] = { ...global.get().sessions }
        for (const [id, row] of Object.entries(this.memory.sessions)) {
          const live = this.ctx.sessions.get(id as never)
          if (live?.header.createdAt !== row.createdAt) continue
          const durable = sessions[id]
          const conflict = durable?.createdAt === row.createdAt && JSON.stringify(durable.settings) !== JSON.stringify(row.settings)
          sessions[id] = { ...row, revision: conflict ? Math.max(row.revision, durable.revision) + 1 : Math.max(row.revision, durable?.createdAt === row.createdAt ? durable.revision : 0) }
        }
        await global.set({ sessions })
        this.memory = { sessions }
        this.global = domain.global
      })
      this.tail = attach.then(() => {}, () => {})
      try { await attach } catch (error) { await domain.close(); throw error }
      return async () => { await this.tail; this.memory = this.global?.get() ?? this.memory; this.global = undefined; await domain.close() }
    })
    this.ready = Promise.resolve(this.fiber).then(() => {}, error => { ctx.logger.warn('Session media persistence unavailable: %s', String(error)) })
  }
  async get(sessionId: string): Promise<SessionMediaSnapshot> {
    if (this.global === undefined && typeof this.ctx.get === 'function' && this.ctx.get('storageDomain') !== undefined) await this.ready
    await this.tail
    return this.snapshot(sessionId)
  }
  private snapshot(sessionId: string): SessionMediaSnapshot {
    const session = this.ctx.sessions.get(sessionId as never)
    if (session === undefined) throw new Error('Live Session not found')
    const row = (this.global?.get() ?? this.memory).sessions[sessionId]
    const valid = row?.createdAt === session.header.createdAt ? row : undefined
    return { sessionId, revision: valid?.revision ?? 0, settings: structuredClone(valid?.settings ?? defaultSessionMedia()), persistent: this.global !== undefined }
  }
  async set(sessionId: string, expectedRevision: number, raw: unknown): Promise<SessionMediaSnapshot> {
    const settings = sessionMediaSchema.parse(raw)
    if (this.global === undefined && typeof this.ctx.get === 'function' && this.ctx.get('storageDomain') !== undefined) await this.ready
    const task = this.tail.then(async () => {
      const current = this.snapshot(sessionId)
      if (current.revision !== expectedRevision) throw new Error('Session media settings changed; reload and retry')
      const session = this.ctx.sessions.get(sessionId as never)!
      const state = this.global?.get() ?? this.memory
      const sessions = { ...state.sessions, [sessionId]: { createdAt: session.header.createdAt, revision: current.revision + 1, settings } }
      if (this.global !== undefined) await this.global.set({ sessions })
      this.memory = { sessions }
      return this.snapshot(sessionId)
    })
    this.tail = task.then(() => {}, () => {})
    return task
  }
  async assertInputs(sessionId: string | undefined, paths: readonly string[]): Promise<void> {
    if (sessionId === undefined) return
    const { settings } = await this.get(sessionId)
    for (const path of paths) {
      const kind = mediaKindOfPath(path) ?? 'image'
      if (!settings.enabled || !settings.modalities[kind]) throw new Error(`${kind} processing is disabled in this Session; enable it in the Media controls`)
    }
  }
  async capabilities(sessionId: string): Promise<ModelCapabilities> { return (await this.get(sessionId)).settings.modalities }
  dispose(): void { if (this.fiber !== undefined) void this.fiber.dispose().catch(error => this.ctx.logger.warn('%s', String(error))) }
}
