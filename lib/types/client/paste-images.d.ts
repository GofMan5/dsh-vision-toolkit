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
    /** The composer textarea the paste landed on, for cursor restoration. */
    target: HTMLTextAreaElement;
    /** Labels for the confirm card: what kinds are in the batch. */
    kinds: string[];
}
interface PasteRecord {
    ref: string;
    file: File;
    batch: PasteBatch;
    status: 'ready' | 'copying' | 'copied' | 'error';
    error?: string | undefined;
    absolutePath?: string | undefined;
}
interface PasteBatch {
    sessionId: string;
    records: PasteRecord[];
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
type PasteDockProps = PropsRuntime<'conversation.input.dock'> & {
    controller: PasteImageController;
    remove: (occurrence: PasteOccurrence) => void;
};
/** Owns browser File objects until DSH serializes the corresponding text references. */
export declare class PasteImageController {
    private readonly ctx;
    private readonly records;
    private readonly listeners;
    private revision;
    private readonly verdicts;
    /** A paste awaiting the user's attach confirmation, rendered in the dock. */
    private pendingConfirm;
    /** Session-scoped “don't ask again”: later pastes attach immediately. */
    private sessionAttachConfirmed;
    constructor(ctx: ClientContext);
    subscribe: (listener: () => void) => (() => void);
    snapshot: () => number;
    private changed;
    source(): InputTriggerSource;
    recordsFor(occurrences: readonly PasteOccurrence[]): PasteRecord[];
    private inputFor;
    private insertText;
    private insertRecords;
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
    /**
     * Path-takeover flow: insert the same-paste text and every file as a text
     * reference that serializes to the file's workspace path on send. The model
     * stays exactly where it is; the agent reads the path and calls the Vision
     * Toolkit tools on it.
     * @param sessionId - the live Session id.
     * @param target - the composer textarea the paste landed on.
     * @param files - the captured files.
     * @param text - same-paste text.
     */
    private takeoverPaste;
    /** The paste currently waiting for the attach confirmation, when any. */
    confirmState(): Readonly<PasteConfirmState> | undefined;
    /**
     * Attach the pending paste after the user confirmed the dialog. With
     * `remember`, every later paste in this page session attaches without
     * asking again.
     */
    confirmAttach(remember: boolean): void;
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