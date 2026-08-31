/**
 * Pure display formatters for the portfolio UI. Kept out of components so the
 * number/locale logic can be unit-tested directly (ui-builder guidance).
 *
 * ## Why this lives in `@shared` and not in the renderer (Story #324, DDR-0111)
 *
 * It was `renderer/src/lib/format.ts` for the app's whole life, which was right while the renderer
 * was the only process that wrote a figure for a person to read. Epic #322 puts the second one in
 * place: a tool result is computed and **rendered into prose in main**, and DDR-0098's criterion is
 * that a figure in an answer and the same figure on a dashboard agree to the digit. Two
 * implementations of "how this app writes a percentage" is exactly the drift that criterion exists
 * to prevent, so there is still exactly one — now reachable from both processes.
 *
 * The move cost a path change and nothing else, because **this module imports nothing**. That is
 * also what satisfies `zodIsolation.test.ts` by construction rather than by a rule somebody has to
 * remember: a module with no dependencies cannot pull Zod into the renderer bundle (DDR-0105).
 * **Keep it that way** — a single `import` here is a bundle decision, not a convenience.
 */

/**
 * The one locale every figure in this app is written in — **both processes, one value**.
 *
 * Every formatter below used to pass `undefined`, which resolves the *host's* default. That was
 * correct and invisible while one process wrote every figure. With two it is a bug waiting for a
 * reader: Electron's main process resolves its locale from Node's ICU and the OS, the renderer from
 * Chromium's own language settings, and nothing makes the two agree. The failure it produces is the
 * one DDR-0098 exists to prevent and the hardest kind to notice — `1,234.50` in an answer beside
 * `1.234,50` on the dashboard it was computed from, the *same* figure, silently disagreeing in a
 * separator.
 *
 * So the locale is **declared, not discovered** (DDR-0111). A resolver that reads each host's
 * default would centralise the call and leave the disagreement exactly where it was; only a fixed
 * value makes "main and the renderer format the same value identically" a property rather than a
 * hope.
 *
 * `en-GB` because it is what the app already is. Its copy is British English throughout, and this
 * file's own worked example of a formatted timestamp — *"27 Jul, 09:04"* in {@link formatUpdatedAt}
 * — is `en-GB` output, written down long before anything enforced it. It is a **display** decision
 * and touches no stored value: money is stored in minor units or `real` with its own currency
 * code, and every timestamp is epoch-ms UTC.
 */
export const APP_LOCALE = 'en-GB'

/**
 * Format a monetary value. Interactive Brokers' base-currency ledger reports the
 * pseudo-code `BASE` (and positions may lack a currency); in those cases we fall
 * back to a plain 2-decimal number rather than a currency symbol.
 */
export function formatCurrency(value: number, currency: string, locale = APP_LOCALE): string {
  if (currency && currency !== 'BASE') {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value)
    } catch {
      // Not a valid ISO currency code — fall through to plain formatting.
    }
  }
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/**
 * Format a per-share money figure — a dividend rate, or tax withheld per share. These run
 * far smaller than the totals `formatCurrency` is tuned for (a real rate is often
 * CAD 0.094), so two decimals would round a genuine rate to "0.09" or away to "0.00".
 * Up to four decimals are kept, trailing zeros dropped past the usual two.
 */
export function formatPerShare(value: number, currency: string, locale = APP_LOCALE): string {
  if (currency && currency !== 'BASE') {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      }).format(value)
    } catch {
      // Not a valid ISO currency code — fall through to plain formatting.
    }
  }
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value)
}

/** Format a share/contract quantity (fractional shares allowed, no forced decimals). */
export function formatQuantity(value: number, locale = APP_LOCALE): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value)
}

/** Format an allocation weight expressed as a fraction in [0, 1] as a percentage. */
export function formatPercent(fraction: number, locale = APP_LOCALE): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(fraction)
}

