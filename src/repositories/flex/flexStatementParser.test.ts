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
const REAL_FILES = ['portfolio-analyst-2026.xml', 'portfolio-analyst-2025.xml']
const hasRealExports = REAL_FILES.every((f) => existsSync(join(FLEX_DIR, f)))

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

  it('rejects a file that is not a Flex Query statement', () => {
    expect(() => parseFlexStatements('<html><body>nope</body></html>')).toThrow(ValidationError)
    expect(() => parseFlexStatements('not xml at all <<<')).toThrow(ValidationError)
  })

  it.skipIf(!hasRealExports)('parses the real Portfolio Analyst exports under docs/flex-queries', () => {
    const dir = FLEX_DIR
    const stmt = parseOne(readFileSync(join(dir, 'portfolio-analyst-2026.xml'), 'utf8'))
    expect(stmt.accountId).toBe('U18846869')
    expect(stmt.baseCurrency).toBe('EUR')
    expect(stmt.trades).toHaveLength(66)
    expect(stmt.lots).toHaveLength(15)
    expect(stmt.cashTransactions).toHaveLength(21)
    expect(stmt.openPositions).toHaveLength(8)
    expect(stmt.securities).toHaveLength(11)
    expect(stmt.performanceSummaries).toHaveLength(16)
    expect(stmt.priorPeriodPositions).toHaveLength(865)

    // Pins the OpenDividendAccrual attribute mapping against a real IBKR export rather
    // than the published field list (the open risk recorded in DDR-0010). Note IBKR
    // reports `tax` as a positive magnitude here — the service still derives withholding
    // as gross − net, which agrees: 4.24 − 3.6 = 0.64.
    expect(stmt.openDividendAccruals).toHaveLength(1)
    const accrual = stmt.openDividendAccruals[0]
    expect(accrual?.symbol).toBe('VBNK')
    expect(accrual?.conid).toBe(514478839)
    expect(accrual?.exDate).toBe(Date.UTC(2026, 6, 10))
    expect(accrual?.payDate).toBe(Date.UTC(2026, 6, 31))
    expect(accrual?.quantity).toBe(240)
    expect(accrual?.grossAmount).toBe(4.24)
    expect(accrual?.netAmount).toBe(3.6)
    expect(accrual?.fxRateToBase).toBe(0.87628)

    const stmt2025 = parseOne(readFileSync(join(dir, 'portfolio-analyst-2025.xml'), 'utf8'))
    expect(stmt2025.trades).toHaveLength(186)
    expect(stmt2025.cashTransactions).toHaveLength(41)
    expect(stmt2025.priorPeriodPositions).toHaveLength(1124)
  })
})
