import { describe, expect, it, vi } from 'vitest'
import { createVersionStore, flexDataVersion, profileDataVersion } from './dataVersion'

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
   * The second store (Story #284, DDR-0098). A Flex write replaces the *figures* an answer quotes;
   * a profile write replaces the *standard* they are judged against, and only the Assistant cares
   * about the latter. Folding them into one would send all four analytics views back to the
   * database every time a target was typed — which is exactly why the separation is asserted here
   * rather than left to convention.
   */
  it('keeps the profile store apart from the flex one, so a saved target re-reads no analytics view', () => {
    const flexBefore = flexDataVersion.get()
    const profileBefore = profileDataVersion.get()
    const onFlex = vi.fn()
    const onProfile = vi.fn()
    const unsubscribeFlex = flexDataVersion.subscribe(onFlex)
    const unsubscribeProfile = profileDataVersion.subscribe(onProfile)

    profileDataVersion.bump()

    expect(profileDataVersion.get()).toBe(profileBefore + 1)
    expect(flexDataVersion.get()).toBe(flexBefore)
    expect(onProfile).toHaveBeenCalledTimes(1)
    expect(onFlex).not.toHaveBeenCalled()

    unsubscribeFlex()
    unsubscribeProfile()
  })
})
