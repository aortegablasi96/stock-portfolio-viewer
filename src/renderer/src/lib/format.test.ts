import { describe, it, expect } from 'vitest'
import {
  formatCompanyName,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatMonth,
  formatPercent,
  formatPercentValue,
  formatPerShare,
  formatQuantity,
  formatSignedCurrency,
  formatSignedPercent,
  formatUpdatedAt,
  instrumentName,
} from './format'

describe('formatCurrency', () => {
  it('formats a valid ISO currency with its symbol', () => {
    // Locale-independent check: the digits and separators may vary, but a $ appears for USD.
    expect(formatCurrency(1234.5, 'USD')).toMatch(/\$\s?1,?234\.50|1[.,]234[.,]50/)
  })

  it('falls back to plain 2-decimal formatting for the BASE pseudo-currency', () => {
    expect(formatCurrency(1000, 'BASE')).not.toMatch(/[A-Z]{3}/)
    expect(formatCurrency(1000, 'BASE')).toMatch(/1[.,]000\.00|1000\.00/)
  })

  it('falls back to plain formatting for an empty or invalid currency code', () => {
    expect(() => formatCurrency(10, '')).not.toThrow()
    expect(() => formatCurrency(10, 'not-a-code')).not.toThrow()
    expect(formatCurrency(10, '')).toMatch(/10\.00/)
  })
})

describe('formatPercent', () => {
  it('renders a fraction as a one-decimal percentage', () => {
    expect(formatPercent(0.6)).toMatch(/60\.0\s?%/)
    expect(formatPercent(0)).toMatch(/0\.0\s?%/)
  })
})

describe('formatPerShare', () => {
  it('keeps the precision a real dividend rate needs, where 2 decimals would lose it', () => {
    // A genuine rate: CAD 0.093999 per share. formatCurrency would round it to 0.09.
    expect(formatPerShare(0.093999, 'CAD')).toMatch(/0\.094/)
    expect(formatCurrency(0.093999, 'CAD')).toMatch(/0\.09(?!4)/)
  })

  it('still shows the usual two decimals for ordinary rates', () => {
    expect(formatPerShare(1.46, 'CAD')).toMatch(/1\.46/)
    expect(formatPerShare(2, 'USD')).toMatch(/2\.00/)
  })

  it('carries the sign of a per-share withholding amount', () => {
    expect(formatPerShare(-0.075, 'USD')).toMatch(/-.*0\.075/)
  })

  it('falls back to plain formatting for an invalid or BASE currency code', () => {
    expect(() => formatPerShare(0.5, 'not-a-code')).not.toThrow()
    expect(formatPerShare(0.5, 'BASE')).toMatch(/0\.50/)
  })
})

describe('formatQuantity', () => {
  it('formats whole and fractional quantities without forcing decimals', () => {
    expect(formatQuantity(100)).toMatch(/^100$|^100(\.0+)?$/)
    expect(formatQuantity(1.5)).toMatch(/1\.5/)
  })
})

describe('formatDateTime', () => {
  it('renders an epoch-ms timestamp as a non-empty date-time string', () => {
    const out = formatDateTime(Date.UTC(2026, 6, 4, 15, 30))
    expect(out).toMatch(/2026/)
    expect(out.length).toBeGreaterThan(0)
  })
})

describe('formatDate', () => {
  it('renders an epoch-ms date without a time component', () => {
    const out = formatDate(Date.UTC(2026, 0, 1))
    expect(out).toMatch(/2026/)
    expect(out).not.toMatch(/:\d\d/)
  })
})

describe('formatSignedCurrency', () => {
  it('prefixes a leading + for positive, - for negative, nothing for zero', () => {
    expect(formatSignedCurrency(10, 'USD')).toMatch(/^\+/)
    expect(formatSignedCurrency(-10, 'USD')).toMatch(/^-/)
    expect(formatSignedCurrency(0, 'USD')).not.toMatch(/^[+-]/)
  })
})

describe('formatPercentValue / formatSignedPercent', () => {
  it('formats an already-percent value with two decimals and a % sign', () => {
    expect(formatPercentValue(7.125)).toMatch(/7\.1[23]\s?%/)
  })

  it('adds an explicit sign only for non-zero values', () => {
    expect(formatSignedPercent(7.12)).toMatch(/^\+7\.12\s?%/)
    expect(formatSignedPercent(-3.5)).toMatch(/^-3\.50\s?%/)
    expect(formatSignedPercent(0)).not.toMatch(/^[+-]/)
  })
})

describe('formatMonth', () => {
  it('renders a YYYY-MM key as a short month + year', () => {
    const out = formatMonth('2026-01')
    expect(out).toMatch(/2026/)
    expect(out).toMatch(/jan/i)
  })

  it('passes through a non-month key such as "Unknown"', () => {
    expect(formatMonth('Unknown')).toBe('Unknown')
  })
})

