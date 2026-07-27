import { snapshotRepository } from '@repositories/snapshots/snapshotRepository'
import { portfolioService } from '@services/portfolio/portfolioService'
import { IbkrNotConnectedError, IbkrTimeoutError } from '@shared/errors'
import type { SnapshotSummary } from '@shared/domain/snapshot'

/**
 * Snapshot capture and history business logic (Milestone M2). The service owns the
 * capture policy (DDR-0003): capture-on-open is de-duplicated within a 12-hour
 * window, while manual capture always writes. It reaches Interactive Brokers only
 * through `portfolioService` and persists only through `snapshotRepository`, so it
 * stays framework-agnostic and unit-testable (both collaborators mocked).
 */

/** Skip an automatic on-open capture if a snapshot already exists within this window. */
export const DEDUPE_WINDOW_MS = 12 * 60 * 60 * 1000 // 12 hours

/** Round a money amount to cents, matching the live overview's conversion precision. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export type CaptureOnOpenResult =
  | { status: 'captured'; summary: SnapshotSummary }
  | { status: 'skipped_recent'; latestCapturedAt: number }
  | { status: 'not_connected' }
  /** The gateway accepted the request and then stalled past the bounded wait (Story #104). */
  | { status: 'not_responding' }

export const snapshotService = {
  /**
   * Capture a snapshot on app open, subject to the 12-hour de-dupe window. When
   * the gateway is not connected — or is connected but stalled past its bounded wait
   * (Story #104) — the capture is skipped silently (no empty/error snapshot is written),
   * consistent with the connection-as-data convention.
   */
  async captureOnOpen(now: number = Date.now()): Promise<CaptureOnOpenResult> {
    const latest = snapshotRepository.latestCapturedAt()
    if (latest !== undefined && now - latest < DEDUPE_WINDOW_MS) {
      return { status: 'skipped_recent', latestCapturedAt: latest }
    }

    try {
      const overview = await portfolioService.getOverview()
      const summary = snapshotRepository.append({ capturedAt: now, source: 'ibkr', overview })
      return { status: 'captured', summary }
    } catch (err) {
      if (err instanceof IbkrTimeoutError) return { status: 'not_responding' }
      if (err instanceof IbkrNotConnectedError) return { status: 'not_connected' }
      throw err
    }
  },

  /**
   * Capture a snapshot on explicit user request. Always writes (bypasses the
   * de-dupe window) — explicit intent is absolute. Propagates
   * `IbkrNotConnectedError` when the gateway is unavailable; the IPC handler maps
   * it to the renderer's `not_connected` state.
   */
  async captureNow(now: number = Date.now()): Promise<SnapshotSummary> {
    const overview = await portfolioService.getOverview()
    return snapshotRepository.append({ capturedAt: now, source: 'ibkr', overview })
  },

  /**
   * All captured snapshots, newest first (header-level summaries).
   *
   * When `displayCurrency` is given, each summary's `netLiquidation` — the **total** portfolio
   * value (holdings + cash), the headline figure the history list shows (Bug #68) — is
   * converted into it using live gateway FX rates, the same convention as the Portfolio view
   * (Bug #44, DDR-0007), and returned as `displayValue` (with `displayCurrency` set). Rows whose base
   * currency has no available rate carry `displayValue === null` and are flagged by the UI,
   * never silently mis-converted. History is a local read that must stay visible even when
   * the gateway is disconnected, so a `not_connected` gateway is not an error here: it
   * degrades to converting only rows already in the display currency (rate `1`) and flagging
   * the rest. Omitting `displayCurrency` returns the stored native summaries unchanged.
   */
  async getHistory(displayCurrency?: string): Promise<SnapshotSummary[]> {
    const summaries = snapshotRepository.listSummaries()
    if (!displayCurrency || summaries.length === 0) return summaries

    const rates = await ratesFor(summaries, displayCurrency)
    return summaries.map((summary) => {
      const rate = rates[summary.baseCurrency]
      return {
        ...summary,
        displayCurrency,
        // Convert the total portfolio value (holdings + cash), the figure the list shows
        // (Bug #68) — not the holdings-only `totalMarketValue`.
        displayValue: rate === undefined ? null : round2(summary.netLiquidation * rate),
      }
    })
  },

  /**
   * Clear the entire captured snapshot history so it can be started fresh (Story #43,
   * ADR-0006). A full, owner-confirmed reset — not a partial delete — independent of the
   * imported Flex store. Returns how many snapshots were removed.
   */
  clearHistory(): { removedSnapshots: number } {
    return { removedSnapshots: snapshotRepository.clearAll() }
  },
}

/**
 * Live FX rates converting every snapshot's base currency into `target`. A disconnected
 * gateway must not blank the history (it is a local read), so `IbkrNotConnectedError` — and
 * equally a gateway that stalls past its bounded wait (`IbkrTimeoutError`, Story #104) —
 * degrades to a rates map with `target` only: rows already in the display currency still
 * convert (rate `1`) and the rest are flagged unconverted. Other errors propagate.
 */
async function ratesFor(
  summaries: SnapshotSummary[],
  target: string,
): Promise<Record<string, number>> {
  try {
    return await portfolioService.getExchangeRates(
      summaries.map((s) => s.baseCurrency),
      target,
    )
  } catch (err) {
    if (err instanceof IbkrNotConnectedError || err instanceof IbkrTimeoutError) {
      return { [target]: 1 }
    }
    throw err
  }
}
