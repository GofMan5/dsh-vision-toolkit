/**
 * Transparent routing for the host model selector: when `imageInputVariants.hidden`
 * is enabled, variant routes keep the upstream provider/model display names and
 * the browser hides the upstream text-only entries that have a variant twin.
 * Users then see one entry per model — the original name — while the session
 * actually runs on the image-capable variant, so pasted images, history with
 * images, and the built-in `read_image` tool all keep working on text-only
 * models without exposing `(Vision Toolkit)` routes.
 *
 * The host selector renders one `[role=group]` per provider whose heading is
 * addressed by `aria-labelledby`. Two host generations put different identity
 * into that DOM:
 * - 0.1.5 hosts suffix the provider id onto the React heading id
 *   (`:rN:-<providerId>`), so groups are keyed by provider id and variant
 *   routes are recognized by the `vision-toolkit-` prefix;
 * - 0.2.0-rc hosts render a bare React `useId()` heading and carry no
 *   provider id in the DOM at all, so identity falls back to structure: in
 *   transparent mode a variant group repeats the upstream provider display
 *   name (the heading text) and the wrapped models' names, and the variant
 *   always registers AFTER the upstream it wraps — so a same-heading pair
 *   whose model names overlap is the twin pair, and the EARLIER group's
 *   twinned entries hide while the later (image-capable) group stays.
 *
 * The hiding decision is purely DOM-local: transparent mode is exactly the
 * case where a variant twin keeps the upstream display name, while explicit
 * mode appends `(Vision Toolkit)` and therefore never matches. No display-config
 * round-trip is needed before the selector can be tidied, so the first paint
 * of an opened menu already shows the merged list instead of flashing the
 * duplicate upstream group.
 * @module dsh-vision-toolkit/model-variants-hider
 */
/**
 * Hide upstream text-only entries that have a variant twin. Group keys come
 * from `aria-labelledby` ids where the host provides them (provider
 * identity is reliable even when the variant provider name equals the
 * upstream name — transparent mode); 0.2.0-rc groups without provider ids
 * fall back to the same-heading twin-pair rule.
 */
export declare function tidyModelSelector(): void;
/**
 * Install the transparent-routing integrator. It watches the document for
 * model-selector renderings and re-tidies them whenever the host re-renders.
 * Tidy runs in a microtask (before the browser paints) and is coalesced across
 * the render batch, so opening the selector never shows the upstream twins.
 * @returns the disposer that stops observation and restores hidden entries.
 */
export declare function installModelVariantsHider(): () => void;
/** Test seam: expose whether the integrator is currently installed. */
export declare function isModelVariantsHiderActive(): boolean;
//# sourceMappingURL=model-variants-hider.d.ts.map