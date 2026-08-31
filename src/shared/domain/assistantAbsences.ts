import { BASELINE_UNCOVERED_NOTE, NO_SECTOR_UNIVERSE_NOTE } from './portfolioBaseline'

/**
 * What the app does not compute, said on **every** question (Story #325, DDR-0111).
 *
 * ## The story DDR-0110 warned about, by name
 *
 * Three prohibitions in the system prompt are **conditional** — a cause (*"unless the available
 * data supports the explanation"*), a risk statistic (*"unless explicitly supplied"*) and a
 * benchmark (*"unless comparison data is explicitly available"*) — and DDR-0110 recorded what makes
 * them obeyable:
 *
 * > The conditionals are safe **because** the context is explicit, which makes the two now coupled:
 * > a later story that trims the absence blocks would silently unbind three prohibitions.
 *
 * Until now the blocks were unconditional only by accident of where they lived: `uncomputedBlock`
 * was part of `performanceSection`, which is assembled whenever there is a Flex history to window.
 * A question asked with nothing imported already got the prompt's *"unless explicitly supplied"*
 * with nothing left asserting that nothing was — and under Epic #322 the same hole opens far wider,
 * because a model that never calls the performance tool never meets the block at all.
 *
 * **Nothing fails when that breaks.** No type, no state, no test — which is the whole reason this is
 * a module of its own rather than a paragraph inside one. Here the text is a declared list, it is
 * emitted by {@link BASE_CONTEXT} above every section and every report, and
 * `assistantAbsences.test.ts` ties each of the three conditional prompt passages to the sentence
 * that supports it. Trimming one now fails a test instead of unbinding a rule in silence.
 *
 * ## Why it is the base context and not a tool
 *
 * DDR-0111 weighed a `get_absences` tool and rejected it in one line: *a prohibition whose
 * supporting fact the model may decline to fetch is not a prohibition.* So these ride in the base
 * context that goes with every question — not a tool, not a tool argument, and not conditional on
 * any tool having been called. `buildPrompt` emits them whether or not a single section was
 * assembled, which is what makes "on every question" a property of the code.
 *
 * A report that carries figures these qualify still **restates its own** — `performanceSection`'s
 * calendar span is the first of them. That is belt-and-braces and is deliberately not what holds
 * the prohibitions; this module is.
 *
 * ## Why it is in `@shared` and imports nothing but a sibling
 *
 * Tools execute in **main** and the assembled context is built in the **renderer** (DDR-0111,
 * decision 2), so both processes need this text and neither may own it. It is dependency-free but
 * for `portfolioBaseline`, which is dependency-free itself — so no Zod can reach the renderer's
 * bundle through it (DDR-0105, `zodIsolation.test.ts`).
 *
 * ## Four sets, from four places
 *
 * The performance absences (DDR-0101), the baseline's own (DDR-0109), what a currency weight is,
 * and which store each figure came out of and on what clock (DDR-0098). The last is here for a
 * reason particular to this Epic: composition is Flex and drift is live, and reports **arriving
 * separately** is exactly how that pairing gets lost.
 */

/**
 * What a currency weight in this app is a weight *of*, said wherever one appears.
 *
 * A currency exposure has two readings and the app only computes one: this is the currency each
 * position is held and priced in, which is not where the underlying business earns its revenue. An
 * owner holding a US-listed miner in dollars has dollar *pricing* and commodity revenue, and a
 * sentence about "currency exposure" that does not say which it means is wrong for whichever
 * reading the reader had (Story #287).
 *
 * **It moved here from the renderer in Story #325.** It was a constant of `assistantContext.ts`
 * while the only thing that could carry it was a context section; it is now stated unconditionally
 * as well as beside each breakdown it qualifies, and a tool result in main will want it too.
 */
export const CURRENCY_EXPOSURE_NOTE =
  'Currency here is the currency each position is held and priced in — not the currency the underlying business earns its revenue in, which this app does not know.'

/**
 * No annualised figure exists — the one absence a model does not experience as a calculation.
 *
 * "Roughly 30% a year" reads as a restatement of "+5% over two months" rather than as a derivation,
 * and it is meaningless besides. The honest fact takes its place, and it is **per period**: how many
 * calendar days the period really covers is a figure only the report carrying that period holds, so
 * this sentence names where to find it rather than inventing one (DDR-0101).
 */
export const NO_ANNUALISED_NOTE =
  'No annualised, per-year, compounded or "p.a." figure exists. A return is the return over the period it is labelled with, and each report gives that period’s calendar span.'

/** No benchmark exists. Comparison data is Epic #7, a different source in a different milestone. */
export const NO_BENCHMARK_NOTE =
  'No benchmark, index, market or peer figure exists. This app holds no market data beyond this portfolio’s own history, so never say the portfolio beat, lagged, tracked, outperformed or underperformed anything.'

