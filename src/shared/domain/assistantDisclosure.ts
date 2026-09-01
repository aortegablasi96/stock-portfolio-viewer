/**
 * What may leave the machine, declared once, with **no dependencies** (Story #283, DDR-0097;
 * narrowed by Story #309, ADR-0011).
 *
 * Every other data path in this app ends on the owner's machine: the IBKR gateway is `localhost`,
 * the database is a file in `userData`, and ADR-0007 records that only map tiles and a viewport
 * reach Mapbox — no portfolio data, with `events.mapbox.com` omitted from the CSP so the platform
 * enforces it however the library is configured. Epic #5 breaks that, and ADR-0010 records why.
 *
 * **This module had three jobs and now has two.** It was the list the owner *read* before agreeing,
 * and the fingerprint of that list was what consent was stored against — so re-wording a category
 * withdrew consent until they read it again. ADR-0011 removes consent as a concept, and with it the
 * reading and the fingerprint. What is left is the part that binds the code rather than the owner:
 *
 * - the categories are the **only** keys an assistant context may carry
 *   ({@link AssistantContext}), so a later story cannot send something new without adding one here;
 * - {@link pickDisclosedSections} is where that stops being a type and becomes a fact, at the IPC
 *   boundary the renderer's assembled context crosses.
 *
 * `granularity` stays with each category for the same reason the list does: it declares at what
 * precision a section may be written, and DDR-0098's rule that no money goes in a section declared
 * as names or percentages is stated against it.
 *
 * Dependency-free like `investorProfileTerms.ts`, because Zod must not reach the renderer's bundle
 * (ADR-0002).
 */

/**
 * At what precision a category may be written, which is the distinction worth drawing.
 *
 * A great deal of this Epic works on **weights**, and a weight is meaningfully less disclosing
 * than a balance: "37% of your portfolio is in dollars" says nothing about how much money that is.
 * It was on screen as a chip beside each category until ADR-0011; what it is now is the bound a
 * section is written against — `assistantContext.test.ts` reads assembled sections back and fails
 * on money in one declared as names or percentages (DDR-0098).
 *
 * `GRANULARITY_LABELS` translated these into plain words for that chip, and went with it.
 */
export const DISCLOSURE_GRANULARITIES = ['names', 'weights', 'figures'] as const
export type DisclosureGranularity = (typeof DISCLOSURE_GRANULARITIES)[number]

export interface DisclosureCategory {
  readonly id: string
  /** What this is, as a heading. */
  readonly title: string
  /** Exactly what is sent, at its real granularity. Never softened into a benefit. */
  readonly detail: string
  readonly granularity: DisclosureGranularity
}

/**
 * Everything that may be sent, at its real granularity.
 *
 * The wording rule is the story's: state plainly that this leaves the machine and where it goes;
 * do not soften it. "Your portfolio data may be sent to OpenAI" is a shrug — what the owner needs
 * is which fields, at what precision, and whether absolute money is involved.
 */