/** Format a snapshot capture time (epoch milliseconds, UTC) in the app's locale. */
export function formatDateTime(epochMs: number, locale = APP_LOCALE): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(epochMs))
}

/**
 * Format when a view last read its data, for the analytics views' freshness line
 * (Story #109) — "14:32" while the app has been open since this morning, "27 Jul, 09:04"
 * once the reading crosses a day boundary, because a bare clock time on a window left open
 * overnight reads as fresher than it is.
 *
 * `now` is a parameter rather than a `Date.now()` call so the day comparison is testable.
 */
export function formatUpdatedAt(
  epochMs: number,
  now: number = Date.now(),
  locale = APP_LOCALE,
): string {
  const at = new Date(epochMs)
  const today = new Date(now)
  const sameDay =
    at.getFullYear() === today.getFullYear() &&
    at.getMonth() === today.getMonth() &&
    at.getDate() === today.getDate()

  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(at)
  if (sameDay) return time
  return `${new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(at)}, ${time}`
}

/** Format a plain date (epoch milliseconds, UTC) — no time — for Flex statement ranges. */
export function formatDate(epochMs: number, locale = APP_LOCALE): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(epochMs))
}

/**
 * Format a monetary value with an explicit leading sign (+/−) — for P&L, income, and
 * other figures where the direction matters. Zero carries no sign.
 */
export function formatSignedCurrency(value: number, currency: string, locale = APP_LOCALE): string {
  const base = formatCurrency(Math.abs(value), currency, locale)
  if (value < 0) return `-${base}`
  if (value > 0) return `+${base}`
  return base
}

/** Format an already-percent value (e.g. a TWR of 7.12 → "7.12%"). */
export function formatPercentValue(value: number, locale = APP_LOCALE): string {
  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}%`
}

/** Format an already-percent value with an explicit leading sign (+/−). Zero carries no sign. */
export function formatSignedPercent(value: number, locale = APP_LOCALE): string {
  const base = formatPercentValue(Math.abs(value), locale)
  if (value < 0) return `-${base}`
  if (value > 0) return `+${base}`
  return base
}

/**
 * A **difference between two percentages**, in the unit that difference is actually in (Story
 * #287).
 *
 * "Ten percent above a 50% target" is two different quantities and one of them is wrong: 60% is ten
 * *points* above 50%, and twenty *percent* above it. The distinction is invisible in a chart and
 * decisive in a sentence, which is why the unit is spelled out in words rather than left to a `%`
 * sign the reader has to interpret. Everything Story #287 computes — a drift-closing move, a year
 * against the previous year — is a difference, so everything it writes uses this.
 *
 * The words are always plural. "1.00 percentage point" would be the grammatical form and is not
 * worth a branch: the figure is fixed at two decimals, so an exact 1.00 is a coincidence rather
 * than a case.
 */
export function formatPoints(value: number, locale = APP_LOCALE): string {
  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} percentage points`
}

/**
 * The same, with an explicit leading sign — for a difference whose direction is the point.
 *
 * A value that rounds to zero at the two decimals shown carries **no** sign. These figures are
 * differences of chain-linked returns, so an exact tie arrives as `-1.4e-14` and would otherwise
 * read as `-0.00 percentage points` — a direction the figure does not have, in a sentence a model
 * is being asked to quote verbatim.
 */
export function formatSignedPoints(value: number, locale = APP_LOCALE): string {
  const base = formatPoints(Math.abs(value), locale)
  if (Math.abs(value) < 0.005) return base
  return value < 0 ? `-${base}` : `+${base}`
}

/**
 * A token with no vowel is not a word, so it is an acronym and keeps its capitals (Story #214).
 *
 * IBKR exports every name in capitals, so nothing in the input distinguishes `LVMH` from `GOLD`:
 * the case that would have carried the answer is the case being replaced. This is the one signal
 * left that costs nothing to be wrong about — a vowel-less run of two or more letters is not
 * pronounceable as a word in any of the languages these names come from.
 *
 * It is deliberately narrow, and the misses are the point of writing it down: `AB`, `SAP`, `AIG`
 * and `BASF` all contain a vowel and still title-case to `Ab`, `Sap`, `Aig`, `Basf`. Widening it
 * needs a signal, not a longer list of consonants — a wrong guess here renames a company, which
 * is worse than leaving one shouting.
 */
