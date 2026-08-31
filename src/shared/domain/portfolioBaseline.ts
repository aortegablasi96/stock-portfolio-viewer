/**
 * The app's own default standard, with **no dependencies** (Story #315, ADR-0012).
 *
 * Every other standard in this app is the owner's: the investor profile is a setting they write,
 * and `balanceDriftService` measures against it and against nothing else (DDR-0094, DDR-0095).
 * This module is the one exception, and ADR-0012 is the record that permits it.
 *
 * Three properties make it defensible, and all three live here rather than in a prompt:
 *
 * - **It is data the app owns.** A reviewer can read the numbers, argue with them, and change them
 *   in one place. The model never supplies a threshold, never varies one, and never computes a gap
 *   against one — ADR-0009's grounding rule reaches this exactly as it reaches every other figure.
 * - **It is versioned.** {@link BASELINE_VERSION} travels into the assembled context, so an answer
 *   the owner keeps says which baseline produced it.
 * - **It fills a silence and never contradicts a statement.** A check runs only where the profile
 *   states nothing about that dimension. Measuring an owner's stated 40% target against a 30%
 *   default would be *proposing the policy*, which ADR-0009 forbids in the half ADR-0012 leaves
 *   standing.
 *
 * Dependency-free like `investorProfileTerms.ts` and `assetClass.ts`, so the renderer may import it
 * as values without pulling Zod into that bundle (ADR-0002, DDR-0105).
 */
import { CASH_ASSET_KEY } from './assetClass'

/**
 * Which baseline produced a judgement.
 *
 * An integer rather than a date: the question a reader asks is *"is this the same standard as last
 * time"*, and two runs an hour apart under an unchanged module must answer yes. Bump it whenever a
 * threshold below moves or a check is added or removed.
 */
export const BASELINE_VERSION = 1

/**
 * The checks the baseline can run, as a declared list.
 *
 * Counted in a test for the reason `SYSTEM_PROMPT_RULES` is (DDR-0104): the risk this module runs is
 * **accretion** — a check per story until the app is a robo-advisor by increments — and a list whose
 * length is asserted is one a story cannot grow without saying so.
 */
export const BASELINE_CHECKS = ['position', 'sector', 'cash', 'coverage'] as const
export type BaselineCheck = (typeof BASELINE_CHECKS)[number]

/**
 * Which part of the profile governs each check.
 *
 * This mapping *is* the "the owner's profile always wins" rule, written once. A check whose
 * governing field carries anything at all does not run: the owner has spoken about that dimension,
 * and the app has nothing to add to it.
 *
 * `cash` and `coverage` are both governed by the asset-class targets because uninvested cash sits in
 * the asset-class dimension under {@link CASH_ASSET_KEY} — an owner who targets asset classes has
 * already said what weight of cash they want.
 */
export const BASELINE_CHECK_GOVERNED_BY: Record<BaselineCheck, 'positionSize' | 'sector' | 'assetClass'> = {
  position: 'positionSize',
  sector: 'sector',
  cash: 'assetClass',
  coverage: 'assetClass',
}

/**
 * The ceilings, in percent of the placed portfolio.
 *
 * These are **defaults, not findings**, and every answer that uses one says so. What each is doing:
 *
 * - `position` — 10%, the single number here with a external anchor: UCITS' *5/10/40* rule caps a
 *   diversified fund's exposure to one issuer at 10%. It is also the same shape as the profile's own
 *   `positionSize` ceiling, which is what makes deferring to that field a clean swap.
 * - `sector` — 30%, deliberately loose. The baseline exists to catch a portfolio that is obviously
 *   out of shape, not to nag one that is merely tilted; a tight default would fire on most real
 *   portfolios and be read past.
 * - `cash` — 15%. Uninvested cash above roughly this is a decision rather than a float, and the app
 *   can see it plainly.
 *
 * **There is no currency ceiling, and its absence is a decision** (ADR-0012). The app knows the
 * currency a position is *priced* in and not where the business earns its money — the distinction
 * the prompt already carries as a rule of its own. A default ceiling on currency weight would assert
 * an exposure the app cannot see. `BASELINE_UNCOVERED_NOTE` is what says so in the context.
 */
export const BASELINE_CEILINGS: Record<'position' | 'sector' | 'cash', number> = {
  position: 10,
  sector: 30,
  cash: 15,
}

/**
 * The asset classes whose **absence** is a shape observation rather than a preference.
 *
 * The full vocabulary is `ASSET_CLASS_LABELS`, and most of it does not belong here. Holding no
 * `ETF` is not a gap when the same exposure is held as `STK` or `FUND` — those three are alternative
 * wrappers, so their absence says nothing. `OPT`, `FOP`, `FUT` and `WAR` are derivatives, and
 * holding none of them is not a diversification gap in any sense worth reporting.
 *
 * What is left is the pair a portfolio's shape genuinely turns on: whether it holds anything that is
 * not equity-like, and whether it holds any uninvested cash at all.
 *
 * This is the **only** place the app names something a portfolio is missing, and it can do it here
 * for one reason: the asset-class vocabulary is fixed and the app owns it. There is no equivalent
 * for sectors — see {@link NO_SECTOR_UNIVERSE_NOTE}.
 */
export const BASELINE_COVERAGE_CLASSES: readonly string[] = ['BOND', CASH_ASSET_KEY]

/**
 * Why the baseline says nothing about currency, in the words the context carries.
 *
 * DDR-0101's rule, applied to a standard rather than to a figure: what the app does not compute is
 * named, so an absent verdict cannot read as a clean one.
 */
export const BASELINE_UNCOVERED_NOTE =
  'The baseline covers no currency: a currency weight is where a position is priced, not where a business earns, so the app sets no default there. Judge currency against the owner’s targets or not at all.'

/**
 * Why no sector is ever named as missing, in the words the context carries.
 *
 * The app's "sector" is IBKR's `industry` field, and what it returns is an open-ended, fine-grained
 * vocabulary — `Banks`, `Mining`, `Food`, `Textiles`, `Diversified Finan Serv` — not a closed
 * taxonomy of a dozen sectors. So the app holds **no universe of sectors** and cannot know which one
 * a portfolio is absent from.
 *
 * It is stated in the *grounding* rather than left to a prompt rule, because a model asked which
 * sectors are missing will answer from training data unless it is told the list does not exist. A
 * rule that needs a fact to be obeyable is a gap in the grounding (DDR-0104).
 */
export const NO_SECTOR_UNIVERSE_NOTE =
  'The app holds no list of sectors, only names its own classification data produced for held instruments, so it cannot know which sectors are absent: never name a missing sector, never suggest one to add, and say that a missing-sector list is not something this app computes.'

/** How the baseline describes itself wherever a judgement of its quotes it. */
export const BASELINE_LABEL = 'the app’s default baseline'
