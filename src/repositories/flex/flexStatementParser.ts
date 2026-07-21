import { XMLParser } from 'fast-xml-parser'
import { ValidationError } from '@shared/errors'
import type {
  FlexCashTransaction,
  FlexLot,
  FlexNavChange,
  FlexOpenPosition,
  FlexPerformanceSummary,
  FlexSecurity,
  FlexStatement,
  FlexTrade,
} from '@shared/domain/flex'

/**
 * Parse an IBKR Portfolio Analyst Flex Query XML export into clean, typed domain
 * statements (Milestone M3, Story #20). This is the **ingress boundary** for the
 * offline file data source (ADR-0005) — analogous to `ibkrGateway` for the live REST
 * API: external data is untrusted, so structure is validated and every value is
 * explicitly coerced here, and a malformed or non–Flex-Query file is rejected with a
 * `ValidationError` rather than producing partial garbage.
 *
 * It is intentionally pure (no `@db`, no `better-sqlite3`, no Electron) so it unit-tests
 * under plain Node; `flexRepository` reads the file and persists what this returns.
 */

// All values live in attributes; keep them as strings and coerce explicitly below so we
// control number/date parsing (rather than fast-xml-parser's best-effort coercion).
const ARRAY_TAGS = new Set([
  'FlexStatement',
  'OpenPosition',
  'Trade',
  'Lot',
  'CashTransaction',
  'FIFOPerformanceSummaryUnderlying',
  'SecurityInfo',
])

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ARRAY_TAGS.has(name),
})

type Raw = Record<string, unknown>

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

/** Required decimal. Throws when absent/non-numeric so malformed data is caught at ingress. */
function reqNum(raw: Raw, key: string, ctx: string): number {
  const s = str(raw[key]).trim()
  const n = Number(s)
  if (s === '' || !Number.isFinite(n)) {
    throw new ValidationError(`Flex ${ctx}: expected a number for "${key}", got "${s}".`)
  }
  return n
}

/** Optional decimal — empty strings (common in Flex) and non-numeric become null. */
function optNum(raw: Raw, key: string): number | null {
  const s = str(raw[key]).trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const optInt = (raw: Raw, key: string): number | null => {
  const n = optNum(raw, key)
  return n === null ? null : Math.trunc(n)
}

/** Parse a Flex `YYYYMMDD` date to epoch ms (UTC midnight). Empty/invalid → null. */
function parseDate(raw: Raw, key: string): number | null {
  const s = str(raw[key]).trim()
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s)
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** Parse a Flex `YYYYMMDD;HHMMSS` (or bare `YYYYMMDD`) datetime to epoch ms (UTC). */
function parseDateTime(raw: Raw, key: string): number | null {
  const s = str(raw[key]).trim()
  const m = /^(\d{4})(\d{2})(\d{2})(?:;(\d{2})(\d{2})(\d{2}))?$/.exec(s)
  if (!m) return null
  return Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4] ?? '0'),
    Number(m[5] ?? '0'),
    Number(m[6] ?? '0'),
  )
}

/** fast-xml-parser gives a section's children as an array (forced) or undefined when absent. */
function rows(container: unknown, tag: string): Raw[] {
  if (container == null || typeof container !== 'object') return []
  const value = (container as Raw)[tag]
  return Array.isArray(value) ? (value as Raw[]) : []
}

function toNavChange(raw: Raw): FlexNavChange {
  const ctx = 'ChangeInNAV'
  return {
    currency: str(raw.currency),
    fromDate: parseDate(raw, 'fromDate') ?? 0,
    toDate: parseDate(raw, 'toDate') ?? 0,
    startingValue: reqNum(raw, 'startingValue', ctx),
    endingValue: reqNum(raw, 'endingValue', ctx),
    mtm: reqNum(raw, 'mtm', ctx),
    depositsWithdrawals: reqNum(raw, 'depositsWithdrawals', ctx),
    dividends: reqNum(raw, 'dividends', ctx),
    withholdingTax: reqNum(raw, 'withholdingTax', ctx),
    interest: reqNum(raw, 'interest', ctx),
    commissions: reqNum(raw, 'commissions', ctx),
    twr: reqNum(raw, 'twr', ctx),
  }
}