const ACRONYM = /^[BCDFGHJKLMNPQRSTVWXZ]{2,}$/

/**
 * Title-case a name, one word at a time. A word is a run between spaces, hyphens and slashes, so
 * an apostrophe is *inside* one and `LEON'S` becomes `Leon's` rather than `Leon'S`.
 *
 * Hyphens stay word separators, which is right for `COCA-COLA` → `Coca-Cola` and wrong for
 * `CO-OPERATIVE` → `Co-Operative`. Both are hyphenated, both arrive in capitals, and nothing in
 * either distinguishes them; the same holds for `MCLENNAN` → `Mclennan`. Story #214 leaves both
 * alone deliberately (DDR-0067) rather than trading one wrong answer for another.
 */
function titleCaseWords(s: string): string {
  return s.replace(/[^\s\-/]+/g, (word) =>
    ACRONYM.test(word) ? word : word.toLowerCase().replace(/^[a-z]/, (c) => c.toUpperCase()),
  )
}

/**
 * A legal form — never part of a company's name, so it is stripped wherever it trails, and
 * repeatedly ("… HOLDINGS PLC", once `HOLDINGS` has been handled by {@link TRAILING_NOUN}).
 *
 * `SPA` stays in this list. It is the Italian *S.p.A.*, and the owner holds two companies
 * carrying it (`FILA SPA`, `NEWPRINCES SPA`); a wellness business whose name genuinely ends in
 * the word would be shortened wrongly. That is a trade made on evidence — two real holdings
 * against a hypothetical one (Story #214, DDR-0067).
 */
const LEGAL_FORM =
  /\s+(?:INC(?:ORPORATED)?|CORP(?:ORATION)?|LIMITED|LTD|PLC|LLC|LLP|LP|SE|SA|SPA|AG|NV|ASA|AB|OYJ)\.?$/i

/**
 * A common noun that is *often part of the name itself*, which is the distinction Story #214
 * draws (DDR-0067). `GROUP` in `GOLDMAN SACHS GROUP INC` is boilerplate; `GROUP` in
 * `JUROKU FINANCIAL GROUP INC` is the company. One rule cannot read both, so the owner's call is
 * the position: **strip it only when it is the last word.** A name ending in the noun is naming
 * a kind of company; a name that continues past it into a legal form is using it.
 */
const TRAILING_NOUN = /\s+(?:COMPANY|CO|GROUP|GRP|HOLDINGS?|HLDGS?)\.?$/i

/**
 * Shorten a raw IBKR instrument name into a readable company name — e.g.
 * "INTERACTIVE BROKERS GRO-CL A" → "Interactive Brokers", "SERABI GOLD PLC" → "Serabi Gold",
 * "GLOBAL PAYMENTS INC" → "Global Payments". Strips a trailing share-class descriptor and any
 * legal-form suffixes, then title-cases. Falls back to the trimmed input if stripping would
 * empty it.
 *
 * It assumes its input **is** a company name, and title-casing is where that assumption bites:
 * `"EUR.CHF"` becomes `"Eur.chf"` and `"CAD"` becomes `"Cad"`. Every view therefore reaches it
 * through {@link instrumentName}, which is the function that decides whether a description is a
 * name at all (Story #211, DDR-0066). Call this one directly only if you already know.
 */
