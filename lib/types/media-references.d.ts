import type { Context } from '@deepseek-ai/cordis';
export interface MediaReference {
    marker: string;
    path: string;
    bytes: number;
    sha256: string;
}
/** Hash with backpressure and a hard cap, also detecting replacement/size changes. */
export declare function boundedFileDigest(path: string, cap: number, signal?: AbortSignal): Promise<{
    bytes: number;
    sha256: string;
}>;
/** The MAC key is shared with the existing protected artifact key, never exposed to clients. */
export declare class MediaReferenceAuthority {
    private readonly key;
    constructor(key: Buffer);
    issue(ctx: Context, sessionId: string, path: string, bytes: number): Promise<string>;
    /** Text syntax alone grants nothing; the owning live Session and exact file facts must match. */
    references(ctx: Context, sessionId: string | undefined, text: string): MediaReference[];
}
//# sourceMappingURL=media-references.d.ts.map