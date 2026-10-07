/** Durable, session-scoped media consent. Never stored in provider configuration. */
import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import { type ModelCapabilities } from './model-capabilities.ts';
export declare const SESSION_MEDIA_ROUTE = "/_dsh/vision-toolkit/session-media";
export declare const sessionMediaSchema: z.ZodObject<{
    enabled: z.ZodBoolean;
    mode: z.ZodEnum<{
        proxy: "proxy";
        direct: "direct";
    }>;
    modalities: z.ZodObject<{
        image: z.ZodBoolean;
        video: z.ZodBoolean;
        audio: z.ZodBoolean;
        document: z.ZodBoolean;
    }, z.core.$strict>;
    imageGeneration: z.ZodBoolean;
    directProtocol: z.ZodEnum<{
        openai: "openai";
        responses: "responses";
    }>;
}, z.core.$strict>;
export type SessionMediaSettings = z.infer<typeof sessionMediaSchema>;
export interface SessionMediaSnapshot {
    sessionId: string;
    revision: number;
    settings: SessionMediaSettings;
    persistent: boolean;
}
export declare function defaultSessionMedia(): SessionMediaSettings;
/** One serialized writer prevents simultaneous tabs from silently losing consent changes. */
export declare class SessionMediaStore {
    private readonly ctx;
    private global;
    private fiber;
    private ready;
    private memory;
    private tail;
    constructor(ctx: Context);
    get(sessionId: string): Promise<SessionMediaSnapshot>;
    private snapshot;
    set(sessionId: string, expectedRevision: number, raw: unknown): Promise<SessionMediaSnapshot>;
    assertInputs(sessionId: string | undefined, paths: readonly string[]): Promise<void>;
    capabilities(sessionId: string): Promise<ModelCapabilities>;
    dispose(): void;
}
//# sourceMappingURL=session-media.d.ts.map