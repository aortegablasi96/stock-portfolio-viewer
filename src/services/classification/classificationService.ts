import {
  classificationRepository,
  type ClassificationRow,
} from '@repositories/classification/classificationRepository'
import { flexReadRepository } from '@repositories/flex/flexReadRepository'
import type {
  ClassificationPartial,
  ClassificationProgress,
  ClassifyInstrumentsResult,
} from '@shared/domain/classification'
import { IbkrNotConnectedError, IbkrTimeoutError } from '@shared/errors'

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
 *
 * That sequence is exactly why a refresh is *resumable* rather than transactional: whatever
 * it fetched is written before any failure is reported, so a gateway that dies on instrument
 * 30 of 40 costs ten lookups, not thirty (Story #105, DDR-0023).
 */

export const classificationService = {
  /**
   * Fetch and cache classifications for the latest statement's positions. Returns
   * `needs_import` when no Flex data exists and `not_connected` when the gateway is
   * closed — both as data, so the renderer renders them as first-class states.
   *
   * `onProgress` is called once before the first lookup (so the renderer learns the total)
   * and once after each one. It is optional and purely informational: the service has no idea
   * whether anything is listening, and never lets a listener's failure affect the refresh.
   */
  async refreshClassifications(
    onProgress?: (progress: ClassificationProgress) => void,
  ): Promise<ClassifyInstrumentsResult> {
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

    const fetchedRows: ClassificationRow[] = []
    const howFarItGot = (): ClassificationPartial => ({
      fetched: fetchedRows.length,
      classified: fetchedRows.filter((row) => row.sector !== '').length,
      remaining: missing.length - fetchedRows.length,
    })

    // Reporting progress is a courtesy, not part of the operation: if a tick can't be
    // delivered (the window closed mid-refresh) the refresh carries on regardless.
    const report = (completed: number): void => {
      try {
        onProgress?.({ completed, total: missing.length })
      } catch {
        // A listener's failure is not the refresh's problem.
      }
    }

    try {
      // The fetch loop's failure is *captured*, not propagated, so the rows it did collect
      // are persisted below before anything is reported (Story #105).
      let failure: unknown
      try {
        await classificationRepository.ensureConnected()
        report(0)

        const now = Date.now()
        for (const [conid, symbol] of missing) {
          const { sector, industry } = await classificationRepository.fetchClassification(conid)
          fetchedRows.push({ conid, symbol, sector, industry, fetchedAt: now })
          report(fetchedRows.length)
        }
      } catch (err) {
        failure = err
      }

      // Runs on both paths: a completed refresh and an interrupted one write the same way,
      // which is what makes a partial run leave the cache strictly better off. The next
      // refresh re-reads the cache and asks only for what is still missing.
      classificationRepository.upsertMany(fetchedRows)
      for (const row of fetchedRows) cached.set(row.conid, row)

      if (failure !== undefined) return failureResult(failure, howFarItGot())

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
      // Only reachable if persisting itself failed — the gateway's own failures are handled
      // above. Reported like any other, with what the gateway had answered by then.
      return failureResult(err, howFarItGot())
    }
  },
}

/**
 * Map a failed refresh onto its result variant, carrying how far it got. A stall is reported
 * separately from a closed gateway — the owner's fix differs — and the first timed-out lookup
 * ends the sequential loop, so a refresh is bounded by one timeout rather than one per
 * instrument (Story #104, DDR-0022).
 */
function failureResult(err: unknown, partial: ClassificationPartial): ClassifyInstrumentsResult {
  if (err instanceof IbkrTimeoutError) {
    return { status: 'not_responding', message: err.message, partial }
  }
  if (err instanceof IbkrNotConnectedError) {
    return { status: 'not_connected', message: err.message, partial }
  }
  const message = err instanceof Error ? err.message : 'Unexpected error classifying instruments.'
  return { status: 'error', message, partial }
}