function toOpenPosition(raw: Raw): FlexOpenPosition {
  return {
    conid: optInt(raw, 'conid'),
    symbol: str(raw.symbol),
    description: str(raw.description),
    assetCategory: str(raw.assetCategory),
    currency: str(raw.currency),
    fxRateToBase: reqNum(raw, 'fxRateToBase', 'OpenPosition'),
    reportDate: parseDate(raw, 'reportDate'),
    position: reqNum(raw, 'position', 'OpenPosition'),
    markPrice: optNum(raw, 'markPrice'),
    costBasisPrice: optNum(raw, 'costBasisPrice'),
    costBasisMoney: optNum(raw, 'costBasisMoney'),
    percentOfNav: optNum(raw, 'percentOfNAV'),
    fifoPnlUnrealized: optNum(raw, 'fifoPnlUnrealized'),
    side: str(raw.side),
  }
}

/** Deterministic global de-dupe identity for a trade (this Flex config omits `tradeID`). */
function tradeKey(raw: Raw): string {
  return [
    str(raw.conid),
    str(raw.dateTime),
    str(raw.quantity),
    str(raw.tradePrice),
    str(raw.openCloseIndicator),
    str(raw.ibCommission),
  ].join('|')
}

function toTrade(raw: Raw): FlexTrade {
  const ctx = 'Trade'
  return {
    tradeKey: tradeKey(raw),
    conid: optInt(raw, 'conid'),
    symbol: str(raw.symbol),
    description: str(raw.description),
    assetCategory: str(raw.assetCategory),
    currency: str(raw.currency),
    fxRateToBase: reqNum(raw, 'fxRateToBase', ctx),
    dateTime: parseDateTime(raw, 'dateTime'),
    tradeDate: parseDate(raw, 'tradeDate'),
    settleDate: parseDate(raw, 'settleDateTarget'),
    transactionType: str(raw.transactionType),
    exchange: str(raw.exchange),
    quantity: reqNum(raw, 'quantity', ctx),
    tradePrice: reqNum(raw, 'tradePrice', ctx),
    tradeMoney: optNum(raw, 'tradeMoney'),
    proceeds: optNum(raw, 'proceeds'),
    taxes: optNum(raw, 'taxes'),
    ibCommission: optNum(raw, 'ibCommission'),
    ibCommissionCurrency: str(raw.ibCommissionCurrency),
    netCash: optNum(raw, 'netCash'),
    closePrice: optNum(raw, 'closePrice'),
    openCloseIndicator: str(raw.openCloseIndicator),
    cost: optNum(raw, 'cost'),
    fifoPnlRealized: optNum(raw, 'fifoPnlRealized'),
    mtmPnl: optNum(raw, 'mtmPnl'),
  }
}

function toLot(raw: Raw): FlexLot {
  return {
    conid: optInt(raw, 'conid'),
    symbol: str(raw.symbol),
    description: str(raw.description),
    currency: str(raw.currency),
    fxRateToBase: reqNum(raw, 'fxRateToBase', 'Lot'),
    dateTime: parseDateTime(raw, 'dateTime'),
    tradeDate: parseDate(raw, 'tradeDate'),
    quantity: reqNum(raw, 'quantity', 'Lot'),
    tradePrice: optNum(raw, 'tradePrice'),
    cost: optNum(raw, 'cost'),
    fifoPnlRealized: optNum(raw, 'fifoPnlRealized'),
    openCloseIndicator: str(raw.openCloseIndicator),
    notes: str(raw.notes),
  }
}

/** Global de-dupe identity for a cash transaction: transactionID, else a content hash. */
function cashDedupeKey(raw: Raw): string {
  const txId = str(raw.transactionID).trim()
  if (txId !== '') return `tx:${txId}`
  return `h:${[str(raw.conid), str(raw.dateTime), str(raw.amount), str(raw.type)].join('|')}`
}

function toCashTransaction(raw: Raw): FlexCashTransaction {
  return {
    dedupeKey: cashDedupeKey(raw),
    transactionId: str(raw.transactionID),
    conid: optInt(raw, 'conid'),
    symbol: str(raw.symbol),
    description: str(raw.description),
    assetCategory: str(raw.assetCategory),
    currency: str(raw.currency),
    fxRateToBase: reqNum(raw, 'fxRateToBase', 'CashTransaction'),
    dateTime: parseDateTime(raw, 'dateTime'),
    settleDate: parseDate(raw, 'settleDate'),
    exDate: parseDate(raw, 'exDate'),
    amount: reqNum(raw, 'amount', 'CashTransaction'),
    type: str(raw.type),
    dividendType: str(raw.dividendType),
    code: str(raw.code),
  }
}

