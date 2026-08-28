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
 * The investor profile's version, bumped when it is saved or cleared (Story #284, DDR-0098).
 *
 * A second store rather than a second bump of the first, because they are not the same fact: a
 * Flex write replaces the *figures* an answer quotes, and a profile write replaces the *standard*
 * they are judged against. The four analytics views care about the first and nothing else, and
 * folding the two together would send all four back to the database every time a target was typed.
 *
 * It exists for the same reason `flexDataVersion` does. The Assistant mounts on first visit and
 * then stays mounted (DDR-0027), so an owner who sets a profile and walks back to the Assistant
 * arrives at a view still holding the reading it took before there was one — which, with nothing
 * imported and no gateway, means being told there is nothing to ground an answer in while a
 * profile sits on the next page. Found by `e2e/assistant-ask.spec.ts`, not by reasoning.
 */
export const profileDataVersion = createVersionStore()
