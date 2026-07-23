import {
  classificationRepository,
  type ClassificationRow,
} from '@repositories/classification/classificationRepository'
import { flexReadRepository } from '@repositories/flex/flexReadRepository'
import type { ClassifyInstrumentsResult } from '@shared/domain/classification'
import { IbkrNotConnectedError } from '@shared/errors'

/**
 * Sector / industry classification refresh (Milestone M3, Story #30).
 *
 * Owns the policy the repositories deliberately don't: *which* instruments to look up.
 * Only the open positions of the latest imported statement are considered, and only those
 * missing from the local cache are fetched — including instruments the gateway previously
 * answered "no classification" for, which are cached as `sector: ''` so they are asked
 * about once, not on every refresh.
 *
 * Lookups are sequential on purpose: the Client Portal Gateway is a single local session
 * and a personal portfolio is a few dozen instruments, so a burst of parallel requests
 * would buy nothing and risk rate-limiting. See DDR-0009.
 */

export const classificationService = {
  /**
   * Fetch and cache classifications for the latest statement's positions. Returns
   * `needs_import` when no Flex data exists and `not_connected` when the gateway is
   * closed — both as data, so the renderer renders them as first-class states.
   */
  async refreshClassifications(): Promise<ClassifyInstrumentsResult> {
    const latest = flexReadRepository.getLatestOpenPositions()
    if (!latest) return { status: 'needs_import' }

    // One entry per instrument; positions without a conid can't be looked up at all.
    const wanted = new Map<number, string>()
    let withoutConid = 0
    for (const position of latest.positions) {
      if (position.conid == null) {
        withoutConid += 1
        continue
      }
      if (!wanted.has(position.conid)) wanted.set(position.conid, position.symbol)
    }

    const cached = new Map(classificationRepository.getAll().map((row) => [row.conid, row]))
    const missing = [...wanted].filter(([conid]) => !cached.has(conid))

    try {
      await classificationRepository.ensureConnected()

      const fetchedRows: ClassificationRow[] = []
      const now = Date.now()
      for (const [conid, symbol] of missing) {
        const { sector, industry } = await classificationRepository.fetchClassification(conid)
        fetchedRows.push({ conid, symbol, sector, industry, fetchedAt: now })
      }
      classificationRepository.upsertMany(fetchedRows)

      for (const row of fetchedRows) cached.set(row.conid, row)
      const unclassified =
        withoutConid + [...wanted.keys()].filter((conid) => !cached.get(conid)?.sector).length

      return {
        status: 'ok',
        summary: {
          total: wanted.size + withoutConid,
          fetched: fetchedRows.length,
          classified: fetchedRows.filter((row) => row.sector !== '').length,
          unclassified,
        },
      }
    } catch (err) {
      if (err instanceof IbkrNotConnectedError) {
        return { status: 'not_connected', message: err.message }
      }
      const message =
        err instanceof Error ? err.message : 'Unexpected error classifying instruments.'
      return { status: 'error', message }
    }
  },
}
