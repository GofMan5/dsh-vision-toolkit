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

const VARIANT_PROVIDER_PREFIX = 'vision-toolkit-'

/** Elements we hid and their original inline display value, for restoration. */
const hiddenElements = new Map<HTMLElement, string>()

let active = false
let observer: MutationObserver | undefined
let tidyQueued = false

/**
 * Derive the provider id from a group's `aria-labelledby` title id. 0.1.5
 * hosts embed it as `:rN:-<providerId>` (or a `-`-prefixed id); a bare
 * React `useId()` (0.2.0-rc hosts) carries no provider identity at all and
 * answers undefined so the structural fallback takes over.
 */
function providerIdOf(group: Element): string | undefined {
  const labelledBy = group.getAttribute('aria-labelledby')
  if (labelledBy === null || labelledBy === '') return undefined
  const titleId = document.getElementById(labelledBy)?.id ?? labelledBy
  const reactPrefixed = /^:[^:]+:-(.+)$/u.exec(titleId)
  if (reactPrefixed !== null) return reactPrefixed[1]
  if (/^:[^:]+:$/u.test(titleId)) return undefined
  return titleId.replace(/^-/u, '')
}

function modelNames(group: Element): string[] {
  return [...group.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
    .map(button => (button.title || (button.textContent ?? '')).trim())
    .filter(Boolean)
}

function hideElement(element: HTMLElement): void {
  if (!hiddenElements.has(element)) hiddenElements.set(element, element.style.display)
  element.style.display = 'none'
}

function restoreHidden(): void {
  for (const [element, display] of hiddenElements) {
    element.style.display = display
  }
  hiddenElements.clear()
}

/**
 * Hide upstream text-only entries that have a variant twin. Group keys come
 * from `aria-labelledby` ids where the host provides them (provider
 * identity is reliable even when the variant provider name equals the
 * upstream name — transparent mode); 0.2.0-rc groups without provider ids
 * fall back to the same-heading twin-pair rule.
 */
export function tidyModelSelector(): void {
  if (document.querySelector('[role="menu"]') === null) return
  // The host re-renders selectors while sessions stay open; drop bookkeeping
  // for entries that already left the DOM so the map cannot grow unboundedly.
  for (const element of [...hiddenElements.keys()]) {
    if (!element.isConnected) hiddenElements.delete(element)
  }
  const groups = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="group"]')]
  const byProvider = new Map<string, HTMLElement[]>()
  const unidentified: Array<{ element: HTMLElement; heading: string; names: string[] }> = []
  for (const group of groups) {
    const provider = providerIdOf(group)
    if (provider === undefined) {
      const heading = (document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent ?? '').trim()
      unidentified.push({ element: group, heading, names: modelNames(group) })
      continue
    }
    const entries = byProvider.get(provider)
    if (entries === undefined) byProvider.set(provider, [group])
    else entries.push(group)
  }

  const shouldHide = new Set<HTMLElement>()
  for (const [provider, providerGroups] of byProvider) {
    if (!provider.startsWith(VARIANT_PROVIDER_PREFIX)) continue
    const upstream = provider.slice(VARIANT_PROVIDER_PREFIX.length)
    const twinNames = new Set(providerGroups.flatMap(modelNames))
    if (twinNames.size === 0) continue
    for (const upstreamGroup of byProvider.get(upstream) ?? []) {
      const buttons = [...upstreamGroup.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
      const matched: HTMLElement[] = []
      for (const button of buttons) {
        const name = (button.title || (button.textContent ?? '')).trim()
        if (twinNames.has(name)) matched.push(button)
      }
      if (matched.length === 0) continue
      for (const button of matched) shouldHide.add(button)
      // Collapse the whole group only when every model has a variant twin;
      // otherwise a partially matched group keeps its unmatched entries.
      if (matched.length === buttons.length) shouldHide.add(upstreamGroup)
    }
  }

  // 0.2.0-rc structural fallback: a same-heading pair whose model names
  // overlap is the transparent-mode upstream/variant twin pair. The variant
  // registers after the upstream it wraps, so the later group is the
  // image-capable twin and the earlier group's twinned entries hide.
  for (let i = 0; i < unidentified.length; i += 1) {
    const earlier = unidentified[i]
    if (earlier === undefined || earlier.heading === '') continue
    for (let j = i + 1; j < unidentified.length; j += 1) {
      const later = unidentified[j]
      if (later === undefined || earlier.heading !== later.heading) continue
      const laterNames = new Set(later.names)
      if (laterNames.size === 0) continue
      const buttons = [...earlier.element.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
      const matched = buttons
        .map(button => [button, (button.title || (button.textContent ?? '')).trim()] as const)
        .filter(([, name]) => laterNames.has(name))
        .map(([button]) => button)
      if (matched.length === 0) continue
      for (const button of matched) shouldHide.add(button)
      if (matched.length === buttons.length) shouldHide.add(earlier.element)
    }
  }

  // Restore entries whose twin disappeared (e.g. transparent routing was
  // disabled and the wrapper rebuilt with explicit `(Vision Toolkit)` names).
  for (const [element, display] of [...hiddenElements]) {
    if (!shouldHide.has(element)) {
      element.style.display = display
      hiddenElements.delete(element)
    }
  }
  for (const element of shouldHide) hideElement(element)
}

/**
 * Install the transparent-routing integrator. It watches the document for
 * model-selector renderings and re-tidies them whenever the host re-renders.
 * Tidy runs in a microtask (before the browser paints) and is coalesced across
 * the render batch, so opening the selector never shows the upstream twins.
 * @returns the disposer that stops observation and restores hidden entries.
 */
export function installModelVariantsHider(): () => void {
  if (observer !== undefined) {
    // A previous install is still active; a duplicate effect must not tear
    // down the integrator while its original owner still expects it.
    return () => {}
  }
  let disposed = false
  const tidySoon = (): void => {
    if (tidyQueued || disposed) return
    tidyQueued = true
    queueMicrotask(() => {
      tidyQueued = false
      if (disposed) return
      active = true
      tidyModelSelector()
    })
  }

  observer = new MutationObserver(tidySoon)
  observer.observe(document.body, { childList: true, subtree: true })
  active = true
  tidyModelSelector()

  return () => {
    disposed = true
    observer?.disconnect()
    observer = undefined
    tidyQueued = false
    restoreHidden()
    active = false
  }
}

/** Test seam: expose whether the integrator is currently installed. */
export function isModelVariantsHiderActive(): boolean {
  return active
}
