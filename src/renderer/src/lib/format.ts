/**
 * Pure display formatters for the portfolio UI. Kept out of components so the
 * number/locale logic can be unit-tested directly (ui-builder guidance).
 */

/**
 * Format a monetary value. Interactive Brokers' base-currency ledger reports the
 * pseudo-code `BASE` (and positions may lack a currency); in those cases we fall
 * back to a plain 2-decimal number rather than a currency symbol.
 */
export function formatCurrency(value: number, currency: string): string {
  if (currency && currency !== 'BASE') {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
    } catch {
      // Not a valid ISO currency code — fall through to plain formatting.
    }
  }
  return new Intl.NumberFormat(undefined, {
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
export function formatPerShare(value: number, currency: string): string {
  if (currency && currency !== 'BASE') {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      }).format(value)
    } catch {
      // Not a valid ISO currency code — fall through to plain formatting.
    }
  }
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value)
}

/** Format a share/contract quantity (fractional shares allowed, no forced decimals). */
export function formatQuantity(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value)
}

/** Format an allocation weight expressed as a fraction in [0, 1] as a percentage. */
export function formatPercent(fraction: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(fraction)
}

/** Format a snapshot capture time (epoch milliseconds, UTC) in the local locale. */
export function formatDateTime(epochMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
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
export function formatUpdatedAt(epochMs: number, now: number = Date.now()): string {
  const at = new Date(epochMs)
  const today = new Date(now)
  const sameDay =
    at.getFullYear() === today.getFullYear() &&
    at.getMonth() === today.getMonth() &&
    at.getDate() === today.getDate()

  const time = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(at)
  if (sameDay) return time
  return `${new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(at)}, ${time}`
}

/** Format a plain date (epoch milliseconds, UTC) — no time — for Flex statement ranges. */
export function formatDate(epochMs: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(epochMs))
}

/**
 * Format a monetary value with an explicit leading sign (+/−) — for P&L, income, and
 * other figures where the direction matters. Zero carries no sign.
 */
export function formatSignedCurrency(value: number, currency: string): string {
  const base = formatCurrency(Math.abs(value), currency)
  if (value < 0) return `-${base}`
  if (value > 0) return `+${base}`
  return base
}

/** Format an already-percent value (e.g. a TWR of 7.12 → "7.12%"). */
export function formatPercentValue(value: number): string {
  return `${new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}%`
}

/** Format an already-percent value with an explicit leading sign (+/−). Zero carries no sign. */
export function formatSignedPercent(value: number): string {
  const base = formatPercentValue(Math.abs(value))
  if (value < 0) return `-${base}`
  if (value > 0) return `+${base}`
  return base
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
export function formatMonth(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key)
  if (!match) return key
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1))
  return new Intl.DateTimeFormat(undefined, {
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
