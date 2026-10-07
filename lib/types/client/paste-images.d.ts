/** Clipboard-only file input for DSH Web: images, video, audio, and documents. */
import { type ReactNode } from 'react';
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
export declare const PASTE_IMAGES_ROUTE = "/_dsh/vision-toolkit/paste-images";
export declare const PASTE_POLICY_ROUTE = "/_dsh/vision-toolkit/paste-policy";
/** One pending paste awaiting the user's attach confirmation. */
interface PasteConfirmState {
    sessionId: string;
    files: File[];
    text: string;
    /** The composer element the paste landed on (textarea or contenteditable), for caret restoration. */
    target: HTMLElement;
    /** Labels for the confirm card: what kinds are in the batch. */
    kinds: string[];
}
interface PasteRecord {
    ref: string;
    file: File;
    batch: PasteBatch;
    /** The exact paste-time label (trimmed name or clipboard-kind fallback) the chip carries. */
    label: string;
    status: 'ready' | 'copying' | 'copied' | 'error';
    error?: string | undefined;
    absolutePath?: string | undefined;
    mediaReference?: string | undefined;
}
interface PasteBatch {
    sessionId: string;
    input: PasteSessionInput;
    records: PasteRecord[];
    serializers: number;
    inflight?: Promise<void> | undefined;
    unsubscribe?: (() => void) | undefined;
}
interface PasteOccurrence {
    occurrenceId: number;
    source: string;
    ref: string;
    offset: number;
    /** DSH rc.8+ stores the full @label text; older releases used one placeholder. */
    length?: number;
    label: string;
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
        source: string;
        ref: string;
        label: string;
        clipboardText: string;
    }, span: {
        start: number;
        end: number;
        draftRev: number;
    }): boolean;
    /** Replace the whole draft. */
    setDraft(text: string): void;
    /** Surface a composer notice. */
    notify(level: 'info' | 'error', text: string): void;
    readonly state: {
        getSnapshot(): {
            readonly draft: string;
            readonly draftRev: number;
            readonly phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting';
            readonly occurrences: readonly PasteOccurrence[];
        };
        subscribe(listener: () => void): () => void;
    };
}
type PasteDockProps = PropsRuntime<'conversation.input.dock'> & {
    sessionId: string;
    controller: PasteImageController;
    remove: (occurrence: PasteOccurrence) => void;
};
/** Owns browser File objects until DSH serializes the corresponding text references. */
export declare class PasteImageController {
    private readonly ctx;
    private readonly records;
    private readonly completedReferences;
    private readonly listeners;
    private revision;
    private readonly verdicts;
    /** A paste awaiting the user's attach confirmation, rendered in the dock. */
    private pendingConfirm;
    /** Session-scoped “don't ask again”: later pastes attach immediately. */
    private readonly confirmedSessions;
    /**
     * Session id last reported by the dock slot injection. 0.2.0-rc hosts
     * dropped `sessions.list.current`, so the session the dock renders for is
     * the focused-session source there; 0.1.5 keeps `current` authoritative.
     */
    private lastSessionId;
    constructor(ctx: ClientContext);
    subscribe: (listener: () => void) => (() => void);
    snapshot: () => number;
    private changed;
    source(): InputTriggerSource;
    recordsFor(occurrences: readonly PasteOccurrence[]): PasteRecord[];
    /** Record the Session the dock slot last rendered for (focused-session source on 0.2.0-rc hosts). */
    attachSession(sessionId: string): void;
    /**
     * The Session a composer paste belongs to. 0.1.5 answers from the Session
     * list's focused id; 0.2.0-rc hosts answer from the dock slot's last
     * injection, which follows the rendered conversation.
     */
    private currentSessionId;
    private inputFor;
    private insertText;
    private insertRecords;
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
    private insertComposerRecords;
    /** Release orphaned Files only after every detached serializer has finished. */
    private pruneBatch;
    /** Best-effort removal of one chip this batch already inserted (rollback path). */
    private removeComposerChip;
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
    private verdictFor;
    /**
     * The exact model route the live model catalog reports for one Session.
     * Unreadable routes answer undefined, so the verdict falls back to the
     * selector label alone.
     * @param sessionId - the live Session id.
     * @returns the current provider/model selection, when readable.
     */
    private readSelection;
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
    refreshVerdict(sessionId: string, modelLabel: string): void;
    invalidateMediaPolicy(): void;
    /** Focus-time verdict prefetch for whichever Session the composer currently shows. */
    prefetchVerdict(): void;
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
    private takeoverPaste;
    /**
     * Takeover flow for the textarea composer the 0.1.5 test stand-in
     * publishes: single-coordinate draft splices through `setDraft`.
     */
    private takeoverPasteTextarea;
    /**
     * Takeover flow for the Lexical contenteditable DSH actually ships: the
     * same-paste text replaces the live caret span and every file lands as a
     * reference chip, all through the shell's detect-coordinate,
     * revision-CAS'd insertion verbs. Focus returns through the shell so
     * Lexical restores its caret instead of resetting it to the start.
     */
    private takeoverPasteComposer;
    /** The paste currently waiting for the attach confirmation, when any. */
    confirmState(sessionId?: string | undefined): Readonly<PasteConfirmState> | undefined;
    /**
     * Attach the pending paste after the user confirmed the dialog. With
     * `remember`, every later paste in this page session attaches without
     * asking again.
     */
    confirmAttach(remember: boolean, sessionId?: string | undefined): void;
    /** Drop the pending paste after the user cancelled the dialog. */
    cancelConfirm(): void;
    handlePaste(event: ClipboardEvent): boolean;
    remove(sessionId: string, occurrence: PasteOccurrence): void;
    private upload;
    private serialize;
}
/** Minimal per-file progress, failure, removal, and attach-confirmation UI above the composer. */
export declare function PasteImageDock(props: PasteDockProps): ReactNode;
/** Install capture interception, the text-reference codec, and composer feedback. */
export declare function installPasteImages(ctx: ClientContext): void;
export {};
//# sourceMappingURL=paste-images.d.ts.map