describe('formatCompanyName', () => {
  it('strips share-class and legal-form suffixes and title-cases (real Flex names)', () => {
    expect(formatCompanyName('INTERACTIVE BROKERS GRO-CL A')).toBe('Interactive Brokers')
    expect(formatCompanyName('SERABI GOLD PLC')).toBe('Serabi Gold')
    expect(formatCompanyName('GOEASY LTD')).toBe('Goeasy')
    expect(formatCompanyName('FILA SPA')).toBe('Fila')
    expect(formatCompanyName('NAGARRO SE')).toBe('Nagarro')
    expect(formatCompanyName('CONCENTRIX CORP')).toBe('Concentrix')
    expect(formatCompanyName('GLOBAL PAYMENTS INC')).toBe('Global Payments')
  })

  it('keeps an apostrophe intact rather than capitalising the letter after it', () => {
    expect(formatCompanyName("LEON'S FURNITURE LTD")).toBe("Leon's Furniture")
  })

  it('handles an explicit share class and multiple trailing suffixes', () => {
    expect(formatCompanyName('VISA INC-CLASS A')).toBe('Visa')
    // Story #214 changed this expectation deliberately: `HOLDINGS` is not the last word here,
    // so it is part of the name and only `PLC` goes. It used to read 'Some Name'.
    expect(formatCompanyName('SOME NAME HOLDINGS PLC')).toBe('Some Name Holdings')
  })

  /**
   * A common noun goes only where it is the **last word** (Story #214, DDR-0067). These four are
   * the whole argument: the same `GROUP` is boilerplate in one name and the company in another,
   * and no rule can read both — so the position decides, and `Goldman Sachs Group` is the price
   * of `Juroku Financial Group`.
   */
  it('keeps a common noun that the name continues past, and drops it where it ends', () => {
    expect(formatCompanyName('JUROKU FINANCIAL GROUP INC')).toBe('Juroku Financial Group')
    expect(formatCompanyName('RECKITT BENCKISER GROUP PLC')).toBe('Reckitt Benckiser Group')
    expect(formatCompanyName('GOLDMAN SACHS GROUP INC')).toBe('Goldman Sachs Group')
    expect(formatCompanyName('PROSUS HOLDINGS')).toBe('Prosus')
  })

  /**
   * Stripping the noun must happen *before* the legal form, or removing `INC` promotes `GROUP`
   * into last place and strips it after all — which is the bug this ordering exists to prevent.
   */
  it('decides "last word" against what IBKR exported, not against what survives', () => {
    expect(formatCompanyName('ACME GROUP INC')).toBe('Acme Group')
    expect(formatCompanyName('ACME GROUP')).toBe('Acme')
  })

  /**
   * A leading article pairs with the noun that has just gone. `The Walt Disney` is not a name in
   * any reading, which is what makes this one not a judgement call.
   */
  it('drops a stranded leading article, and only where something was stripped', () => {
    expect(formatCompanyName('THE WALT DISNEY COMPANY')).toBe('Walt Disney')
    expect(formatCompanyName('THE BOEING COMPANY')).toBe('Boeing')
    expect(formatCompanyName('THE COCA-COLA CO')).toBe('Coca-Cola')
    // Nothing is stripped here, so the article stays — the name really does begin with it.
    expect(formatCompanyName('THE TORONTO-DOMINION BANK')).toBe('The Toronto-Dominion Bank')
  })

  /**
   * IBKR exports capitals, so the case that would tell an acronym from a word is the case being
   * replaced. A vowel-less run is the one signal left; its misses are asserted too, because a
   * later story widening the rule needs to see what it is changing.
   */
  it('keeps a vowel-less acronym, and title-cases everything else', () => {
    expect(formatCompanyName('LVMH MOET HENNESSY LOUIS VUITTON SE')).toBe(
      'LVMH Moet Hennessy Louis Vuitton',
    )
    expect(formatCompanyName('BNP PARIBAS SA')).toBe('BNP Paribas')
    // Known misses: a vowel makes an acronym indistinguishable from a word.
    expect(formatCompanyName('AB DYNAMICS PLC')).toBe('Ab Dynamics')
    expect(formatCompanyName('SAP SE')).toBe('Sap')
  })

  /**
   * Two shapes Story #214 looked at and deliberately left alone (DDR-0067): both are hyphenated
   * all-caps input, and nothing distinguishes the one that wants a capital from the one that
   * does not. Asserted so the next story sees today's behaviour rather than guessing at it.
   */
  it('leaves the hyphen and Mc cases as they are, on purpose', () => {
    expect(formatCompanyName('CO-OPERATIVE GROUP LTD')).toBe('Co-Operative Group')
    expect(formatCompanyName('MARSH & MCLENNAN COMPANIES INC')).toBe('Marsh & Mclennan Companies')
  })

  it('returns the trimmed input unchanged when there is nothing to strip', () => {
    expect(formatCompanyName('  apple  ')).toBe('Apple')
    expect(formatCompanyName('')).toBe('')
  })

  /**
   * The assumption the function makes, kept visible: it takes a company name, and title-casing a
   * string that is not one destroys it. Both of these were rendered by a view before Story #211 —
   * which is why `instrumentName` below exists and why every call site goes through it.
   */
  it('mangles an identifier, which is what instrumentName exists to keep away from it', () => {
    expect(formatCompanyName('EUR.CHF')).toBe('Eur.chf')
    expect(formatCompanyName('CAD')).toBe('Cad')
  })
})

