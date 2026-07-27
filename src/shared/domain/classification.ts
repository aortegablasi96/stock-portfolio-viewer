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

/**
 * How far a refresh got before it stopped, carried by every failure variant (Story #105).
 * A run that fails on instrument 30 of 40 still persisted the first 29, so the owner is told
 * what was saved rather than only what went wrong — and the next run asks for the rest.
 */
export const classificationPartialSchema = z.object({
  /** Instruments looked up from the gateway before the failure — all of them now cached. */
  fetched: z.number().int(),
  /** Of those, how many came back with a sector. */
  classified: z.number().int(),
  /** Instruments the run never reached; a subsequent refresh fetches exactly these. */
  remaining: z.number().int(),
})
export type ClassificationPartial = z.infer<typeof classificationPartialSchema>

/**
 * Live progress of a running refresh, pushed main→renderer over
 * `analytics:classifyProgress` after each sequential lookup (Story #105). Lookups stay
 * one-at-a-time against the single local gateway session (DDR-0009), which is precisely why
 * a long run needs to say how far along it is.
 */
export const classificationProgressSchema = z.object({
  /** Lookups completed so far. */
  completed: z.number().int(),
  /** Lookups this run will make — the uncached instruments, not every position. */
  total: z.number().int(),
})
export type ClassificationProgress = z.infer<typeof classificationProgressSchema>

/**
 * Classification refresh result: a summary, or a first-class not-connected / not-responding /
 * error state. `not_responding` is a gateway that accepted the request and then stalled past
 * the bounded wait — distinct from one that isn't running (Story #104, DDR-0022). Every
 * failure variant also carries `partial`, because a refresh that stops midway keeps what it
 * already fetched (Story #105, DDR-0023).
 */
export const classifyInstrumentsResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), summary: classificationSummarySchema }),
  z.object({ status: z.literal('needs_import') }),
  z.object({
    status: z.literal('not_connected'),
    message: z.string(),
    partial: classificationPartialSchema,
  }),
  z.object({
    status: z.literal('not_responding'),
    message: z.string(),
    partial: classificationPartialSchema,
  }),
  z.object({
    status: z.literal('error'),
    message: z.string(),
    partial: classificationPartialSchema,
  }),
])
export type ClassifyInstrumentsResult = z.infer<typeof classifyInstrumentsResultSchema>
