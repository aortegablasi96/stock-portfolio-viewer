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

/** Capitalise the first letter of each word, leaving intra-word letters (e.g. after an apostrophe) alone. */
function titleCaseWords(s: string): string {
  return s.toLowerCase().replace(/(^|[\s\-/])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase())
}

/**
 * Shorten a raw IBKR instrument name into a readable company name for the dividend
 * tables — e.g. "INTERACTIVE BROKERS GRO-CL A" → "Interactive Brokers",
 * "SERABI GOLD PLC" → "Serabi Gold", "GLOBAL PAYMENTS INC" → "Global Payments".
 * Strips a trailing share-class descriptor and any legal-form suffixes, then
 * title-cases. Falls back to the trimmed input if stripping would empty it.
 */
export function formatCompanyName(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '') return trimmed
  // Drop a trailing share-class / group-class descriptor: "GRO-CL A", "-CL A",
  // "CL A", "CLASS A", "SER A", … (with anything after it).
  let s = trimmed.replace(/[\s-]+(?:[A-Z]{2,4}[\s-]*)?(?:CL|CLASS|SER|SERIES)\.?\s*[A-D]\b.*$/i, '')
  // Drop trailing legal-form tokens, possibly several ("… HOLDINGS PLC").
  const LEGAL =
    /\s+(?:INC(?:ORPORATED)?|CORP(?:ORATION)?|COMPANY|CO|LIMITED|LTD|PLC|LLC|LLP|LP|GROUP|GRP|HOLDINGS?|HLDGS?|SE|SA|SPA|AG|NV|ASA|AB|OYJ)\.?$/i
  while (LEGAL.test(s)) s = s.replace(LEGAL, '')
  s = s.replace(/[.,\s]+$/, '').trim()
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
