/**
 * Unit tests for `createFocusTrap`: delegation of Tab containment to
 * `@aihu/primitives/focus-trap`, `onEscape`, `inertTargets` (apply/restore),
 * `initialFocus`/`returnFocus` as an element or a thunk, auto-deactivation
 * on container disconnect, idempotent `activate`/`deactivate`, scope
 * cleanup, and the SSR-static no-op path. jsdom environment (root vitest
 * config).
 */
import { effectScope } from '@aihu/signals'
import { describe, expect, it, vi } from 'vitest'
import { createFocusTrap } from '../src/createFocusTrap/index.ts'
import { withSSR } from './_ssr.ts'

function makeDialog(): { dialog: HTMLElement; first: HTMLElement; last: HTMLElement } {
  const dialog = document.createElement('div')
  const first = document.createElement('button')
  first.textContent = 'first'
  const last = document.createElement('button')
  last.textContent = 'last'
  dialog.append(first, last)
  document.body.appendChild(dialog)
  return { dialog, first, last }
}

function pressEscape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

async function flushMutations(): Promise<void> {
  // MutationObserver callbacks fire in a microtask.
  await Promise.resolve()
  await Promise.resolve()
}

describe('@aihu/use/createFocusTrap', () => {
  it('activate() moves focus into the container (delegated to @aihu/primitives)', () => {
    const { dialog, first } = makeDialog()
    const trap = createFocusTrap(dialog)
    trap.activate()
    expect(document.activeElement).toBe(first)
    trap.deactivate()
  })

  it('Tab containment wraps at the edges (delegated trapping actually runs)', () => {
    const { dialog, first, last } = makeDialog()
    const trap = createFocusTrap(dialog)
    trap.activate()
    last.focus()
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(event)
    expect(document.activeElement).toBe(first)
    trap.deactivate()
  })

  it('onEscape fires once per Escape keydown while active', () => {
    const { dialog } = makeDialog()
    const onEscape = vi.fn()
    const trap = createFocusTrap(dialog, { onEscape })
    trap.activate()
    pressEscape()
    expect(onEscape).toHaveBeenCalledTimes(1)
    pressEscape()
    expect(onEscape).toHaveBeenCalledTimes(2)
    trap.deactivate()
  })

  it('onEscape does not fire when inactive', () => {
    const { dialog } = makeDialog()
    const onEscape = vi.fn()
    const trap = createFocusTrap(dialog, { onEscape })
    pressEscape()
    expect(onEscape).not.toHaveBeenCalled()
    trap.activate()
    trap.deactivate()
    pressEscape()
    expect(onEscape).not.toHaveBeenCalled()
  })

  it('inertTargets gain inert on activate() and lose it on deactivate()', () => {
    const { dialog } = makeDialog()
    const sibling = document.createElement('div')
    sibling.inert = false
    document.body.appendChild(sibling)

    const trap = createFocusTrap(dialog, { inertTargets: [sibling] })
    expect(sibling.inert).toBe(false)
    trap.activate()
    expect(sibling.inert).toBe(true)
    trap.deactivate()
    expect(sibling.inert).toBe(false)
  })

  it('inertTargets restore to their PRIOR state, not just unconditionally removed', () => {
    const { dialog } = makeDialog()
    const alreadyInert = document.createElement('div')
    alreadyInert.inert = true
    document.body.appendChild(alreadyInert)

    const trap = createFocusTrap(dialog, { inertTargets: [alreadyInert] })
    trap.activate()
    expect(alreadyInert.inert).toBe(true)
    trap.deactivate()
    // Was already inert before activate() — must remain inert after, not
    // be unconditionally cleared.
    expect(alreadyInert.inert).toBe(true)
  })

  it('initialFocus accepts an HTMLElement, overriding the primitive default', () => {
    const { dialog, last } = makeDialog()
    const trap = createFocusTrap(dialog, { initialFocus: last })
    trap.activate()
    expect(document.activeElement).toBe(last)
    trap.deactivate()
  })

  it('initialFocus accepts a thunk', () => {
    const { dialog, last } = makeDialog()
    const trap = createFocusTrap(dialog, { initialFocus: () => last })
    trap.activate()
    expect(document.activeElement).toBe(last)
    trap.deactivate()
  })

  it('returnFocus defaults to restoring the previously-focused element', () => {
    const { dialog } = makeDialog()
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()

    const trap = createFocusTrap(dialog)
    trap.activate()
    expect(document.activeElement).not.toBe(opener)
    trap.deactivate()
    expect(document.activeElement).toBe(opener)
  })

  it('returnFocus accepts an explicit HTMLElement/thunk, overriding the default', () => {
    const { dialog } = makeDialog()
    const opener = document.createElement('button')
    const other = document.createElement('button')
    document.body.append(opener, other)
    opener.focus()

    const trap = createFocusTrap(dialog, { returnFocus: () => other })
    trap.activate()
    trap.deactivate()
    expect(document.activeElement).toBe(other)
  })

  it('auto-deactivates (restoring inert targets and focus) when the container is removed without deactivate()', async () => {
    const { dialog } = makeDialog()
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const sibling = document.createElement('div')
    sibling.inert = false
    document.body.appendChild(sibling)

    const trap = createFocusTrap(dialog, { inertTargets: [sibling] })
    trap.activate()
    expect(sibling.inert).toBe(true)

    dialog.remove()
    await flushMutations()

    expect(sibling.inert).toBe(false)
    expect(document.activeElement).toBe(opener)

    // A second removal-triggered pass (or an explicit deactivate() call)
    // must be a harmless no-op — the trap already tore itself down.
    expect(() => trap.deactivate()).not.toThrow()
  })

  it('activate() and deactivate() are idempotent', () => {
    const { dialog, first } = makeDialog()
    const onEscape = vi.fn()
    const trap = createFocusTrap(dialog, { onEscape })
    trap.activate()
    trap.activate()
    expect(document.activeElement).toBe(first)
    trap.deactivate()
    trap.deactivate()
    pressEscape()
    expect(onEscape).not.toHaveBeenCalled()
  })

  it('activate() with a container that resolves to nothing is a no-op', () => {
    const trap = createFocusTrap(null)
    expect(() => trap.activate()).not.toThrow()
    expect(() => trap.deactivate()).not.toThrow()
  })

  it('accepts a getter container, resolved fresh on activate()', () => {
    const { dialog, first } = makeDialog()
    const trap = createFocusTrap(() => dialog)
    trap.activate()
    expect(document.activeElement).toBe(first)
    trap.deactivate()
  })

  it('scope.stop() deactivates an active trap', () => {
    const { dialog } = makeDialog()
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()

    const scope = effectScope()
    const trap = scope.run(() => createFocusTrap(dialog)) as ReturnType<typeof createFocusTrap>
    trap.activate()
    expect(document.activeElement).not.toBe(opener)
    scope.stop()
    expect(document.activeElement).toBe(opener)
  })
})

describe('@aihu/use/createFocusTrap — SSR-static path', () => {
  // The exhaustive zero-side-effect gate lives in ssr-safety.test.ts.

  it('with isClient false, activate/deactivate are harmless no-ops', () =>
    withSSR(
      () => import('../src/createFocusTrap/index.ts'),
      (mod) => {
        const trap = mod.createFocusTrap(null, { onEscape: () => {} })
        expect(() => {
          trap.activate()
          trap.deactivate()
        }).not.toThrow()
      },
    ))
})
