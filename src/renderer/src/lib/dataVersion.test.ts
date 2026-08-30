import { describe, expect, it, vi } from 'vitest'
import * as dataVersion from './dataVersion'
import { createVersionStore, flexDataVersion } from './dataVersion'

describe('createVersionStore', () => {
  it('starts at zero and increments on each bump', () => {
    const store = createVersionStore()

    expect(store.get()).toBe(0)
    store.bump()
    expect(store.get()).toBe(1)
    store.bump()
    expect(store.get()).toBe(2)
  })

  it('returns a stable value between bumps, so a subscriber sees no spurious change', () => {
    const store = createVersionStore()

    expect(store.get()).toBe(store.get())
  })

  it('notifies every subscriber on a bump', () => {
    const store = createVersionStore()
    const first = vi.fn()
    const second = vi.fn()
    store.subscribe(first)
    store.subscribe(second)

    store.bump()

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('reads the new version from inside a listener', () => {
    const store = createVersionStore()
    const seen: number[] = []
    store.subscribe(() => seen.push(store.get()))

    store.bump()
    store.bump()

    expect(seen).toEqual([1, 2])
  })

  it('stops notifying after unsubscribe', () => {
    const store = createVersionStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    unsubscribe()
    store.bump()

    expect(listener).not.toHaveBeenCalled()
    expect(store.get()).toBe(1)
  })

  it('survives a listener that unsubscribes itself while being notified', () => {
    const store = createVersionStore()
    const other = vi.fn()
    const unsubscribe = store.subscribe(() => unsubscribe())
    store.subscribe(other)

    expect(() => store.bump()).not.toThrow()
    expect(other).toHaveBeenCalledTimes(1)

    store.bump()
    expect(other).toHaveBeenCalledTimes(2)
  })

  it('keeps stores independent of each other', () => {
    const one = createVersionStore()
    const two = createVersionStore()

    one.bump()

    expect(one.get()).toBe(1)
    expect(two.get()).toBe(0)
  })

  it('exposes a shared flex store the views and the import panel both reach', () => {
    const before = flexDataVersion.get()
    const listener = vi.fn()
    const unsubscribe = flexDataVersion.subscribe(listener)

    flexDataVersion.bump()

    expect(flexDataVersion.get()).toBe(before + 1)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  /**
   * The store that is **no longer here** (Story #310, DDR-0108, superseding half of DDR-0098).
   *
   * A second store existed while the profile was written on one view and read on another: two
   * siblings of the shell, with nothing between them to hold a counter. #310 merged those views,
   * so the writer is now a sibling of the reader inside `AssistantView` and the counter is that
   * component's own state — the call `App` already makes for every fact the sidebar and a view
   * share (DDR-0056). What is asserted is the *absence*, because a module-level store nothing
   * imports is invisible to every other gate in the toolchain.
   */
  it('keeps the flex store as the only one, the profile having no view to cross', () => {
    expect(Object.keys(dataVersion)).toEqual(['createVersionStore', 'flexDataVersion'])
  })
})