/**
 * No risk statistic exists, and what does exist is named so the sentence has somewhere to land.
 *
 * Daily returns are real (DDR-0049), so dispersion *can* be described — from the counts and the two
 * extremes a report actually carries, and from nothing else. A Sharpe ratio quoted beside them
 * would be indistinguishable in tone from the figures that were computed.
 */
export const NO_RISK_STATISTIC_NOTE =
  'No volatility, standard deviation, Sharpe ratio, beta, drawdown or other risk statistic exists. The daily-return counts and best and worst day a report gives are the only dispersion there is.'

/**
 * Where the app's own standard applies, and where it says nothing at all (ADR-0012, DDR-0109).
 *
 * The **deferred** half of the baseline's absences, and the only half that can be stated
 * unconditionally: *which* checks a reading deferred is report data, but *that the baseline stands
 * down wherever the owner has spoken* is a property of the app. Without it, a conversation that
 * fetched a baseline verdict and no profile would have nothing saying the two are not the same kind
 * of claim — which is the whole of what ADR-0012 traded for the capability.
 */
export const BASELINE_SILENCE_NOTE =
  'The app’s baseline is silent wherever the owner set a target — theirs governs, and a check it did not run is named in the report.'

/**
 * Which store a figure came out of, and on which clock — stated once, above everything (DDR-0098).
 *
 * Each section and each report already opens by naming its own source, and that stays. What this
 * adds is the **pairing**: that there are two of them, that they do not tick together, and that a
 * sentence mixing them is wrong in a way no reader could catch. It matters more under Epic #322
 * than it did before — an assembled context arrives as one document with its sources in view, while
 * reports arriving one at a time make the clock the easiest thing in them to drop.
 */
export const STORE_AND_CLOCK_NOTE =
  'TWO STORES, TWO CLOCKS. Returns, value, composition, income and costs come from imported Flex statements, as of the latest one imported and never as of today. Holdings, weights and drift are read live, at the moment named beside them. Never mix the two.'

/** How the absences open: what they are, and that they hold whatever else the question carries. */
export const ABSENCE_HEADING =
  'WHAT THIS APP DOES NOT COMPUTE — none of it may be supplied, whatever reports this question carries and when it carries none:'

/**
 * One absence, named so a test can enumerate them rather than scan for a phrase.
 *
 * `id` is what the coupling test in `assistantAbsences.test.ts` binds a prompt rule to; `text` is
 * what reaches the model. A set removed from the list fails that test by disappearing from it,
 * which is the failure mode DDR-0110 says must stop being silent.
 */
export interface AbsenceDisclosure {
  readonly id:
    | 'annualised'
    | 'benchmark'
    | 'risk_statistic'
    | 'baseline_silence'
    | 'baseline_currency'
    | 'sector_universe'
    | 'currency_exposure'
    | 'store_and_clock'
  readonly text: string
}

/**
 * The four sets, flattened into the eight statements they come to.
 *
 * Declared rather than concatenated inline, for DDR-0104's reason applied again: a list whose
 * length is assertable makes removing one a decision rather than an edit.
 */
export const ABSENCE_DISCLOSURES: readonly AbsenceDisclosure[] = [
  { id: 'annualised', text: NO_ANNUALISED_NOTE },
  { id: 'benchmark', text: NO_BENCHMARK_NOTE },
  { id: 'risk_statistic', text: NO_RISK_STATISTIC_NOTE },
  { id: 'baseline_silence', text: BASELINE_SILENCE_NOTE },
  { id: 'baseline_currency', text: BASELINE_UNCOVERED_NOTE },
  { id: 'sector_universe', text: NO_SECTOR_UNIVERSE_NOTE },
  { id: 'currency_exposure', text: CURRENCY_EXPOSURE_NOTE },
  { id: 'store_and_clock', text: STORE_AND_CLOCK_NOTE },
]

/**
 * Which of the eight are absences of *computation*, and so ride under the heading as a list.
 *
 * The other two are not absences at all — one says what a currency weight *is* and the other which
 * clock a figure was read on — so they are stated as their own paragraphs rather than as bullets
 * under a heading that would misdescribe them.
 */
const UNCOMPUTED: readonly AbsenceDisclosure['id'][] = [
  'annualised',
  'benchmark',
  'risk_statistic',
  'baseline_silence',
  'baseline_currency',
  'sector_universe',
]

const textOf = (id: AbsenceDisclosure['id']): string =>
  ABSENCE_DISCLOSURES.find((disclosure) => disclosure.id === id)!.text

/**
 * The base context, in the words the model reads — **the same string on every question**.
 *
 * A constant rather than a function, because nothing in it varies: it is a statement about the app,
 * not about a reading of the portfolio. That is also why it discloses nothing and is not a
 * `DISCLOSURE_CATEGORIES` entry — there is no owner data in it to declare (DDR-0098).
 */
export const BASE_CONTEXT = [
  [ABSENCE_HEADING, ...UNCOMPUTED.map((id) => `- ${textOf(id)}`)].join('\n'),
  textOf('currency_exposure'),
  textOf('store_and_clock'),
].join('\n\n')