export function formatCompanyName(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '') return trimmed
  // Drop a trailing share-class / group-class descriptor: "GRO-CL A", "-CL A",
  // "CL A", "CLASS A", "SER A", … (with anything after it).
  let s = trimmed.replace(/[\s-]+(?:[A-Z]{2,4}[\s-]*)?(?:CL|CLASS|SER|SERIES)\.?\s*[A-D]\b.*$/i, '')

  // A common noun goes **only where it is the last word** (Story #214, DDR-0067) — once, and
  // before any legal form, so "last word" means last in what IBKR exported rather than last in
  // whatever survives once INC has gone.
  s = s.replace(TRAILING_NOUN, '')
  // A legal form is never part of a name, so it goes wherever it trails, and repeatedly.
  while (LEGAL_FORM.test(s)) s = s.replace(LEGAL_FORM, '')

  s = s.replace(/[.,\s]+$/, '').trim()
  if (s === '') return titleCaseWords(trimmed)
  // A leading article pairs with the noun that has just been removed: "THE WALT DISNEY COMPANY"
  // is a name and "The Walt Disney" is not. Dropped only where something *was* stripped, which
  // is what leaves "THE TORONTO-DOMINION BANK" intact.
  if (s !== trimmed) s = s.replace(/^THE\s+/i, '')
  return titleCaseWords(s === '' ? trimmed : s)
}

/** Format a `YYYY-MM` month key as e.g. "Jan 2026"; passes through anything else (e.g. "Unknown"). */
export function formatMonth(key: string, locale = APP_LOCALE): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key)
  if (!match) return key
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1))
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

/**
 * The readable name for an instrument, or `null` where the import carries none (Story #211,
 * DDR-0066).
 *
 * Three of the five views draw a ticker with a secondary line under it, and the line is the
 * instrument's `description` as IBKR exported it. For a stock that description is a company name
 * and {@link formatCompanyName} makes it readable. For everything else it is **the identifier
 * again**, which is what IBKR writes when an instrument has no name of its own:
 *
 * ```text
 *   flex_trades          CASH   "EUR.CHF"  ->  "EUR.CHF"     a currency pair
 *   flex_fifo_summaries  CASH   "CAD"      ->  "CAD"         a bare currency code
 *   flex_securities      STK    "SBI"      ->  "SERABI GOLD PLC"
 * ```
 *
 * So the test is not the shape of the string — a regex for `XXX.YYY` would have caught the
 * currency pairs in the trade history and missed the bare codes in the realized-gains table, and
 * both were already on screen. It is whether the description **says anything the symbol does
 * not**. That answer comes from the row itself rather than from `assetCategory`, which is the
 * same reason Story #192 keyed a badge's tone off an amount instead of a list of type strings
 * (DDR-0064): a category is a vocabulary that grows, and `RealizedBySymbol` does not carry one
 * anyway.
 *
 * `null` rather than the raw string, because a secondary line repeating the ticker above it is
 * not a quieter name — it is the same text twice, and it read as a rendering fault on the FX rows
 * of the trade history. The caller renders nothing.
 */
export function instrumentName(symbol: string, description: string): string | null {
  const name = description.trim()
  if (name === '') return null
  if (name.toUpperCase() === symbol.trim().toUpperCase()) return null
  return formatCompanyName(name)
}

/**
 * The name for a *live* holding, which has two candidate descriptions rather than one (Story #263
 * follow-up).
 *
 * The gateway's `description` is the symbol again on this build, so the Portfolio view read
 * `IBKR · IBKR` where Allocation — drawing the same instrument from imported Flex history — read
 * `Interactive Brokers`. `companyName` is that history's answer, resolved by conid in the service.
 *
 * **The Flex name wins where there is one**, and the gateway's description is the fallback rather
 * than the other way round: a build that does send real names would put them in `description`, and
 * the account's own imported `SecurityInfo` is still the better answer for an instrument it knows.
 * Both go through {@link instrumentName}, so the *same* string shortens the same way here as in
 * every other view, and a description that only repeats the ticker still resolves to `null`.
 */
export function holdingName(
  symbol: string,
  description: string,
  companyName: string | null,
): string | null {
  return instrumentName(symbol, companyName ?? description)
}
