import { describe, expect, it } from 'vitest'
import {
  ABSENCE_DISCLOSURES,
  ABSENCE_HEADING,
  BASE_CONTEXT,
  CURRENCY_EXPOSURE_NOTE,
  NO_ANNUALISED_NOTE,
  NO_BENCHMARK_NOTE,
  BASELINE_SILENCE_NOTE,
  NO_RISK_STATISTIC_NOTE,
  STORE_AND_CLOCK_NOTE,
} from './assistantAbsences'
import { BASELINE_UNCOVERED_NOTE, NO_SECTOR_UNIVERSE_NOTE } from './portfolioBaseline'

/**
 * The absences the whole prompt rests on (Story #325, DDR-0110, DDR-0111).
 *
 * **This module is guarded because nothing else fails when it is trimmed.** DDR-0110 made three
 * prompt rules conditional — a cause, a risk statistic, a benchmark — and recorded in as many words
 * that the conditionals are safe *because* the context states each absence outright. Delete a
 * statement and the rule reads *"do not report volatility unless explicitly supplied"* with nothing
 * left asserting that nothing was. No type breaks, no state changes, no other test notices.
 *
 * What is asserted here is the block's own shape: the four sets are present, the list is declared,
 * and it holds no figure of its own. The **coupling** — each prompt rule beside the sentence that
 * supports it — is asserted in `assistantService.test.ts`, where the prompt is, so nothing in
 * `@shared` has to reach up into a service to hold it.
 */

describe('the absences are a declared list, not prose in a section', () => {
  /**
   * Eight statements over the four sets Story #325 names — performance, baseline, currency, and
   * store-and-clock. Counted for DDR-0104's reason, applied again: a list whose length is asserted
   * makes removing one a decision rather than an edit.
   */
  it('is eight statements, each reaching the model', () => {
    expect(ABSENCE_DISCLOSURES).toHaveLength(8)
    for (const disclosure of ABSENCE_DISCLOSURES) {
      expect(disclosure.text.trim()).not.toBe('')
      expect(BASE_CONTEXT).toContain(disclosure.text)
    }
  })

  /** Every id is distinct, so a set cannot be lost by being written twice under one name. */
  it('names each statement once', () => {
    const ids = ABSENCE_DISCLOSURES.map((disclosure) => disclosure.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  /**
   * The four sets, each from the record that requires it: DDR-0101's three overclaims, DDR-0109's
   * two baseline absences, the currency reading the app does not compute, and DDR-0098's pairing.
   */
  it('carries all four sets of disclosure', () => {
    // Performance (DDR-0101).
    expect(BASE_CONTEXT).toContain(NO_ANNUALISED_NOTE)
    expect(BASE_CONTEXT).toContain(NO_BENCHMARK_NOTE)
    expect(BASE_CONTEXT).toContain(NO_RISK_STATISTIC_NOTE)
    // The baseline's own (DDR-0109, ADR-0012) — the same constants the profile section quotes,
    // not a copy, plus the deferral rule that is the app's rather than a reading's.
    expect(BASE_CONTEXT).toContain(BASELINE_SILENCE_NOTE)
    expect(BASE_CONTEXT).toContain(BASELINE_UNCOVERED_NOTE)
    expect(BASE_CONTEXT).toContain(NO_SECTOR_UNIVERSE_NOTE)
    // What a currency weight is.
    expect(BASE_CONTEXT).toContain(CURRENCY_EXPOSURE_NOTE)
    // Which store, and which clock (DDR-0098).
    expect(BASE_CONTEXT).toContain(STORE_AND_CLOCK_NOTE)
  })

  /** The absences open the block, under a heading that says they hold whatever else it carries. */
  it('opens with the heading, and says the absences hold whether or not a report arrived', () => {
    expect(BASE_CONTEXT.startsWith(ABSENCE_HEADING)).toBe(true)
    expect(ABSENCE_HEADING).toContain('when it carries none')
  })

  /**
   * It is a statement about the app, so it holds no reading of the portfolio — no figure, no date,
   * no currency amount. That is what makes it the same string on every question, and what makes it
   * safe to send when nothing has been imported at all.
   */
  it('contains no figure of its own', () => {
    expect(BASE_CONTEXT).not.toMatch(/\d/)
  })

  /** It states absence and never a cause, the guard every grounding module in this app carries. */
  it('offers no cause for anything', () => {
    expect(BASE_CONTEXT).not.toMatch(/\bbecause\b/i)
    expect(BASE_CONTEXT).not.toMatch(/\bdue to\b/i)
    expect(BASE_CONTEXT).not.toMatch(/\bdriven by\b/i)
  })
})

/**
 * What the *cause* prohibition rests on, which is the least obvious of the three (Story #325).
 *
 * *"Do not claim why … unless the available data supports the explanation"* is answerable only by a
 * model that knows what the available data **is**: two stores on two clocks, holding weights and
 * values and no news, no fundamentals and no market beyond this portfolio's own history. Those are
 * the store-and-clock statement and the benchmark statement doing a second job, and the coupling
 * test in `assistantService.test.ts` names them as its support.
 */
describe('what the available data is, said so a cause can be refused', () => {
  it('names both stores, and the market data that does not exist', () => {
    expect(BASE_CONTEXT).toContain('no market data beyond this portfolio’s own history')
    expect(BASE_CONTEXT).toContain('imported Flex statements')
    expect(BASE_CONTEXT).toContain('read live, at the moment named beside them')
    expect(BASE_CONTEXT).toContain('Never mix the two')
  })
})