function toPerformanceSummary(raw: Raw): FlexPerformanceSummary {
  const ctx = 'FIFOPerformanceSummaryUnderlying'
  return {
    conid: optInt(raw, 'conid'),
    symbol: str(raw.symbol),
    description: str(raw.description),
    assetCategory: str(raw.assetCategory),
    realizedStProfit: reqNum(raw, 'realizedSTProfit', ctx),
    realizedStLoss: reqNum(raw, 'realizedSTLoss', ctx),
    realizedLtProfit: reqNum(raw, 'realizedLTProfit', ctx),
    realizedLtLoss: reqNum(raw, 'realizedLTLoss', ctx),
    totalRealizedPnl: reqNum(raw, 'totalRealizedPnl', ctx),
    unrealizedProfit: reqNum(raw, 'unrealizedProfit', ctx),
    unrealizedLoss: reqNum(raw, 'unrealizedLoss', ctx),
    totalUnrealizedPnl: reqNum(raw, 'totalUnrealizedPnl', ctx),
    totalFifoPnl: reqNum(raw, 'totalFifoPnl', ctx),
    transferredPnl: reqNum(raw, 'transferredPnl', ctx),
  }
}

function toSecurity(raw: Raw): FlexSecurity {
  return {
    conid: optInt(raw, 'conid'),
    symbol: str(raw.symbol),
    description: str(raw.description),
    assetCategory: str(raw.assetCategory),
    subCategory: str(raw.subCategory),
    currency: str(raw.currency),
    listingExchange: str(raw.listingExchange),
    issuerCountryCode: str(raw.issuerCountryCode),
    isin: str(raw.isin),
    cusip: str(raw.cusip),
    multiplier: optNum(raw, 'multiplier'),
  }
}

function toStatement(raw: Raw): FlexStatement {
  const accountId = str(raw.accountId).trim()
  if (accountId === '') {
    throw new ValidationError('Flex statement is missing an accountId.')
  }
  const navRaw = raw.ChangeInNAV
  const navChange = navRaw && typeof navRaw === 'object' ? toNavChange(navRaw as Raw) : null

  return {
    accountId,
    fromDate: parseDate(raw, 'fromDate') ?? 0,
    toDate: parseDate(raw, 'toDate') ?? 0,
    period: str(raw.period),
    whenGenerated: parseDateTime(raw, 'whenGenerated') ?? 0,
    baseCurrency: navChange?.currency ?? 'BASE',
    navChange,
    openPositions: rows(raw.OpenPositions, 'OpenPosition').map(toOpenPosition),
    trades: rows(raw.Trades, 'Trade').map(toTrade),
    lots: rows(raw.Trades, 'Lot').map(toLot),
    cashTransactions: rows(raw.CashTransactions, 'CashTransaction').map(toCashTransaction),
    performanceSummaries: rows(raw.FIFOPerformanceSummaryInBase, 'FIFOPerformanceSummaryUnderlying').map(
      toPerformanceSummary,
    ),
    securities: rows(raw.SecuritiesInfo, 'SecurityInfo').map(toSecurity),
  }
}

/**
 * Parse a Flex Query XML string into one or more typed statements. Throws
 * `ValidationError` for a non–Flex-Query file or a structurally invalid statement.
 */
export function parseFlexStatements(xml: string): FlexStatement[] {
  let doc: unknown
  try {
    doc = parser.parse(xml)
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown parse error'
    throw new ValidationError(`Could not parse the file as XML: ${detail}`)
  }

  const response = (doc as Raw | undefined)?.FlexQueryResponse
  const statementsContainer = (response as Raw | undefined)?.FlexStatements
  const statements = rows(statementsContainer, 'FlexStatement')
  if (!response || !statementsContainer || statements.length === 0) {
    throw new ValidationError(
      'This does not look like an IBKR Flex Query statement (no FlexStatements found).',
    )
  }

  return statements.map(toStatement)
}
