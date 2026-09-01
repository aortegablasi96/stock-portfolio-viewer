import { flexStatementsService } from '@services/flex/flexStatementsService'
import { snapshotService } from '@services/snapshots/snapshotService'

/**
 * How current any of this is: what each local store holds, and on which clock (Story #329).
 *
 * ## Why a service exists for a join this small
 *
 * `get_data_coverage` was sketched over `flex:listStatements` **plus** `snapshot:list` — two methods
 * — and DDR-0111 forbids a tool spanning two, because a join is computation performed in the layer
 * least covered by service tests. The record weighed *"but it is only metadata"* and rejected it in
 * as many words: it is not a line anyone can hold, and the next such tool joins two figures. So the
 * join lands here, where the rest of the app's logic is tested, and the tool reaches one method.
 *
 * ## It always answers, and that is the whole design
 *
 * There is **no `needs_import`**. Every other analytics service has one because a report over
 * nothing would be a portfolio holding nothing; here, *nothing imported* is not a failure to report
 * coverage — it **is** the coverage, and it is the answer to the question being asked. A state in
 * its place would be the empty-report-standing-in-for-a-state failure running backwards.
 *
 * ## Why it never asks for a display currency
 *
 * `snapshotService.getHistory()` converts each capture's value when it is given one, which reaches
 * the IBKR gateway for rates. Coverage carries **no money at all**, so it asks for no conversion —
 * and the consequence is the one that matters: *how current is my data* stays answerable with the
 * gateway switched off. A coverage read that could fail on a socket would be unavailable exactly
 * when an owner most wants to know what the app still holds.
 */

/** What the imported Flex store holds, and when it was last added to. */
export interface FlexCoverage {
  statements: number
  /** Earliest statement start and latest statement end; `null` where nothing is imported. */
  from: number | null
  to: number | null
  /** When the most recent import ran — the store's own clock, not the statements'. */
  latestImportedAt: number | null
  /** Every base currency across the statements, sorted. More than one is worth saying out loud. */
  baseCurrencies: string[]
}

/** What the local snapshot history holds. Counts and times only — a snapshot's figures are not here. */
export interface SnapshotCoverage {
  captures: number
  earliest: number | null
  latest: number | null
}

/** The two local stores, side by side, as of the moment they were read. */
export interface DataCoverage {
  flex: FlexCoverage
  snapshots: SnapshotCoverage
  /** When this reading was taken — the third clock, and the one the live portfolio runs on. */
  readAt: number
}

export const dataCoverageService = {
  /**
   * Both stores, read locally, with no gateway call and no state to fall into.
   *
   * `now` is injectable for the reason every other service's is: a report naming the moment it was
   * read has to be assertable, and a clock read inside the function is one a test cannot pin.
   */
  async getCoverage(now: number = Date.now()): Promise<DataCoverage> {
    const store = flexStatementsService.listStatements()
    // No display currency, so no FX read and no gateway (see the header). The stored summaries are
    // all this needs: how many, and when.
    const snapshots = await snapshotService.getHistory()

    const capturedAt = snapshots.map((snapshot) => snapshot.capturedAt)

    return {
      flex: {
        statements: store.statements.length,
        from: store.coverage?.fromDate ?? null,
        to: store.coverage?.toDate ?? null,
        latestImportedAt:
          store.statements.length === 0
            ? null
            : Math.max(...store.statements.map((statement) => statement.importedAt)),
        baseCurrencies: [
          ...new Set(store.statements.map((statement) => statement.baseCurrency)),
        ].sort(),
      },
      snapshots: {
        captures: snapshots.length,
        earliest: capturedAt.length === 0 ? null : Math.min(...capturedAt),
        latest: capturedAt.length === 0 ? null : Math.max(...capturedAt),
      },
      readAt: now,
    }
  },
}