/**
 * Every value here is a real `(symbol, description)` pair from the owner's imported statements,
 * taken from `flex_trades`, `flex_fifo_summaries` and `flex_securities` (Story #211, DDR-0066).
 * The two non-company shapes are different — a currency *pair* in the trade history, a *bare*
 * currency code in the realized-gains rollup — and a guard written against either one alone
 * would have shipped the other.
 */
describe('instrumentName', () => {
  it('shortens a company name, exactly as the dividend tables always did', () => {
    expect(instrumentName('SBI', 'SERABI GOLD PLC')).toBe('Serabi Gold')
    expect(instrumentName('IBKR', 'INTERACTIVE BROKERS GRO-CL A')).toBe('Interactive Brokers')
    expect(instrumentName('LNF', "LEON'S FURNITURE LTD")).toBe("Leon's Furniture")
    expect(instrumentName('NXT', 'NUEVA EXPRESION TEXTIL SA')).toBe('Nueva Expresion Textil')
  })

  /** `flex_trades`, asset category CASH: IBKR writes the pair as both symbol and description. */
  it('finds no name in a currency pair, rather than title-casing it', () => {
    expect(instrumentName('EUR.CHF', 'EUR.CHF')).toBeNull()
    expect(instrumentName('USD.CAD', 'USD.CAD')).toBeNull()
    expect(instrumentName('CHF.JPY', 'CHF.JPY')).toBeNull()
  })

  /**
   * `flex_fifo_summaries`, asset category CASH: a *bare* code, not a pair. These carry realized
   * P&L, so they are rows in the Realized gains by Ticker table and candidates for Best/Worst —
   * a shape-based guard for `XXX.YYY` would have rendered every one of them as "Cad".
   */
  it('finds no name in a bare currency code either', () => {
    expect(instrumentName('CAD', 'CAD')).toBeNull()
    expect(instrumentName('CHF', 'CHF')).toBeNull()
    expect(instrumentName('USD', 'USD')).toBeNull()
  })

  it('finds no name in an absent or blank description', () => {
    expect(instrumentName('GSY', '')).toBeNull()
    expect(instrumentName('GSY', '   ')).toBeNull()
  })

  /** The comparison is on the text, not on its casing or padding. */
  it('ignores case and surrounding space when deciding the description repeats the symbol', () => {
    expect(instrumentName('eur.chf', 'EUR.CHF')).toBeNull()
    expect(instrumentName('CAD', '  cad  ')).toBeNull()
  })

  /**
   * A ticker is not a prefix test: `NWLm` and `NWL` both describe NEWPRINCES, and a symbol that
   * merely *starts* the description is still a name worth showing.
   */
  it('keeps a name that only resembles the symbol', () => {
    expect(instrumentName('NWLm', 'NEWPRINCES SPA')).toBe('Newprinces')
    expect(instrumentName('VBNK', 'VERSABANK')).toBe('Versabank')
  })
})

describe('formatUpdatedAt', () => {
  it('shows only a clock time when the reading is from today', () => {
    const now = new Date(2026, 6, 28, 16, 5).getTime()
    const at = new Date(2026, 6, 28, 14, 32).getTime()

    const out = formatUpdatedAt(at, now)

    expect(out).toMatch(/32/)
    expect(out).not.toMatch(/jul/i)
  })

  it('adds the day and month once the reading is from an earlier day', () => {
    const now = new Date(2026, 6, 28, 9, 0).getTime()
    const at = new Date(2026, 6, 27, 21, 15).getTime()

    const out = formatUpdatedAt(at, now)

    expect(out).toMatch(/27/)
    expect(out).toMatch(/jul/i)
    expect(out).toMatch(/15/)
  })

  it('treats the same clock time a year apart as an earlier day', () => {
    const now = new Date(2026, 6, 28, 10, 0).getTime()
    const at = new Date(2025, 6, 28, 10, 0).getTime()

    expect(formatUpdatedAt(at, now)).toMatch(/jul/i)
  })
})
