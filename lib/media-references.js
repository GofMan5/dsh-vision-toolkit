/** Server-issued, durable authority for automatic pasted-media projection. */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { open } from 'node:fs/promises';
import { mediaKindOfPath } from "./model-capabilities.js";
/** Hash with backpressure and a hard cap, also detecting replacement/size changes. */
export async function boundedFileDigest(path, cap, signal) {
    const handle = await open(path, 'r');
    try {
        const before = await handle.stat();
        if (!before.isFile() || before.size > cap)
            throw new Error('Media exceeds the bounded input limit');
        const hash = createHash('sha256');
        let bytes = 0;
        for await (const chunk of handle.createReadStream({ autoClose: false, ...(signal === undefined ? {} : { signal }) })) {
            bytes += chunk.length;
            if (bytes > cap)
                throw new Error('Media exceeds the bounded input limit');
            hash.update(chunk);
        }
        const after = await handle.stat();
        if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs)
            throw new Error('Media changed while reading');
        return { bytes, sha256: hash.digest('hex') };
    }
    finally {
        await handle.close();
    }
}
/** The MAC key is shared with the existing protected artifact key, never exposed to clients. */
export class MediaReferenceAuthority {
    key;
    constructor(key) {
        this.key = key;
    }
    async issue(ctx, sessionId, path, bytes) {
        const session = ctx.sessions.get(sessionId);
        if (session === undefined || typeof session.header.cwd !== 'string' || typeof session.header.createdAt !== 'number')
            throw new Error('Live Session identity is required for media reference');
        const digest = await boundedFileDigest(path, bytes);
        if (digest.bytes !== bytes)
            throw new Error('Pasted media size changed');
        const grant = { v: 1, sessionId, createdAt: session.header.createdAt, cwd: session.header.cwd, path, ...digest };
        const payload = Buffer.from(JSON.stringify(grant)).toString('base64url');
        const signature = createHmac('sha256', this.key).update('media-reference\0').update(payload).digest('base64url');
        return `[Pasted ${mediaKindOfPath(path) ?? 'file'} available at absolute path: ${JSON.stringify(path)}; reference: ${payload}.${signature}]`;
    }
    /** Text syntax alone grants nothing; the owning live Session and exact file facts must match. */
    references(ctx, sessionId, text) {
        if (sessionId === undefined)
            return [];
        const session = ctx.sessions.get(sessionId);
        if (session === undefined)
            return [];
        const refs = [];
        const pattern = /\[Pasted (?:image|video|audio|document|file) available at absolute path: ("(?:[^"\\]|\\.){0,8192}"); reference: ([A-Za-z0-9_-]{1,24576})\.([A-Za-z0-9_-]{43})\]/gu;
        for (const hit of text.matchAll(pattern)) {
            if (hit[0].length > 32 * 1024)
                continue;
            const expected = createHmac('sha256', this.key).update('media-reference\0').update(hit[2]).digest();
            const signature = Buffer.from(hit[3], 'base64url');
            if (signature.length !== expected.length || !timingSafeEqual(signature, expected))
                continue;
            try {
                const grant = JSON.parse(Buffer.from(hit[2], 'base64url').toString('utf8'));
                if (grant.v !== 1 || grant.sessionId !== sessionId || grant.createdAt !== session.header.createdAt || grant.cwd !== session.header.cwd
                    || typeof grant.path !== 'string' || grant.path !== JSON.parse(hit[1]) || mediaKindOfPath(grant.path) === undefined
                    || !Number.isSafeInteger(grant.bytes) || grant.bytes < 1 || typeof grant.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(grant.sha256))
                    continue;
                refs.push({ marker: hit[0], path: grant.path, bytes: grant.bytes, sha256: grant.sha256 });
                if (refs.length > 20)
                    throw new Error('Too many media references in one message');
            }
            catch (error) {
                if (error instanceof Error && error.message.startsWith('Too many'))
                    throw error;
            }
        }
        return refs;
    }
}
//# sourceMappingURL=media-references.js.map