import { snapshotRepository } from '@repositories/snapshots/snapshotRepository'
import { portfolioService } from '@services/portfolio/portfolioService'
import { IbkrNotConnectedError } from '@shared/errors'
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

export type CaptureOnOpenResult =
  | { status: 'captured'; summary: SnapshotSummary }
  | { status: 'skipped_recent'; latestCapturedAt: number }
  | { status: 'not_connected' }

export const snapshotService = {
  /**
   * Capture a snapshot on app open, subject to the 12-hour de-dupe window. When
   * the gateway is not connected the capture is skipped silently (no empty/error
   * snapshot is written), consistent with the connection-as-data convention.
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

  /** All captured snapshots, newest first (header-level summaries). */
  getHistory(): SnapshotSummary[] {
    return snapshotRepository.listSummaries()
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
