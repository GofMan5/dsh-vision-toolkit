/**
 * @gofman5/dsh-vision-toolkit — DSH Vision Toolkit profile bundle.
 *
 * Plugin lifecycle follows the documented readiness chain: verify the pinned
 * upstream checkout, publish the vision-skills Skill and its one-shot bootstrap,
 * then mount the execution tools only in Agents that load that Skill or invoke
 * the bootstrap. Any
 * failure leaves no model capability behind, and disposal unregisters every
 * global and Agent-scoped contribution the plugin mounted.
 * @module @gofman5/dsh-vision-toolkit
 */
import { ArtifactAccessController, prepareArtifactAccessKey } from "./artifact-access.js";
import { prepareWatchedSettingsGeneration, plainVisionConfig, resolveConfig, } from "./config.js";
import { VisionToolExposure } from "./exposure.js";
import { createPasteTakeoverResolver, installImageInputVariants } from "./image-input-variants.js";
import { VisionToolkitRuntimeManager } from "./runtime-manager.js";
import { VISION_SKILLS_SKILL } from "./skill.js";
import { StorageHistoryStore } from "./storage-history.js";
import { bindVisionSettings } from "./settings-compat.js";
import { createVisionTools } from "./tools.js";
import { PLUGIN_VERSION } from "./version.js";
import { installVisionToolkitWeb, VisionToolkitWebBackend } from "./web.js";
import { MAX_PASTE_IMAGE_BYTES, MAX_PASTE_MEDIA_BYTES, PastedImageBackend } from "./paste-images.js";
import { SessionMediaStore } from "./session-media.js";
import { installMediaRouting } from "./media-routing.js";
import { MediaReferenceAuthority } from "./media-references.js";
export const name = '@gofman5/dsh-vision-toolkit';
export { Config } from "./config.js";
// Cordis refuses undeclared service reads ("cannot get property X without
// inject"). `llm` and `attachments` back the session-media routing wire.
export const inject = ['tools', 'credentials', 'skills', 'subprocess', 'settings', 'agents', 'sessions', 'llm', 'attachments'];
/** Plugin entry: validate configuration synchronously, then mount asynchronously. */
export async function apply(ctx, config = {}) {
    // Registration itself rejects an invalid stored section before any runtime
    // or Tool becomes visible. The custom Web editor preflights runtime changes
    // before persistence; hand-edited settings still fail loud here or retain
    // the last serving generation when changed live.
    const settings = bindVisionSettings(ctx, plainVisionConfig(config));
    const manager = new VisionToolkitRuntimeManager(ctx);
    const lifecycle = new AbortController();
    const disposers = [];
    let applySettings;
    let pendingSettings;
    const settingsChanged = (next, previous) => {
        if (lifecycle.signal.aborted)
            return;
        if (applySettings !== undefined)
            return applySettings(next, previous);
        pendingSettings = { next, previous };
    };
    // Subscribe before any startup await; coalesce startup updates to the latest value.
    disposers.push(settings.watch(settingsChanged));
    let accessKey;
    try {
        accessKey = await prepareArtifactAccessKey();
    }
    catch (error) {
        for (const dispose of disposers.reverse())
            dispose();
        throw error;
    }
    const artifacts = new ArtifactAccessController(accessKey);
    const mediaReferences = new MediaReferenceAuthority(accessKey);
    const sessionMedia = new SessionMediaStore(ctx);
    disposers.push(() => { sessionMedia.dispose(); });
    const storageHistory = new StorageHistoryStore(ctx, () => { void settingsChanged(settings.get(), manager.ready ? manager.currentConfig() : settings.get()); });
    disposers.push(() => { storageHistory.dispose(); });
    let storageHistoryWarningReported = false;
    let operationalDisposers;
    const persistStorageHistory = async (candidate, required) => {
        try {
            const persisted = await storageHistory.persist(candidate);
            if (persisted)
                return;
            const error = new Error('configured storage history requires @deepseek-ai/dsh-storage-domain when Settings cannot persist it');
            if (required)
                throw error;
            if (!storageHistoryWarningReported) {
                storageHistoryWarningReported = true;
                ctx.logger.warn('dsh-vision-toolkit: %s', error.message);
            }
        }
        catch (error) {
            if (required)
                throw error;
            if (!storageHistoryWarningReported) {
                storageHistoryWarningReported = true;
                const message = error instanceof Error ? error.message : String(error);
                ctx.logger.warn('dsh-vision-toolkit: configured storage history was not persisted. %s', message);
            }
        }
    };
    const ensureOperational = () => {
        if (!manager.ready || operationalDisposers !== undefined)
            return;
        const exposure = new VisionToolExposure(ctx, () => createVisionTools(() => manager.current(), value => artifacts.presentationMeta(value), lifecycle.signal, (id, paths) => sessionMedia.assertInputs(id, paths)));
        let activationTool;
        let exposureDisposer;
        let skill;
        try {
            activationTool = ctx.tools.register(exposure.activationTool);
            skill = ctx.skills.register(VISION_SKILLS_SKILL);
            exposureDisposer = exposure.install();
            operationalDisposers = { activationTool, exposure: exposureDisposer, skill };
            const info = manager.current().upstreamVersion;
            ctx.logger.info('dsh-vision-toolkit %s ready (upstream %s @ %s, checkout %s)', PLUGIN_VERSION, info.version, info.commit, info.path);
        }
        catch (error) {
            exposureDisposer?.();
            if (skill !== undefined)
                skill();
            activationTool?.();
            throw error;
        }
    };
    const initialConfig = await storageHistory.restore(settings.get());
    try {
        await manager.initialize(initialConfig, candidate => persistStorageHistory(candidate.config, false));
        ensureOperational();
    }
    catch (error) {
        const resolvedInitial = resolveConfig(initialConfig);
        if (resolvedInitial.storageDir === undefined
            || manager.validatedStorageDirectory() === resolvedInitial.storageDir) {
            await persistStorageHistory(initialConfig, false);
        }
        const message = error instanceof Error ? error.message : String(error);
        ctx.logger.error('dsh-vision-toolkit %s: runtime not ready; the vision-skills skill, activation bootstrap, and Agent-scoped visual tools are NOT registered. Settings remain available for repair. %s', PLUGIN_VERSION, message);
    }
    const backend = new VisionToolkitWebBackend(ctx, manager, artifacts, ensureOperational);
    const currentConfig = () => manager.ready
        ? manager.currentConfig()
        : resolveConfig(settings.get());
    const pastedImages = new PastedImageBackend(ctx, {
        maxUploadBytes: () => MAX_PASTE_IMAGE_BYTES,
        maxMediaUploadBytes: () => MAX_PASTE_MEDIA_BYTES,
        storageGeneration: () => manager.storageGeneration(),
    }, mediaReferences);
    // Image-input variants register asynchronously once eligible routes exist;
    // the runtime getter stays lazy so variants appear even when the runtime
    // becomes ready after the first sweep.
    const variants = installImageInputVariants(ctx, currentConfig, () => manager.ready ? manager.current() : undefined, () => manager.validatedStorageDirectory());
    const pasteResolver = createPasteTakeoverResolver(ctx, currentConfig);
    installVisionToolkitWeb(ctx, backend, artifacts, pastedImages, async (sessionId, selection, label) => {
        const verdict = await pasteResolver(sessionId, selection, label);
        const { settings } = await sessionMedia.get(sessionId);
        return { ...verdict, ...(settings.enabled && settings.mode === 'direct' ? { takeOver: true } : {}), sessionMedia: settings };
    }, () => ({ hidden: currentConfig().imageInputVariants.hidden }), sessionMedia);
    disposers.push(installMediaRouting(ctx, sessionMedia, currentConfig, () => manager.ready ? manager.current() : undefined, lifecycle.signal, mediaReferences));
    disposers.push(variants.dispose);
    const reconcileSettings = async (next, previous) => {
        try {
            const prepared = await prepareWatchedSettingsGeneration(next, manager.ready ? manager.currentConfig() : previous, ctx.settings.writable, storageHistory => settings.update({ storageHistory }));
            if (prepared.persistenceError !== undefined) {
                const message = prepared.persistenceError instanceof Error
                    ? prepared.persistenceError.message
                    : String(prepared.persistenceError);
                ctx.logger.warn('dsh-vision-toolkit: activating Settings without persisting internal storage history. %s', message);
            }
            if (prepared.config === undefined || lifecycle.signal.aborted)
                return;
            const candidate = await storageHistory.restore(prepared.config);
            await manager.reconfigure(candidate, generation => persistStorageHistory(generation.config, prepared.requiresDurableStorageHistory === true));
            ensureOperational();
            variants.reconcile();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.logger.error('dsh-vision-toolkit: keeping the previous runtime after a refused Settings generation. %s', message);
        }
    };
    // Keep buffering while reconciliation itself awaits; no change can fall into the startup gap.
    while (pendingSettings !== undefined) {
        const pending = pendingSettings;
        pendingSettings = undefined;
        await reconcileSettings(pending.next, pending.previous);
    }
    applySettings = reconcileSettings;
    return () => {
        lifecycle.abort();
        if (operationalDisposers !== undefined) {
            operationalDisposers.exposure();
            operationalDisposers.activationTool();
            operationalDisposers.skill();
            operationalDisposers = undefined;
        }
        for (const dispose of disposers.reverse())
            dispose();
    };
}
//# sourceMappingURL=index.js.map