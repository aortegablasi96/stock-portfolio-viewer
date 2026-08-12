import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { parseFlexStatements } from './flexStatementParser'
import { ValidationError } from '@shared/errors'
import type { FlexStatement } from '@shared/domain/flex'

// The real Portfolio Analyst exports contain personal account data, so they are
// git-ignored (see .gitignore). This test runs against them locally when present and
// is skipped in a clean checkout — the inline FIXTURE above provides deterministic
// coverage everywhere.
const FLEX_DIR = join(process.cwd(), 'docs', 'flex-queries')

/**
 * Resolve a year's export. `portfolio-analyst-<year>.xml` is the canonical name, but IBKR's
 * export dialog produces `portfolio-analyst - <year>.xml`, and dropping a freshly downloaded
 * file in under that name is the obvious thing to do. Story #171: it had happened, so
 * `hasRealExports` was false and this whole block skipped silently — a skipped test and a
 * passing one look identical in a green run. The files are renamed; accepting both spellings
 * is what stops it recurring the next time the owner re-exports.
 */
function realExport(year: number): string | undefined {
  return [`portfolio-analyst-${year}.xml`, `portfolio-analyst - ${year}.xml`]
    .map((f) => join(FLEX_DIR, f))
    .find((p) => existsSync(p))
}

const REAL_2026 = realExport(2026)
const REAL_2025 = realExport(2025)
const hasRealExports = REAL_2026 !== undefined && REAL_2025 !== undefined

/** Parse and return the first statement, asserting one exists (narrows away `undefined`). */
function parseOne(xml: string): FlexStatement {
  const [stmt] = parseFlexStatements(xml)
  if (!stmt) throw new Error('expected at least one statement')
  return stmt
}

