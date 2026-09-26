/**
 * `createFocusTrap` — accessible dialog focus trap. Delegates the actual
 * trapping (Tab/Shift+Tab containment, shadow-root-aware tabbable
 * enumeration, default initial/return focus) to
 * `@aihu/primitives/focus-trap`'s `createFocusTrap` — the single focus-trap
 * implementation in the aihu ecosystem (FEL-397 / aihu-project/aihu#537) —
 * rather than reimplementing it. On top of that primitive this composable
 * adds: an `onEscape` callback, `inertTargets` (siblings marked `inert`
 * while the trap is active), `initialFocus`/`returnFocus` as an
 * `HTMLElement` or a thunk (rather than the primitive's CSS-selector-only
 * `initialFocus`), automatic deactivation when the container disconnects
 * from the DOM, and an SSR no-op.
 *
 * Not an object-of-getters composable (deliberate divergence, like
 * `useEventListener`/`useMutationObserver`): the meaningful output is an
 * imperative `{ activate, deactivate }` handle, not reactive state.
 *
 * SSR (`isClient === false`): returns a trap whose `activate`/`deactivate`
 * are harmless no-ops — the `isClient` no-op invariant.
 */

import {
  createFocusTrap as createPrimitiveFocusTrap,
  type FocusTrap as PrimitiveFocusTrap,
} from '@aihu/primitives/focus-trap'
import { isClient, type MaybeGetter, toValue, tryOnScopeDispose } from '../shared/index.ts'

/** An explicit element, or a thunk resolving to one (or `null`) — used for
 * both `initialFocus` and `returnFocus`, resolved fresh each time it's
 * needed. */
export type FocusTarget = HTMLElement | (() => HTMLElement | null)

export interface CreateFocusTrapOptions {
  /** Focused on `activate()`, overriding the primitive's own default (first
   * tabbable descendant, or the container itself). Omitted/thunk-returns-`null`
   * keeps the primitive's default. */
  initialFocus?: FocusTarget
  /** Sibling elements marked `inert` for the duration of the trap (removed
   * from the accessibility tree and unreachable by pointer/keyboard) —
   * typically the rest of the page behind a modal. Restored to their PRIOR
   * `inert` state (not merely un-inerted) on `deactivate()`, so a target
   * that was already `inert` before `activate()` stays `inert` after. */
  inertTargets?: HTMLElement[]
  /** Focused on `deactivate()`, overriding the default of restoring focus to
   * whatever was focused immediately before `activate()`. Omitted/thunk-
   * returns-`null` falls back to that default. */
  returnFocus?: FocusTarget
  /** Called once per `Escape` keydown while the trap is active. Never
   * called while inactive. Does not itself deactivate the trap — the caller
   * decides what closing the dialog means. */
  onEscape?: () => void
}

export interface FocusTrap {
  /** Idempotent: a no-op if already active, or if `container` currently
   * resolves to nothing. */
  activate(): void
  /** Idempotent: a no-op if not active. */
  deactivate(): void
}

function resolveFocusTarget(target: FocusTarget | undefined): HTMLElement | null {
  if (target == null) return null
  return typeof target === 'function' ? target() : target
}

/**
 * Build a focus trap over `container` (a static element, or a getter for
 * one — resolved fresh on each `activate()` call, so a `$ref` that isn't
 * mounted yet at construction time works). Must work across shadow roots
 * (via the underlying primitive's composed-tree substrate) and clean up
 * automatically when the container disconnects or the surrounding effect
 * scope stops, without requiring an explicit `deactivate()` call.
 */
export function createFocusTrap(
  container: MaybeGetter<HTMLElement | null | undefined>,
  options: CreateFocusTrapOptions = {},
): FocusTrap {
  // SSR: register nothing, both methods are harmless no-ops.
  if (!isClient) {
    return { activate: () => {}, deactivate: () => {} }
  }

  let active = false
  let primitiveTrap: PrimitiveFocusTrap | null = null
  let previouslyFocused: HTMLElement | null = null
  let inertPrevious: Map<HTMLElement, boolean> | null = null
  let disconnectObserver: MutationObserver | null = null

  const onKeydown = (event: KeyboardEvent): void => {
    if (!active || event.key !== 'Escape') return
    options.onEscape?.()
  }

  const applyInert = (): void => {
    const targets = options.inertTargets
    if (!targets || targets.length === 0) return
    inertPrevious = new Map(targets.map((el) => [el, el.inert]))
    for (const el of targets) el.inert = true
  }

  const restoreInert = (): void => {
    if (inertPrevious == null) return
    for (const [el, was] of inertPrevious) el.inert = was
    inertPrevious = null
  }

  const deactivate = (): void => {
    if (!active) return
    active = false
    document.removeEventListener('keydown', onKeydown, true)
    disconnectObserver?.disconnect()
    disconnectObserver = null
    primitiveTrap?.deactivate()
    primitiveTrap = null
    restoreInert()
    const returnTarget = resolveFocusTarget(options.returnFocus) ?? previouslyFocused
    returnTarget?.focus()
    previouslyFocused = null
  }

  const activate = (): void => {
    if (active) return
    const el = toValue(container)
    if (el == null) return
    active = true
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null

    applyInert()

    // `returnFocus: false` — this composable owns return-focus itself (an
    // explicit target, not just the primitive's "restore previous" toggle).
    primitiveTrap = createPrimitiveFocusTrap(el, { returnFocus: false })
    primitiveTrap.activate()
    resolveFocusTarget(options.initialFocus)?.focus()

    document.addEventListener('keydown', onKeydown, true)

    // Watches the whole document (cheap DOM-mutation churn is the trade-off
    // for correctness): `el`'s own parent can itself be removed as part of
    // a larger subtree detach, so watching only `el.parentNode` would miss
    // that case. Auto-deactivating here is what lets a caller close a
    // dialog by unmounting it without remembering to call `deactivate()`.
    disconnectObserver = new MutationObserver(() => {
      if (!el.isConnected) deactivate()
    })
    disconnectObserver.observe(document, { childList: true, subtree: true })
  }

  tryOnScopeDispose(deactivate)

  return { activate, deactivate }
}
