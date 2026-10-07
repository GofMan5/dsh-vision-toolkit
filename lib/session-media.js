import { defineDomain } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import { FULL_MULTIMODAL_CAPABILITIES, mediaKindOfPath } from "./model-capabilities.js";
export const SESSION_MEDIA_ROUTE = '/_dsh/vision-toolkit/session-media';
export const sessionMediaSchema = z.object({
    enabled: z.boolean(),
    mode: z.enum(['proxy', 'direct']),
    modalities: z.object({ image: z.boolean(), video: z.boolean(), audio: z.boolean(), document: z.boolean() }).strict(),
    imageGeneration: z.boolean(),
    directProtocol: z.enum(['openai', 'responses']),
}).strict();
const storedSchema = z.object({ createdAt: z.number(), revision: z.number().int().nonnegative(), settings: sessionMediaSchema });
const stateSchema = z.object({ sessions: z.record(z.string(), storedSchema) });
const domainSpec = defineDomain({ name: 'vision_toolkit_sessions', version: 0, global: { schema: stateSchema, initial: { sessions: {} } }, tables: {} });
export function defaultSessionMedia() {
    return { enabled: true, mode: 'proxy', modalities: { ...FULL_MULTIMODAL_CAPABILITIES }, imageGeneration: false, directProtocol: 'responses' };
}
/** One serialized writer prevents simultaneous tabs from silently losing consent changes. */
export class SessionMediaStore {
    ctx;
    global;
    fiber;
    ready = Promise.resolve();
    memory = { sessions: {} };
    tail = Promise.resolve();
    constructor(ctx) {
        this.ctx = ctx;
        if (typeof ctx.inject !== 'function')
            return;
        this.fiber = ctx.inject(['storageDomain'], async (scope) => {
            const domain = await scope.storageDomain.open(domainSpec);
            const attach = this.tail.then(async () => {
                const global = domain.global;
                const sessions = { ...global.get().sessions };
                for (const [id, row] of Object.entries(this.memory.sessions)) {
                    const live = this.ctx.sessions.get(id);
                    if (live?.header.createdAt !== row.createdAt)
                        continue;
                    const durable = sessions[id];
                    const conflict = durable?.createdAt === row.createdAt && JSON.stringify(durable.settings) !== JSON.stringify(row.settings);
                    sessions[id] = { ...row, revision: conflict ? Math.max(row.revision, durable.revision) + 1 : Math.max(row.revision, durable?.createdAt === row.createdAt ? durable.revision : 0) };
                }
                await global.set({ sessions });
                this.memory = { sessions };
                this.global = domain.global;
            });
            this.tail = attach.then(() => { }, () => { });
            try {
                await attach;
            }
            catch (error) {
                await domain.close();
                throw error;
            }
            return async () => { await this.tail; this.memory = this.global?.get() ?? this.memory; this.global = undefined; await domain.close(); };
        });
        this.ready = Promise.resolve(this.fiber).then(() => { }, error => { ctx.logger.warn('Session media persistence unavailable: %s', String(error)); });
    }
    async get(sessionId) {
        if (this.global === undefined && typeof this.ctx.get === 'function' && this.ctx.get('storageDomain') !== undefined)
            await this.ready;
        await this.tail;
        return this.snapshot(sessionId);
    }
    snapshot(sessionId) {
        const session = this.ctx.sessions.get(sessionId);
        if (session === undefined)
            throw new Error('Live Session not found');
        const row = (this.global?.get() ?? this.memory).sessions[sessionId];
        const valid = row?.createdAt === session.header.createdAt ? row : undefined;
        return { sessionId, revision: valid?.revision ?? 0, settings: structuredClone(valid?.settings ?? defaultSessionMedia()), persistent: this.global !== undefined };
    }
    async set(sessionId, expectedRevision, raw) {
        const settings = sessionMediaSchema.parse(raw);
        if (this.global === undefined && typeof this.ctx.get === 'function' && this.ctx.get('storageDomain') !== undefined)
            await this.ready;
        const task = this.tail.then(async () => {
            const current = this.snapshot(sessionId);
            if (current.revision !== expectedRevision)
                throw new Error('Session media settings changed; reload and retry');
            const session = this.ctx.sessions.get(sessionId);
            const state = this.global?.get() ?? this.memory;
            const sessions = { ...state.sessions, [sessionId]: { createdAt: session.header.createdAt, revision: current.revision + 1, settings } };
            if (this.global !== undefined)
                await this.global.set({ sessions });
            this.memory = { sessions };
            return this.snapshot(sessionId);
        });
        this.tail = task.then(() => { }, () => { });
        return task;
    }
    async assertInputs(sessionId, paths) {
        if (sessionId === undefined)
            return;
        const { settings } = await this.get(sessionId);
        for (const path of paths) {
            const kind = mediaKindOfPath(path) ?? 'image';
            if (!settings.enabled || !settings.modalities[kind])
                throw new Error(`${kind} processing is disabled in this Session; enable it in the Media controls`);
        }
    }
    async capabilities(sessionId) { return (await this.get(sessionId)).settings.modalities; }
    dispose() { if (this.fiber !== undefined)
        void this.fiber.dispose().catch(error => this.ctx.logger.warn('%s', String(error))); }
}
//# sourceMappingURL=session-media.js.map