/**
 * The parser is the pure ingress boundary for the Flex file source (ADR-0005). These
 * tests pin the coercion rules (numbers, epoch-ms dates, nullable empties, de-dupe
 * keys) against a compact inline fixture, then sanity-check the two real Portfolio
 * Analyst exports under `docs/flex-queries/`.
 */

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="portfolio-analyst" type="AF">
<FlexStatements count="1">
<FlexStatement accountId="U1234567" fromDate="20260101" toDate="20260720" period="YearToDate" whenGenerated="20260721;103057">
<ChangeInNAV currency="EUR" fromDate="20260101" toDate="20260720" startingValue="1000" mtm="50" depositsWithdrawals="200" dividends="12.5" withholdingTax="-1.25" interest="0" commissions="-3.5" twr="5.5" endingValue="1250" />
<FIFOPerformanceSummaryInBase>
<FIFOPerformanceSummaryUnderlying assetCategory="STK" symbol="GSY" description="GOEASY LTD" conid="206663850" cusip="" isin="CA3803551074" multiplier="1" realizedSTProfit="0" realizedSTLoss="-10" realizedLTProfit="0" realizedLTLoss="0" totalRealizedPnl="-10" unrealizedProfit="0" unrealizedLoss="0" totalUnrealizedPnl="0" totalFifoPnl="-10" transferredPnl="0" />
</FIFOPerformanceSummaryInBase>
<OpenPositions>
<OpenPosition currency="CAD" fxRateToBase="0.62268" assetCategory="STK" symbol="MMY" description="MONUMENT MINING LTD" conid="45090384" isin="CA61531Y1051" multiplier="1" reportDate="20260720" position="7790" markPrice="0.73" costBasisPrice="0.894580745" costBasisMoney="6968.784" percentOfNAV="5.60" fifoPnlUnrealized="-1282.084" side="Long" />
</OpenPositions>
<PriorPeriodPositions>
<PriorPeriodPosition currency="CAD" fxRateToBase="0.62142" assetCategory="STK" symbol="GSY" description="GOEASY LTD" conid="206663850" cusip="" isin="CA3803551074" multiplier="1" date="20260102" price="131.46" priorMtmPnl="11.05" />
<PriorPeriodPosition currency="CAD" fxRateToBase="0.61941" assetCategory="STK" symbol="GSY" description="GOEASY LTD" conid="206663850" cusip="" isin="CA3803551074" multiplier="1" date="20260105" price="" priorMtmPnl="67.6" />
</PriorPeriodPositions>
<Trades>
<Trade currency="CAD" fxRateToBase="0.62255" assetCategory="STK" symbol="GSY" description="GOEASY LTD" conid="206663850" isin="CA3803551074" multiplier="1" dateTime="20260402;100454" tradeDate="20260402" settleDateTarget="20260406" transactionType="ExchTrade" exchange="TSE" quantity="-65" tradePrice="35.17" tradeMoney="-2286.05" proceeds="2286.05" taxes="0" ibCommission="-1" ibCommissionCurrency="CAD" netCash="2285.05" closePrice="34.87" openCloseIndicator="C" cost="-8346.1" fifoPnlRealized="-6061.05" mtmPnl="19.5" />
<Lot currency="CAD" fxRateToBase="0.62255" assetCategory="STK" symbol="GSY" description="GOEASY LTD" conid="206663850" isin="CA3803551074" multiplier="1" dateTime="20260402;100454" tradeDate="20260402" settleDateTarget="" transactionType="" exchange="ALPHA" quantity="15" tradePrice="148.406666667" tradeMoney="" proceeds="" taxes="" ibCommission="" ibCommissionCurrency="" netCash="" closePrice="" openCloseIndicator="C" cost="2226.1" fifoPnlRealized="-1698.780769" mtmPnl="" notes="ST" />
</Trades>
<CashTransactions>
<CashTransaction currency="CAD" fxRateToBase="0.61757" assetCategory="STK" symbol="GSY" description="GSY CASH DIVIDEND" conid="206663850" isin="CA3803551074" dateTime="20260109;202000" settleDate="20260109" amount="20.44" type="Dividends" dividendType="Ordinary" tradeID="" code="" transactionID="37261202925" exDate="20260102" />
<CashTransaction currency="CAD" fxRateToBase="0.61757" assetCategory="STK" symbol="GSY" description="GSY WITHHOLDING" conid="206663850" isin="CA3803551074" dateTime="20260109;202000" settleDate="20260109" amount="-14.24" type="Withholding Tax" dividendType="" tradeID="" code="" transactionID="" exDate="" />
</CashTransactions>
<SecuritiesInfo>
<SecurityInfo currency="CAD" assetCategory="STK" subCategory="COMMON" symbol="MMY" description="MONUMENT MINING LTD" conid="45090384" cusip="61531Y105" isin="CA61531Y1051" listingExchange="VENTURE" issuerCountryCode="CA" multiplier="1" />
</SecuritiesInfo>
<OpenDividendAccruals>
<OpenDividendAccrual currency="CAD" fxRateToBase="0.61945" assetCategory="STK" symbol="GSY" description="GOEASY LTD" conid="206663850" isin="CA3803551074" exDate="20260810" payDate="20260901" quantity="50" tax="-2.25" fee="0" grossRate="0.30" grossAmount="15" netAmount="12.75" code="" />
<OpenDividendAccrual currency="CAD" fxRateToBase="0.61945" assetCategory="STK" symbol="MMY" description="MONUMENT MINING LTD" conid="45090384" isin="CA61531Y1051" exDate="20260815" payDate="" quantity="100" tax="" fee="" grossRate="" grossAmount="8" netAmount="8" code="" />
</OpenDividendAccruals>
<EquitySummaryInBase>
<EquitySummaryByReportDateInBase currency="EUR" reportDate="20260101" cash="100" stock="900" dividendAccruals="5" interestAccruals="0" brokerFeesAccrualsComponent="0" total="1005" />
<EquitySummaryByReportDateInBase currency="EUR" reportDate="20260102" cash="-50" stock="1200" total="1150" />
<EquitySummaryByReportDateInBase currency="EUR" reportDate="20260105" cash="0" stock="0" />
</EquitySummaryInBase>
</FlexStatement>
</FlexStatements>
</FlexQueryResponse>`

describe('parseFlexStatements', () => {
  it('parses statement metadata and derives the base currency from ChangeInNAV', () => {
    const stmt = parseOne(FIXTURE)
    expect(stmt.accountId).toBe('U1234567')
    expect(stmt.period).toBe('YearToDate')
    expect(stmt.baseCurrency).toBe('EUR')
    expect(stmt.fromDate).toBe(Date.UTC(2026, 0, 1))
    expect(stmt.toDate).toBe(Date.UTC(2026, 6, 20))
    expect(stmt.whenGenerated).toBe(Date.UTC(2026, 6, 21, 10, 30, 57))
  })

  it('coerces the NAV change numbers', () => {
    const { navChange } = parseOne(FIXTURE)
    expect(navChange).not.toBeNull()
    expect(navChange?.startingValue).toBe(1000)
    expect(navChange?.endingValue).toBe(1250)
    expect(navChange?.withholdingTax).toBe(-1.25)
    expect(navChange?.twr).toBe(5.5)
  })

  it('parses trades and computes a deterministic trade_key from stable fields', () => {
    const { trades } = parseOne(FIXTURE)
    expect(trades).toHaveLength(1)
    const t = trades[0]
    expect(t?.quantity).toBe(-65)
    expect(t?.tradePrice).toBe(35.17)
    expect(t?.dateTime).toBe(Date.UTC(2026, 3, 2, 10, 4, 54))
    expect(t?.settleDate).toBe(Date.UTC(2026, 3, 6))
    expect(t?.tradeKey).toBe('206663850|20260402;100454|-65|35.17|C|-1')
  })

  it('parses the daily PriorPeriodPosition MTM series with UTC dates and nullable price', () => {
    const { priorPeriodPositions } = parseOne(FIXTURE)
    expect(priorPeriodPositions).toHaveLength(2)
    const first = priorPeriodPositions[0]
    expect(first?.date).toBe(Date.UTC(2026, 0, 2))
    expect(first?.priorMtmPnl).toBe(11.05)
    expect(first?.fxRateToBase).toBe(0.62142)
    expect(first?.price).toBe(131.46)
    // Empty price coerces to null (not 0), matching the other nullable-numeric rules.
    expect(priorPeriodPositions[1]?.price).toBeNull()
  })

  it('separates Lot rows from Trade rows and maps ST/LT notes', () => {
    const { lots } = parseOne(FIXTURE)
    expect(lots).toHaveLength(1)
    expect(lots[0]?.quantity).toBe(15)
    expect(lots[0]?.tradePrice).toBe(148.406666667)
    expect(lots[0]?.notes).toBe('ST')
  })

  it('keys cash transactions by transactionID, falling back to a content hash', () => {
    const { cashTransactions } = parseOne(FIXTURE)
    expect(cashTransactions).toHaveLength(2)
    const dividend = cashTransactions.find((c) => c.type === 'Dividends')
    const withholding = cashTransactions.find((c) => c.type === 'Withholding Tax')
    expect(dividend?.dedupeKey).toBe('tx:37261202925')
    expect(dividend?.amount).toBe(20.44)
    // No transactionID → deterministic content hash, not an empty "tx:".
    expect(withholding?.dedupeKey).toBe('h:206663850|20260109;202000|-14.24|Withholding Tax')
  })

  it('turns empty numeric attributes into null and parses conid as an int', () => {
    const { openPositions, securities, trades } = parseOne(FIXTURE)
    expect(openPositions[0]?.conid).toBe(45090384)
    expect(openPositions[0]?.percentOfNav).toBe(5.6)
    expect(securities[0]?.issuerCountryCode).toBe('CA')
    expect(trades[0]?.taxes).toBe(0)
  })

  it('parses open dividend accruals, defaulting an omitted tax/fee to zero', () => {
    const { openDividendAccruals } = parseOne(FIXTURE)
    expect(openDividendAccruals).toHaveLength(2)
    const [gsy, mmy] = openDividendAccruals
    expect(gsy?.symbol).toBe('GSY')
    expect(gsy?.exDate).toBe(Date.UTC(2026, 7, 10))
    expect(gsy?.payDate).toBe(Date.UTC(2026, 8, 1))
    expect(gsy?.quantity).toBe(50)
    expect(gsy?.grossRate).toBe(0.3)
    expect(gsy?.grossAmount).toBe(15)
    expect(gsy?.netAmount).toBe(12.75)
    // Blank pay date / gross rate stay null; blank tax and fee coerce to 0, not null.
    expect(mmy?.payDate).toBeNull()
    expect(mmy?.grossRate).toBeNull()
    expect(mmy?.tax).toBe(0)
    expect(mmy?.fee).toBe(0)
  })

  it('treats a statement without the optional accruals section as having none', () => {
    const withoutAccruals = FIXTURE.replace(
      /<OpenDividendAccruals>[\s\S]*<\/OpenDividendAccruals>/,
      '',
    )
    expect(parseOne(withoutAccruals).openDividendAccruals).toEqual([])
  })

  it('parses the daily equity summary, defaulting omitted categories to zero', () => {
    const { equitySummaries } = parseOne(FIXTURE)
    expect(equitySummaries).toHaveLength(3)
    const [first, margin] = equitySummaries

    expect(first?.currency).toBe('EUR')
    expect(first?.reportDate).toBe(Date.UTC(2026, 0, 1))
    expect(first?.cash).toBe(100)
    expect(first?.stock).toBe(900)
    expect(first?.dividendAccruals).toBe(5)
    expect(first?.total).toBe(1005)
    // No `options` attribute at all — an asset class the query does not select is 0, not null.
    // This is the shape of every real export here, so it is the case that must not throw.
    expect(first?.options).toBe(0)

    // Cash goes negative on margin, and stays negative rather than clamping.
    expect(margin?.cash).toBe(-50)
    expect(margin?.total).toBe(1150)
  })

  it('falls back to the sum of the components when `total` is omitted', () => {
    // Deselecting Total must not fail an import the other four views depend on.
    const noTotal = FIXTURE.replace('cash="-50" stock="1200" total="1150"', 'cash="-50" stock="1200"')
    expect(parseOne(noTotal).equitySummaries[1]?.total).toBe(1150)
  })

  it('treats a statement without the optional equity summary section as having none', () => {
    const without = FIXTURE.replace(/<EquitySummaryInBase>[\s\S]*<\/EquitySummaryInBase>/, '')
    expect(parseOne(without).equitySummaries).toEqual([])
  })

  it('rejects a file that is not a Flex Query statement', () => {
    expect(() => parseFlexStatements('<html><body>nope</body></html>')).toThrow(ValidationError)
    expect(() => parseFlexStatements('not xml at all <<<')).toThrow(ValidationError)
  })

  /**
   * Ground-truth pass over the owner's real Portfolio Analyst exports.
   *
   * These files are gitignored and **re-exported periodically**, so every row count in here
   * used to drift the moment the owner refreshed them. That never surfaced, because the
   * filename this block looked for had a hyphen where the real files have a space — the
   * `skipIf` swallowed it, and a skipped test reads exactly like a passing one. Un-skipping it
   * for Story #171 found the counts stale by nine trades and one dividend accrual.
   *
   * So the assertions below are deliberately **invariants rather than inventory**: identities
   * that hold for any export of this account (attribute mapping, cross-section agreement,
   * ordering, sign) plus lower bounds that catch a section vanishing. Pinning `trades` at
   * exactly 66 was only ever asserting that the file had not been regenerated, which is not a
   * property of the parser.
   */
  it.skipIf(!hasRealExports)('parses the real Portfolio Analyst exports under docs/flex-queries', () => {
    const stmt2026 = parseOne(readFileSync(REAL_2026 as string, 'utf8'))
    const stmt2025 = parseOne(readFileSync(REAL_2025 as string, 'utf8'))

    expect(stmt2026.accountId).toBe('U18846869')
    expect(stmt2026.baseCurrency).toBe('EUR')

    for (const stmt of [stmt2026, stmt2025]) {
      // Every section the query selects is present and non-trivial. A section quietly
      // dropping to zero is the failure worth catching; its exact size is not.
      expect(stmt.trades.length).toBeGreaterThan(50)
      expect(stmt.lots.length).toBeGreaterThan(10)
      expect(stmt.cashTransactions.length).toBeGreaterThan(20)
      expect(stmt.openPositions.length).toBeGreaterThan(0)
      expect(stmt.securities.length).toBeGreaterThan(0)
      expect(stmt.performanceSummaries.length).toBeGreaterThan(0)
      expect(stmt.priorPeriodPositions.length).toBeGreaterThan(500)

      // Dates coerce to epoch-ms UTC midnight, never to a raw YYYYMMDD integer.
      for (const p of stmt.priorPeriodPositions.slice(0, 50)) {
        expect(p.date % 86_400_000).toBe(0)
        expect(p.date).toBeGreaterThan(Date.UTC(2020, 0, 1))
      }
    }

    // Pins the OpenDividendAccrual attribute mapping against a real IBKR export rather than
    // the published field list (the open risk recorded in DDR-0010). Read from whichever
    // statement carries one — it is an as-of balance, so which export holds it moves.
    const accruals = [...stmt2026.openDividendAccruals, ...stmt2025.openDividendAccruals]
    expect(accruals.length).toBeGreaterThan(0)
    for (const accrual of accruals) {
      expect(accrual.symbol).not.toBe('')
      expect(accrual.conid).toBeTypeOf('number')
      expect(accrual.exDate).not.toBeNull()
      expect(accrual.quantity).toBeGreaterThan(0)
      expect(accrual.fxRateToBase).toBeGreaterThan(0)
      // IBKR reports `tax` as a positive magnitude here, so the service derives withholding
      // as gross − net instead of trusting its sign — which requires net ≤ gross.
      expect(accrual.grossAmount).toBeGreaterThan(0)
      expect(accrual.netAmount).toBeLessThanOrEqual(accrual.grossAmount)
    }

    // The daily equity series (Story #171), held to the same standard. The last row is the
    // number the whole valueSeries swap rests on: it equals `ChangeInNAV.endingValue`
    // exactly, so moving the curve onto this series leaves the headline figures where they
    // were. That identity is what makes the swap safe, and it is not obvious from the docs.
    for (const stmt of [stmt2026, stmt2025]) {
      const daily = stmt.equitySummaries
      expect(daily.length).toBeGreaterThan(150)

      const last = daily[daily.length - 1]
      if (!last) throw new Error('expected a daily equity summary series')
      expect(last.currency).toBe('EUR')
      expect(stmt.navChange?.endingValue).toBeCloseTo(last.total, 6)
      expect(last.reportDate).toBe(stmt.toDate)

      // Components sum to the total across every day, for the categories this query selects.
      // This is the invariant the composition chart's sum-to-100% guarantee inherits.
      for (const day of daily) {
        expect(
          day.cash +
            day.stock +
            day.options +
            day.dividendAccruals +
            day.interestAccruals +
            day.brokerFeesAccruals,
        ).toBeCloseTo(day.total, 6)
        // The account holds no options, so the query omits the attribute entirely.
        expect(day.options).toBe(0)
      }

      // Strictly ascending report dates — the series is a time series, and the composition
      // and value curves both index into it positionally.
      for (let i = 1; i < daily.length; i++) {
        expect(daily[i]!.reportDate).toBeGreaterThan(daily[i - 1]!.reportDate)
      }
    }

    // The 2025 series opens the day *before* its statement period, at zero NAV — the real
    // zero-total day the composition maths has to survive, not a hypothetical one.
    expect(stmt2025.equitySummaries[0]?.total).toBe(0)
    expect(stmt2025.equitySummaries[0]?.reportDate).toBeLessThan(stmt2025.fromDate)
  })
})
