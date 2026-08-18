import { formatUpdatedAt } from './format'

/**
 * The wording behind the one page header the five views share (Story #185, DDR-0058).
 *
 * Two things lived in components until this story and so had nothing checking them: the two
 * provenance strings — written once in `PortfolioDashboard` and once in `App`'s `AnalyticsPage`,
 * which is two copies of a sentence that has to agree with what the view actually read — and the
 * reading line, which `RefreshBar` expressed inline. Both are here for the reason everything in
 * `lib/` is here: Vitest runs Node-only (DDR-0029), so a string inside a component is a string
 * nothing can assert.
 */

/** The Portfolio view's provenance: the one view that reads Interactive Brokers live. */
export const LIVE_SOURCE = 'Live from Interactive Brokers'

/** The four analytics views' provenance: everything they show comes out of the local Flex store. */
export const IMPORTED_SOURCE = 'From imported Flex Query data'

/**
 * The freshness line: what was read, and when.
 *
 * `loadedAt` is tested **before** `refreshing`, which is a generalisation rather than a change.
 * The analytics views only ever render this line from their loaded branch, where `loadedAt` is
 * never null, so the two orderings are indistinguishable there. The Portfolio view has no such
 * branch — it renders one header over all five of its states — and on the very first read it is
 * busy with nothing yet read. "Refreshing…" would be a report on a reading that does not exist;
 * the empty string is the honest answer until one does.
 */
export function readingLine(
  refreshing: boolean,
  loadedAt: number | null,
  now: number = Date.now(),
): string {
  if (loadedAt === null) return ''
  return refreshing ? 'Refreshing…' : `Updated ${formatUpdatedAt(loadedAt, now)}`
}
