import { z } from 'zod'

/**
 * Instrument sector / industry classification domain models (Milestone M3, Story #30).
 *
 * Flex statements carry no sector field, so classification is fetched from the IBKR
 * Client Portal Gateway and cached locally; the Allocation view then reads the cache and
 * works offline. Refreshing therefore *needs* a live gateway, and a closed gateway is
 * modelled as a result variant rather than an exception, consistent with every other
 * channel (ADR-0004, DDR-0002, DDR-0009).
 */

/** Outcome of a classification refresh over the instruments in the latest statement. */
export const classificationSummarySchema = z.object({
  /** Instruments considered (open positions in the latest imported statement). */
  total: z.number().int(),
  /** Instruments looked up from the gateway on this run (cached ones are skipped). */
  fetched: z.number().int(),
  /** Of those fetched, how many came back with a sector. */
  classified: z.number().int(),
  /** Instruments still without a sector after the run (no conid, or the source has none). */
  unclassified: z.number().int(),
})
export type ClassificationSummary = z.infer<typeof classificationSummarySchema>

/** Classification refresh result: a summary, or a first-class not-connected/error state. */
export const classifyInstrumentsResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), summary: classificationSummarySchema }),
  z.object({ status: z.literal('needs_import') }),
  z.object({ status: z.literal('not_connected'), message: z.string() }),
  z.object({ status: z.literal('error'), message: z.string() }),
])
export type ClassifyInstrumentsResult = z.infer<typeof classifyInstrumentsResultSchema>
