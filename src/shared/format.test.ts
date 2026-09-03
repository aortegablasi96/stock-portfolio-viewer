import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import {
  APP_LOCALE,
  formatCompanyName,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatMonth,
  formatPercent,
  formatPercentValue,
  formatPerShare,
  formatPoints,
  formatQuantity,
  formatSignedCurrency,
  formatSignedPercent,
  formatSignedPoints,
  formatTimeOfDay,
  formatUpdatedAt,
  holdingName,
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

/**
 * A difference between two percentages is in **percentage points**, and the words say so (Story
 * #287). "Ten percent above a 50% target" is two different quantities and one of them is wrong: 60%
 * is ten points above 50% and twenty percent above it. The distinction is invisible in a chart and
 * decisive in a sentence a model is asked to quote verbatim.
 */
describe('formatPoints / formatSignedPoints', () => {
  it('names the unit rather than leaving a % sign to be interpreted', () => {
    expect(formatPoints(10)).toBe('10.00 percentage points')
    expect(formatPoints(1.5)).toBe('1.50 percentage points')
  })

  it('adds an explicit sign only where the figure has a direction', () => {
    expect(formatSignedPoints(3.21)).toBe('+3.21 percentage points')
    expect(formatSignedPoints(-3.21)).toBe('-3.21 percentage points')
    expect(formatSignedPoints(0)).toBe('0.00 percentage points')
  })

  /**
   * These are differences of chain-linked returns, so an exact tie arrives as `-1.4e-14`. Signed,
   * it would read as "-0.00 percentage points" — a direction the figure does not have, in text
   * quoted verbatim.
   */
  it('carries no sign on a value that rounds to zero at the precision shown', () => {
    expect(formatSignedPoints(-1.4e-14)).toBe('0.00 percentage points')
    expect(formatSignedPoints(0.004)).toBe('0.00 percentage points')
    expect(formatSignedPoints(-0.006)).toBe('-0.01 percentage points')
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

/**
 * The holdings table's Company column (Story #263 follow-up). A live position has two candidate
 * descriptions rather than one: the gateway's, which on this build is the symbol again, and the
 * name the service resolved from imported Flex history.
 */
describe('holdingName', () => {
  it('names the holding from imported history where the gateway repeated the ticker', () => {
    expect(holdingName('IBKR', 'IBKR', 'INTERACTIVE BROKERS GRO-CL A')).toBe('Interactive Brokers')
    expect(holdingName('SBI', 'SBI', 'SERABI GOLD PLC')).toBe('Serabi Gold')
  })

  /** Shortened by the same one function, so the cell reads identically to Allocation's mark. */
  it('shortens it exactly as every other view does', () => {
    expect(holdingName('NXT', 'NXT', 'NUEVA EXPRESION TEXTIL SA')).toBe(
      instrumentName('NXT', 'NUEVA EXPRESION TEXTIL SA'),
    )
  })

  it('falls back to the description where history knows the instrument by no name', () => {
    expect(holdingName('AAPL', 'APPLE INC', null)).toBe('Apple')
  })

  /**
   * The fallback is still subject to the rule: a description that only repeats the symbol is not
   * a name, so an un-imported instrument on this gateway build empties the cell rather than
   * printing its ticker twice.
   */
  it('finds no name when neither source says anything the symbol does not', () => {
    expect(holdingName('SEZL', 'SEZL', null)).toBeNull()
  })

  /** An imported name that is itself just the ticker — a bare currency row — is no better. */
  it('rejects an imported name that repeats the symbol too', () => {
    expect(holdingName('CAD', 'CAD', 'CAD')).toBeNull()
  })
})

describe('formatTimeOfDay', () => {
  /**
   * Local-time constructors rather than `Date.UTC`, because the assertion is about the *locale*
   * and not about the host's zone: `new Date(…, 17, 31)` is 17:31 wherever it runs, so a machine
   * outside UTC cannot make this pass or fail for the wrong reason.
   */
  it('writes a 24-hour clock time, two digits on both fields', () => {
    expect(formatTimeOfDay(new Date(2026, 8, 3, 17, 31).getTime())).toBe('17:31')
  })

  it('pads the hour, which is the half a one-digit clock would lose', () => {
    expect(formatTimeOfDay(new Date(2026, 8, 3, 9, 4).getTime())).toBe('09:04')
  })

  it('names no date, because a transcript cannot outlive the window it is in', () => {
    const out = formatTimeOfDay(new Date(2026, 8, 3, 17, 31).getTime())

    expect(out).not.toMatch(/sep/i)
    expect(out).not.toMatch(/2026/)
  })

  /** The declared locale, not the host's — the property DDR-0111 exists for. */
  it('takes the locale as an argument, defaulting to the one the app declares', () => {
    const at = new Date(2026, 8, 3, 17, 31).getTime()

    expect(formatTimeOfDay(at, APP_LOCALE)).toBe(formatTimeOfDay(at))
    expect(formatTimeOfDay(at, 'en-US')).not.toBe(formatTimeOfDay(at))
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

// ---- one implementation, one locale, two processes (Story #324, DDR-0111) ----

/**
 * The property the move to `@shared` had to buy, and the trap it created (DDR-0111).
 *
 * DDR-0098's criterion is that **a figure in an answer and the same figure on a dashboard agree to
 * the digit**. While the renderer wrote every figure, one module was enough to make that true. Epic
 * #322 puts a second writer in main — a tool result is rendered into prose there — so the criterion
 * now needs two things rather than one: the same *code*, and the same *locale*.
 *
 * Neither is checked by anything else. Two copies of a percentage formatter typecheck; two hosts
 * resolving `undefined` differently typecheck and pass every test written against a regex. What
 * that failure looks like in the wild is `1,234.50` in an answer beside `1.234,50` on the page it
 * was computed from — the same figure, disagreeing in a separator, in the one feature of this app
 * whose whole promise is that its numbers came from somewhere.
 */
describe('one implementation, reachable from both processes', () => {
  /**
   * The repository root. `fileURLToPath`, never `URL.pathname`: the latter percent-encodes, and
   * this checkout lives under a path with a space in it — `Andreu%20Ortega` is not a directory.
   */
  const root = fileURLToPath(new URL('../../', import.meta.url))

  /**
   * **This file excepted**, for the reason a text guard always carries one (DDR-0042, DDR-0047,
   * DDR-0075): a file hunting for a string necessarily contains it. One named file rather than a
   * pattern, so the exception cannot quietly widen.
   */
  const SELF = fileURLToPath(import.meta.url)

  function sourceFiles(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
      else if (/\.tsx?$/.test(entry) && path !== SELF) out.push(path)
    }
    return out
  }

  /**
   * A file's code, comments stripped — the trap this repository has walked into seven times over,
   * and would have walked into here: `format.ts` explains *in prose* that every formatter used to
   * pass `undefined` as its locale, and an unstripped read reports the fix as the bug.
   */
  function code(path: string): string {
    return readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n')
  }

  const relative = (path: string): string => path.slice(root.length).replace(/\\/g, '/')

  /**
   * Phrased as "which files construct one" rather than as an import rule, because a second
   * implementation needs no import of the first — which is exactly how a formatter gets duplicated
   * into main by someone who cannot reach the renderer's copy.
   */
  it('builds every figure in exactly one module', () => {
    const builders = sourceFiles(join(root, 'src'))
      .filter((path) => /new Intl\./.test(code(path)))
      .map(relative)

    expect(builders).toEqual(['src/shared/format.ts'])
  })

  /**
   * The host default is what a second process makes dangerous, so its shape is what is forbidden:
   * every constructor takes the locale it was given, and the default comes from one declared value.
   */
  it('never asks a host for its locale', () => {
    const source = code(join(root, 'src/shared/format.ts'))

    expect(source).not.toMatch(/new Intl\.\w+\(\s*undefined/)
    expect(source).not.toContain('resolvedOptions')
    expect(source).not.toContain('navigator.language')
    expect(APP_LOCALE).toBe('en-GB')
  })

  /**
   * And the consequence, asserted as **exact strings**.
   *
   * Every other test in this file matches a regex loose enough to pass under any host — which was
   * the right way to write them while the locale *was* the host's. It is the wrong way now: the
   * whole point is that these outputs no longer depend on where the process is running, so pinning
   * them character by character is what would fail if the default went back to being discovered.
   * A run in main and a run in the renderer are the same call in two processes; if this passes in
   * one it passes in both, which is the property DDR-0111 asked for.
   */
  it('formats the same value identically wherever it runs', () => {
    expect(formatCurrency(1234.5, 'EUR')).toBe('€1,234.50')
    expect(formatCurrency(1234.5, 'BASE')).toBe('1,234.50')
    expect(formatPercent(0.6)).toBe('60.0%')
    expect(formatPercentValue(7.125)).toBe('7.13%')
    expect(formatSignedPoints(-1.5)).toBe('-1.50 percentage points')
    expect(formatQuantity(1234.5678)).toBe('1,234.5678')
    expect(formatMonth('2026-01')).toBe('Jan 2026')
    expect(formatDate(Date.UTC(2026, 6, 27))).toBe('27 Jul 2026')
  })

  /** The argument is real, so a caller that needs another locale has one — and gets a difference. */
  it('takes the locale as an argument, defaulting to the one the app declares', () => {
    expect(formatCurrency(1234.5, 'EUR', APP_LOCALE)).toBe(formatCurrency(1234.5, 'EUR'))
    expect(formatCurrency(1234.5, 'EUR', 'de-DE')).not.toBe(formatCurrency(1234.5, 'EUR'))
  })
})
