/**
 * What may leave the machine, declared once, with **no dependencies** (Story #283, DDR-0097).
 *
 * Every other data path in this app ends on the owner's machine: the IBKR gateway is `localhost`,
 * the database is a file in `userData`, and ADR-0007 records that only map tiles and a viewport
 * reach Mapbox — no portfolio data, with `events.mapbox.com` omitted from the CSP so the platform
 * enforces it however the library is configured. Epic #5 breaks that, ADR-0010 records why, and
 * this module is the part the owner actually reads before it happens.
 *
 * **It is the source of truth, not a description of one.** A disclosure maintained by hand becomes
 * a lie on the first change, so the categories below are also the *only* keys an assistant context
 * may carry ({@link AssistantContext}) — a later story cannot send something new without adding a
 * category here, and adding a category changes {@link disclosureFingerprint}, which withdraws
 * consent until the owner reads the new list. Consent is to a **specific disclosure**, not to the
 * idea of one.
 *
 * Dependency-free like `investorProfileTerms.ts`, because the renderer renders it directly and Zod
 * must not reach that bundle (ADR-0002).
 */

/**
 * How disclosing a category is, which is the distinction worth drawing.
 *
 * A great deal of this Epic works on **weights**, and a weight is meaningfully less disclosing
 * than a balance: "37% of your portfolio is in dollars" says nothing about how much money that is.
 * Naming the granularity lets the disclosure say which questions send which — see the finding
 * recorded in DDR-0097.
 */
export const DISCLOSURE_GRANULARITIES = ['names', 'weights', 'figures'] as const
export type DisclosureGranularity = (typeof DISCLOSURE_GRANULARITIES)[number]

/** How each granularity is described to the owner, once, in plain words. */
export const GRANULARITY_LABELS: Record<DisclosureGranularity, string> = {
  names: 'Names and text',
  weights: 'Percentages only',
  figures: 'Amounts of money',
}

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
    id: 'weights',
    title: 'How your portfolio is divided',
    detail:
      'The share of your portfolio in each position, currency, sector and asset class, as percentages. No amounts of money.',
    granularity: 'weights',
  },
  {
    id: 'profile',
    title: 'Your investor profile',
    detail:
      'The style tags and target ranges you set, and how far each one is from your actual weights — all as percentages.',
    granularity: 'weights',
  },
  {
    id: 'performance',
    title: 'How your portfolio has performed',
    detail:
      'Returns over the period you ask about, as percentages, and dividend income and realised gains as amounts in your display currency.',
    granularity: 'figures',
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
 * A stable fingerprint of what is currently disclosed.
 *
 * Consent is granted against a specific list. When the list changes — a later story sends
 * something new — the fingerprint changes and stored consent stops matching, so the owner is asked
 * again rather than having silently agreed to more than they read. That is the whole reason the
 * disclosure lives in code the app reads rather than in prose someone maintains.
 *
 * The **detail text is part of it**, not just the ids: re-wording what a category actually sends
 * is exactly the change an owner would want to see again, and a fingerprint over ids alone would
 * miss it. Purely cosmetic edits therefore cost one re-consent, which is the right side to err on.
 */
export function disclosureFingerprint(
  categories: readonly DisclosureCategory[] = DISCLOSURE_CATEGORIES,
): string {
  return categories
    .map((category) => `${category.id}:${category.granularity}:${category.detail}`)
    .join('|')
}

/** Which granularities the current disclosure actually involves, in declaration order. */
export function disclosedGranularities(
  categories: readonly DisclosureCategory[] = DISCLOSURE_CATEGORIES,
): DisclosureGranularity[] {
  return DISCLOSURE_GRANULARITIES.filter((granularity) =>
    categories.some((category) => category.granularity === granularity),
  )
}

/** Where the data goes, named rather than implied. Rendered beside the categories. */
export const DISCLOSURE_DESTINATION =
  'OpenAI, in the United States, over the internet. This is the only feature in this app that sends anything about your portfolio off this machine.'

/**
 * Keep only the sections the disclosure actually declares (Story #284).
 *
 * `AssistantContext` already forbids an undisclosed key at compile time, but the context is
 * assembled in the renderer and crosses IPC, where a type is a comment. This is the runtime half:
 * the boundary parses an arbitrary string map and this reduces it to the list the owner read, so
 * "an undisclosed section cannot be sent" holds against a payload the type never reached.
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