export const DISCLOSURE_CATEGORIES = [
  {
    id: 'question',
    title: 'Your question',
    detail: 'The words you type, exactly as you type them.',
    granularity: 'names',
  },
  {
    id: 'holdings',
    title: 'What you hold',
    detail:
      'The ticker, company name, currency, sector and asset class of every position in your account.',
    granularity: 'names',
  },
  {
    // Re-worded by Story #328, which is the mechanism working rather than a slip in it — the same
    // way `performance` was re-worded by #285. `get_position` answers about one holding, and the
    // one figure it adds is how far that holding sits above or below what it cost. It is a
    // percentage and needs no exchange rate, so it stays inside this category's `weights`
    // granularity; what it is *not* is a share of the portfolio, so the declaration has to say it
    // rather than let it hide under "as percentages" (DDR-0098).
    id: 'weights',
    title: 'How your portfolio is divided',
    detail:
      'The share of your portfolio in each position, currency, sector and asset class, and how far one position is above or below what it cost, all as percentages. No amounts of money.',
    granularity: 'weights',
  },
  {
    id: 'profile',
    title: 'Your investor profile',
    detail:
      'The style tags and target ranges you set, how far each one is from your actual weights, and — for anything you have set no target for — how those weights sit against the app’s own default baseline. All as percentages.',
    granularity: 'weights',
  },
  {
    // Re-worded when Story #285 became the story that actually fills this category, and the
    // re-wording is the mechanism working rather than a slip in it: the figures are in the base
    // currency of the imported statements, not in the display currency this said, and they include
    // the portfolio's own value. A disclosure that named the wrong currency would be a lie about
    // the one category that carries money. The fingerprint moves, so consent is asked again — the
    // side this decision is meant to err on (DDR-0097).
    id: 'performance',
    title: 'How your portfolio has performed',
    detail:
      'Returns over the period you choose, as percentages, and your portfolio value, deposits and withdrawals, dividend income, costs and realised gains as amounts in the base currency of your imported statements.',
    granularity: 'figures',
  },
  {
    // **Added by Story #329, which is the mechanism working exactly as designed.** `get_data_coverage`
    // sends how many Flex statements are imported, the span they cover, when the last import ran,
    // their base currency, and how many local snapshots exist — and no category above names any of
    // it. The list is *"the only keys an assistant context may carry"*, so a story that needed to
    // send something new had one honest move: declare it. Deliberately `names` rather than
    // `weights`: there is no percentage in it and no amount of money, which its own text says.
    id: 'coverage',
    title: 'What data this app holds',
    detail:
      'How many Flex statements you have imported, the period they cover, when you last imported one, the base currency they are in, and how many portfolio snapshots have been captured and when. No positions, no weights and no amounts of money.',
    granularity: 'names',
  },
] as const satisfies readonly DisclosureCategory[]

export type DisclosureCategoryId = (typeof DISCLOSURE_CATEGORIES)[number]['id']

export const DISCLOSURE_CATEGORY_IDS: readonly DisclosureCategoryId[] = DISCLOSURE_CATEGORIES.map(
  (category) => category.id,
)

/**
 * Everything the assistant may send, keyed by the category that discloses it.
 *
 * The keys are the disclosure's own ids, and that is the enforcement: a later story assembling
 * context cannot add a section without adding a category above, and the type says so at compile
 * time. Values are the rendered text of each section — *what* goes in them is a later story's
 * concern (#285–#289); *that they are disclosed* is this one's.
 */
export type AssistantContext = Partial<Record<DisclosureCategoryId, string>>

/**
 * `disclosureFingerprint`, `disclosedGranularities` and `DISCLOSURE_DESTINATION` stood here.
 *
 * The fingerprint was what consent was stored against: change a category's wording and stored
 * consent stopped matching, so the owner was asked again rather than having silently agreed to
 * more than they read (DDR-0097). ADR-0011 records that it **ceases to exist** along with the
 * decision it protected — and the coupling it created, where a grounding change stopped the
 * assistant until the owner re-read a list, was one of the reasons the gate came out.
 *
 * The other two drew the panel: a summary line of which precisions the list involves, and the
 * sentence naming OpenAI as the destination. That panel is rendered nowhere (Story #309). The
 * destination is stated in ADR-0010, in ADR-0011, and on the field that takes the key.
 */

/**
 * Keep only the sections the declaration actually names (Story #284).
 *
 * `AssistantContext` already forbids an undeclared key at compile time, but the context is
 * assembled in the renderer and crosses IPC, where a type is a comment. This is the runtime half:
 * the boundary parses an arbitrary string map and this reduces it to the declared list, so "an
 * undeclared section cannot be sent" holds against a payload the type never reached. **It is the
 * job of this module that ADR-0011 left untouched**, and the stronger half of the two: it fails a
 * build rather than informing a reader.
 *
 * Empty and whitespace-only sections are dropped too. A heading with nothing under it tells the
 * model a section exists and is blank, which is an invitation to fill it in.
 */
export function pickDisclosedSections(
  raw: Readonly<Record<string, string | undefined>>,
  categories: readonly DisclosureCategory[] = DISCLOSURE_CATEGORIES,
): AssistantContext {
  const picked: Record<string, string> = {}
  for (const category of categories) {
    const body = raw[category.id]
    if (typeof body === 'string' && body.trim() !== '') picked[category.id] = body
  }
  return picked as AssistantContext
}
