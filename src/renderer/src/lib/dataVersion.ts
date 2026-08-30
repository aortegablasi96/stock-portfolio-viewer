/**
 * The renderer's "the imported Flex store changed" signal (Story #109).
 *
 * The analytics views stay mounted once visited, so a view the owner isn't looking at is
 * still holding the report it read earlier. That is the point — returning to a tab shows
 * its data immediately — but it means an import or a clear on the Portfolio tab would
 * otherwise leave four views showing history that no longer exists. Every write path
 * (`FlexImport`, the inline `NeedsImport` action) bumps this counter, and every view's
 * `useAnalytics` re-reads when it changes.
 *
 * A module-level store rather than React context: there is exactly one renderer window and
 * one Flex store behind it, the value is a plain counter, and keeping it out of the React
 * tree means no provider to thread through the shell — and it stays unit-testable under
 * Vitest's Node environment, where no component can be rendered.
 *
 * Deliberately *not* a cache of the data itself. What the views keep is their own already
 * -mounted state; this only tells them when that state is stale. Nothing here knows what a
 * report contains, so it can't drift from one.
 */
export interface VersionStore {
  /** The current version. Stable between bumps, so it is safe as a `useSyncExternalStore` snapshot. */
  get: () => number
  /** Record that the underlying data changed, notifying every subscriber. */
  bump: () => void
  /** Subscribe to bumps; returns the unsubscribe, matching the app's event-subscription shape. */
  subscribe: (listener: () => void) => () => void
}

export function createVersionStore(): VersionStore {
  let version = 0
  const listeners = new Set<() => void>()

  return {
    get: () => version,
    bump: () => {
      version += 1
      // Copied before iterating: a listener that unsubscribes itself while being notified
      // would otherwise mutate the set mid-iteration.
      for (const listener of [...listeners]) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** The imported Flex statement store's version — bumped by both Flex write paths. */
export const flexDataVersion = createVersionStore()

/**
 * There is **no second store for the investor profile** (Story #310, DDR-0108).
 *
 * There was one, and it existed for this module's own reason: the profile was written on one view
 * and read on another, two siblings of the shell with nothing between them, so the write had to
 * reach a mounted view that had already taken its reading (DDR-0098, DDR-0027). Story #310 merged
 * those two views, and the writer is now a sibling of the reader inside `AssistantView` — which
 * makes a plain counter in that component the smaller mechanism and the honest one, the same call
 * `App` makes for every fact the sidebar and a view share (DDR-0056).
 *
 * `flexDataVersion` stays, because nothing about it changed: the Flex store is written on the
 * Portfolio view and read by four others that are not its descendants.
 */
