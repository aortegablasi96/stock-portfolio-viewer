/**
 * Render the simulated demo world into the two artefacts the app consumes:
 *
 *   demo/flex/demo-2025.xml     an IBKR Portfolio Analyst Flex Query export (closed year)
 *   demo/flex/demo-2026.xml     the same, year-to-date
 *   demo/gateway/state.json     the live reading `scripts/demo/gateway.mjs` serves
 *
 * The XML follows the structure of the real exports in `docs/flex-queries/` — the same
 * sections, the same attributes, in the same order — because that structure is the parser's
 * contract and a demo that drifts from it stops proving anything. The *figures* are entirely
 * invented (see `universe.mjs`).
 *
 * Run: npm run demo:generate
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASE_CURRENCY, STATEMENTS } from './universe.mjs'
import { flexDate, round, simulate, toDay as day } from './simulate.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..')
const flexDir = join(repoRoot, 'demo', 'flex')
const gatewayDir = join(repoRoot, 'demo', 'gateway')

const world = simulate()

// ---- XML helpers ------------------------------------------------------------

const escape = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A number as Flex writes it: plain decimal, no exponent, no trailing noise. */
const num = (value, dp = 6) => {
  const rounded = round(value, dp)
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

/** One self-closing element; attributes with an `undefined` value are omitted entirely. */
function el(tag, attrs, indent) {
  const pairs = Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}="${escape(v)}"`)
  return `${indent}<${tag} ${pairs.join(' ')} />`
}

// ---- per-statement assembly -------------------------------------------------

const dayBefore = (d) => {
  const i = world.days.indexOf(d)
  const at = i >= 0 ? i : world.days.findIndex((x) => x > d)
  return world.days[Math.max(at - 1, 0)]
}

/** The last simulated close on or before `d` — statement bounds land on weekends. */
function closeOnOrBefore(d) {
  let best
  for (const row of world.daily) {
    if (row.date <= d) best = row
    else break
  }
  return best
}

function buildStatement(spec) {
  const from = day(spec.fromDate)
  const to = day(spec.toDate)
  const opening = closeOnOrBefore(dayBefore(from))
  const closing = closeOnOrBefore(to)
  const inPeriod = (d) => d >= from && d <= to

  const equityRows = world.daily.filter((r) => r.date >= opening.date && r.date <= closing.date)
  const priorRows = world.priorPeriodRows.filter((r) => inPeriod(r.date))
  const trades = world.trades.filter((t) => inPeriod(t.day))
  const cashRows = world.cashTransactions.filter((c) => inPeriod(c.day))
  const realized = world.realized.filter((r) => inPeriod(r.date))

  // Every instrument the period touched, plus everything still held at its end: the
  // securities section is the reference data for the rows above, so anything named in one
  // of them has to appear here or the Allocation view loses its issuer country.
  const touched = new Map()
  for (const t of trades) touched.set(t.instrument.symbol, t.instrument)
  for (const r of priorRows) touched.set(r.instrument.symbol, r.instrument)
  for (const c of cashRows) if (c.instrument) touched.set(c.instrument.symbol, c.instrument)
  for (const h of closing.holdings) touched.set(h.instrument.symbol, h.instrument)
  const securities = [...touched.values()].sort((a, b) => a.conid - b.conid)

  const nav = buildNavChange({ spec, from, to, opening, closing, priorRows, cashRows, trades })

  return {
    spec,
    from,
    to,
    opening,
    closing,
    equityRows,
    priorRows,
    trades,
    cashRows,
    realized,
    securities,
    nav,
    fifo: buildFifoSummaries(realized, closing),
  }
}

/**
 * `ChangeInNAV`, the statement's headline reconciliation.
 *
 * Every component is summed from the events that produced it; `fxTranslation` then absorbs
 * whatever is left, which is what it means — the base-currency value of foreign cash and
 * holdings moves without any transaction happening. Anchoring it this way keeps
 * `startingValue + Σ components === endingValue` exactly, which is the identity the real
 * exports hold and the one the app's stat tiles are read against.
 */
function buildNavChange({ spec, from, to, opening, closing, priorRows, cashRows, trades }) {
  const mtm = priorRows.reduce((s, r) => s + r.priorMtmPnl * r.fxRateToBase, 0)
  const sumCash = (type) =>
    cashRows.filter((c) => c.type === type).reduce((s, c) => s + c.amount * c.fxRateToBase, 0)

  const deposits = sumCash('Deposits/Withdrawals')
  const dividends = sumCash('Dividends')
  const withholdingTax = sumCash('Withholding Tax')
  const commissions = trades.reduce((s, t) => s + t.commission * t.fxRateToBase, 0)
  const transactionTax = trades.reduce((s, t) => s + t.taxes * t.fxRateToBase, 0)
  const changeInAccruals = closing.accruals - opening.accruals

  const explained =
    opening.total + mtm + deposits + dividends + withholdingTax + commissions + transactionTax + changeInAccruals

  return {
    currency: BASE_CURRENCY,
    fromDate: from,
    toDate: to,
    startingValue: opening.total,
    endingValue: closing.total,
    mtm,
    depositsWithdrawals: deposits,
    dividends,
    withholdingTax,
    commissions,
    transactionTax,
    changeInDividendAccruals: changeInAccruals,
    fxTranslation: closing.total - explained,
    twr: timeWeightedReturn(from, to, cashRows),
    period: spec.period,
  }
}

/**
 * The period's time-weighted return, as a percentage.
 *
 * Computed the way TWR is defined — chain-linked daily returns with each day's external flow
 * removed from the numerator — rather than backed out of the value change, so the app's own
 * chain-linking of `twr` across statements lands on the right cumulative figure. Days opening
 * at zero value contribute nothing: before the account is funded there is no return to measure.
 */
function timeWeightedReturn(from, to, cashRows) {
  const flowByDay = new Map()
  for (const c of cashRows) {
    if (c.type !== 'Deposits/Withdrawals') continue
    flowByDay.set(c.day, (flowByDay.get(c.day) ?? 0) + c.amount * c.fxRateToBase)
  }

  let growth = 1
  let previous = null
  for (const row of world.daily) {
    if (row.date > to) break
    if (row.date >= from && previous !== null && previous.total > 1) {
      growth *= (row.total - (flowByDay.get(row.date) ?? 0)) / previous.total
    }
    if (row.date <= to) previous = row
  }
  return (growth - 1) * 100
}

/**
 * FIFO performance summaries, in base currency, one row per instrument plus IBKR's
 * "Total (All Assets)" aggregate.
 *
 * The aggregate row is generated on purpose: it is blank-symbolled, it double-counts every
 * total if summed, and `isInstrumentSummary` exists to drop it. A demo export without it would
 * quietly stop exercising the guard that a real export always trips.
 */
function buildFifoSummaries(realized, closing) {
  const rows = new Map()
  const rowFor = (inst) => {
    let row = rows.get(inst.symbol)
    if (!row) {
      row = {
        instrument: inst,
        realizedStProfit: 0,
        realizedStLoss: 0,
        realizedLtProfit: 0,
        realizedLtLoss: 0,
        unrealizedProfit: 0,
        unrealizedLoss: 0,
      }
      rows.set(inst.symbol, row)
    }
    return row
  }

  for (const slice of realized) {
    const row = rowFor(slice.instrument)
    const base = slice.realized * slice.fxRateToBase
    const key = slice.term === 'LT' ? 'realizedLt' : 'realizedSt'
    if (base >= 0) row[`${key}Profit`] += base
    else row[`${key}Loss`] += base
  }

  for (const holding of closing.holdings) {
    const row = rowFor(holding.instrument)
    const cost = holding.lots.reduce((s, l) => s + l.quantity * l.costPerShare, 0)
    const base = (holding.quantity * holding.price - cost) * holding.fxRateToBase
    if (base >= 0) row.unrealizedProfit += base
    else row.unrealizedLoss += base
  }

  const list = [...rows.values()]
    .map((row) => ({
      ...row,
      totalRealizedPnl: row.realizedStProfit + row.realizedStLoss + row.realizedLtProfit + row.realizedLtLoss,
      totalUnrealizedPnl: row.unrealizedProfit + row.unrealizedLoss,
    }))
    .sort((a, b) => a.instrument.symbol.localeCompare(b.instrument.symbol))

  const total = list.reduce(
    (acc, row) => {
      for (const key of Object.keys(acc)) acc[key] += row[key]
      return acc
    },
    {
      realizedStProfit: 0,
      realizedStLoss: 0,
      realizedLtProfit: 0,
      realizedLtLoss: 0,
      unrealizedProfit: 0,
      unrealizedLoss: 0,
      totalRealizedPnl: 0,
      totalUnrealizedPnl: 0,
    },
  )

  return { list, total }
}

// ---- XML rendering ----------------------------------------------------------

function renderStatement(s) {
  const out = []
  const nav = s.nav
  out.push('<FlexQueryResponse queryName="portfolio-analyst" type="AF">')
  out.push('<FlexStatements count="1">')
  out.push(
    `<FlexStatement accountId="${world.accountId}" fromDate="${flexDate(s.from)}" toDate="${flexDate(s.to)}" period="${s.spec.period}" whenGenerated="${s.spec.whenGenerated}">`,
  )

  out.push('<EquitySummaryInBase>')
  for (const row of s.equityRows) {
    out.push(
      el(
        'EquitySummaryByReportDateInBase',
        {
          currency: BASE_CURRENCY,
          reportDate: flexDate(row.date),
          cash: num(row.cash, 9),
          cashLong: num(row.cash, 9),
          cashShort: '0',
          stock: num(row.stock, 9),
          stockLong: num(row.stock, 9),
          stockShort: '0',
          dividendAccruals: num(row.accruals, 9),
          dividendAccrualsLong: num(row.accruals, 9),
          dividendAccrualsShort: '0',
          interestAccruals: '0',
          interestAccrualsLong: '0',
          interestAccrualsShort: '0',
          brokerFeesAccrualsComponent: '0',
          brokerFeesAccrualsComponentLong: '0',
          brokerFeesAccrualsComponentShort: '0',
          total: num(row.total, 9),
          totalLong: num(row.total, 9),
          totalShort: '0',
        },
        '',
      ),
    )
  }
  out.push('</EquitySummaryInBase>')

  out.push(
    el(
      'ChangeInNAV',
      {
        currency: BASE_CURRENCY,
        fromDate: flexDate(s.from),
        toDate: flexDate(s.to),
        startingValue: num(nav.startingValue, 9),
        mtm: num(nav.mtm, 9),
        costAdjustments: '0',
        depositsWithdrawals: num(nav.depositsWithdrawals, 9),
        assetTransfers: '0',
        dividends: num(nav.dividends, 9),
        withholdingTax: num(nav.withholdingTax, 9),
        changeInDividendAccruals: num(nav.changeInDividendAccruals, 9),
        interest: '0',
        changeInInterestAccruals: '0',
        brokerFees: '0',
        changeInBrokerFeeAccruals: '0',
        otherFees: '0',
        otherIncome: '0',
        commissions: num(nav.commissions, 9),
        forexCommissions: '0',
        transactionTax: num(nav.transactionTax, 9),
        fxTranslation: num(nav.fxTranslation, 9),
        other: '0',
        endingValue: num(nav.endingValue, 9),
        twr: num(nav.twr, 9),
        corporateActionProceeds: '0',
      },
      '',
    ),
  )

  out.push('<OpenPositions>')
  for (const h of s.closing.holdings) {
    const cost = h.lots.reduce((sum, l) => sum + l.quantity * l.costPerShare, 0)
    const value = h.quantity * h.price
    out.push(
      el(
        'OpenPosition',
        {
          currency: h.instrument.currency,
          fxRateToBase: num(h.fxRateToBase),
          assetCategory: 'STK',
          symbol: h.instrument.symbol,
          description: h.instrument.name,
          conid: h.instrument.conid,
          cusip: '',
          isin: h.instrument.isin,
          listingExchange: h.instrument.exchange,
          multiplier: '1',
          reportDate: flexDate(s.to),
          position: num(h.quantity, 4),
          markPrice: num(h.price, 4),
          costBasisPrice: num(cost / h.quantity, 9),
          costBasisMoney: num(cost, 4),
          percentOfNAV: num((value * h.fxRateToBase * 100) / s.closing.total, 2),
          fifoPnlUnrealized: num(value - cost, 4),
          side: 'Long',
          openDateTime: '',
        },
        '',
      ),
    )
  }
  out.push('</OpenPositions>')

  out.push('<PriorPeriodPositions>')
  for (const row of s.priorRows) {
    out.push(
      el(
        'PriorPeriodPosition',
        {
          currency: row.instrument.currency,
          fxRateToBase: num(row.fxRateToBase),
          assetCategory: 'STK',
          symbol: row.instrument.symbol,
          description: row.instrument.name,
          conid: row.instrument.conid,
          cusip: '',
          isin: row.instrument.isin,
          multiplier: '1',
          date: flexDate(row.date),
          price: num(row.price, 4),
          priorMtmPnl: num(row.priorMtmPnl, 2),
        },
        '',
      ),
    )
  }
  out.push('</PriorPeriodPositions>')

  out.push('<Trades>')
  for (const t of s.trades) {
    const inst = t.instrument
    out.push(
      el(
        'Trade',
        {
          currency: inst.currency,
          fxRateToBase: num(t.fxRateToBase),
          assetCategory: 'STK',
          symbol: inst.symbol,
          description: inst.name,
          conid: inst.conid,
          cusip: '',
          isin: inst.isin,
          listingExchange: inst.exchange,
          multiplier: '1',
          dateTime: `${flexDate(t.day)};${t.quantity > 0 ? '103512' : '145907'}`,
          tradeDate: flexDate(t.day),
          settleDateTarget: flexDate(settle(t.day)),
          transactionType: 'ExchTrade',
          exchange: inst.exchange,
          quantity: num(t.quantity, 4),
          tradePrice: num(t.tradePrice, 4),
          tradeMoney: num(t.tradeMoney, 4),
          proceeds: num(t.proceeds, 4),
          taxes: num(t.taxes, 4),
          ibCommission: num(t.commission, 4),
          ibCommissionCurrency: inst.currency,
          netCash: num(t.netCash, 4),
          closePrice: num(t.closePrice, 4),
          openCloseIndicator: t.openClose,
          notes: '',
          cost: num(t.cost, 4),
          fifoPnlRealized: t.realized === null ? '0' : num(t.realized, 4),
          mtmPnl: num(t.mtmPnl, 4),
        },
        '',
      ),
    )
    for (const lot of t.lots) {
      out.push(
        el(
          'Lot',
          {
            currency: inst.currency,
            fxRateToBase: num(t.fxRateToBase),
            assetCategory: 'STK',
            symbol: inst.symbol,
            description: inst.name,
            conid: inst.conid,
            cusip: '',
            isin: inst.isin,
            listingExchange: inst.exchange,
            multiplier: '1',
            dateTime: `${flexDate(t.day)};145907`,
            tradeDate: flexDate(t.day),
            settleDateTarget: '',
            transactionType: '',
            exchange: inst.exchange,
            quantity: num(lot.quantity, 4),
            tradePrice: num(lot.costPerShare, 9),
            tradeMoney: '',
            proceeds: '',
            taxes: '',
            ibCommission: '',
            ibCommissionCurrency: '',
            netCash: '',
            closePrice: '',
            openCloseIndicator: 'C',
            notes: lot.term,
            cost: num(lot.cost, 4),
            fifoPnlRealized: num(lot.realized, 6),
            mtmPnl: '',
          },
          '',
        ),
      )
    }
  }
  out.push('</Trades>')
  out.push('<TradeTransfers />')
  out.push('<OptionEAE />')
  out.push('<CorporateActions />')

  out.push('<CashTransactions>')
  for (const c of s.cashRows) {
    out.push(
      el(
        'CashTransaction',
        {
          currency: c.currency,
          fxRateToBase: num(c.fxRateToBase),
          assetCategory: c.instrument ? 'STK' : '',
          symbol: c.instrument?.symbol ?? '',
          description: c.description,
          conid: c.instrument?.conid ?? '',
          cusip: '',
          isin: c.instrument?.isin ?? '',
          dateTime: c.dateTime,
          settleDate: flexDate(c.settleDate),
          amount: num(c.amount, 4),
          type: c.type,
          dividendType: c.type === 'Dividends' ? 'Ordinary Dividend' : '',
          tradeID: '',
          code: '',
          transactionID: c.transactionId,
          exDate: c.exDate === undefined ? '' : flexDate(c.exDate),
        },
        '',
      ),
    )
  }
  out.push('</CashTransactions>')
  out.push('<InterestAccruals />')

  out.push('<OpenDividendAccruals>')
  for (const a of s.closing.pendingAccruals) {
    out.push(
      el(
        'OpenDividendAccrual',
        {
          currency: a.instrument.currency,
          fxRateToBase: num(world.rateOn(a.instrument.currency, s.closing.date)),
          assetCategory: 'STK',
          symbol: a.instrument.symbol,
          description: a.instrument.name,
          conid: a.instrument.conid,
          cusip: '',
          isin: a.instrument.isin,
          multiplier: '1',
          reportDate: flexDate(s.to),
          exDate: flexDate(a.exDate),
          payDate: flexDate(a.payDate),
          quantity: num(a.quantity, 4),
          tax: num(a.tax, 4),
          fee: '0',
          grossRate: num(a.perShare, 6),
          grossAmount: num(a.grossAmount, 4),
          netAmount: num(a.netAmount, 4),
          actionID: a.actionId,
        },
        '',
      ),
    )
  }
  out.push('</OpenDividendAccruals>')

  out.push('<FIFOPerformanceSummaryInBase>')
  for (const row of s.fifo.list) {
    out.push(fifoRow(row, row.instrument))
  }
  out.push(fifoRow(s.fifo.total, null))
  out.push('</FIFOPerformanceSummaryInBase>')

  out.push('<SecuritiesInfo>')
  for (const inst of s.securities) {
    out.push(
      el(
        'SecurityInfo',
        {
          currency: inst.currency,
          assetCategory: 'STK',
          subCategory: 'COMMON',
          symbol: inst.symbol,
          description: inst.name,
          conid: inst.conid,
          cusip: '',
          isin: inst.isin,
          listingExchange: inst.exchange,
          issuerCountryCode: inst.country,
          multiplier: '1',
        },
        '',
      ),
    )
  }
  out.push('</SecuritiesInfo>')

  out.push('</FlexStatement>')
  out.push('</FlexStatements>')
  out.push('</FlexQueryResponse>')
  return `${out.join('\n')}\n`
}

/** One FIFO summary row; `instrument === null` renders IBKR's "Total (All Assets)" line. */
function fifoRow(row, instrument) {
  return el(
    'FIFOPerformanceSummaryUnderlying',
    {
      assetCategory: instrument ? 'STK' : '',
      symbol: instrument?.symbol ?? '',
      description: instrument?.name ?? 'Total (All Assets)',
      conid: instrument?.conid ?? '',
      cusip: '',
      isin: instrument?.isin ?? '',
      multiplier: instrument ? '1' : '',
      reportDate: '',
      costAdj: '0',
      realizedSTProfit: num(row.realizedStProfit, 9),
      realizedSTLoss: num(row.realizedStLoss, 9),
      realizedLTProfit: num(row.realizedLtProfit, 9),
      realizedLTLoss: num(row.realizedLtLoss, 9),
      totalRealizedPnl: num(row.totalRealizedPnl, 9),
      unrealizedProfit: num(row.unrealizedProfit, 9),
      unrealizedLoss: num(row.unrealizedLoss, 9),
      unrealizedSTProfit: num(row.unrealizedProfit, 9),
      unrealizedSTLoss: num(row.unrealizedLoss, 9),
      unrealizedLTProfit: '0',
      unrealizedLTLoss: '0',
      totalUnrealizedPnl: num(row.totalUnrealizedPnl, 9),
      totalFifoPnl: num(row.totalRealizedPnl + row.totalUnrealizedPnl, 9),
      transferredPnl: '0',
    },
    '',
  )
}

/** T+2 settlement, skipping the weekend. */
function settle(d) {
  let t = d
  let added = 0
  while (added < 2) {
    t += 86_400_000
    const wd = new Date(t).getUTCDay()
    if (wd !== 0 && wd !== 6) added += 1
  }
  return t
}

// ---- the live gateway reading ----------------------------------------------

/**
 * The state `gateway.mjs` serves as a live IBKR Client Portal Gateway reading.
 *
 * Taken from the last simulated close, so the "live" portfolio and the imported history agree
 * on conids, quantities and cost — which is what makes the Portfolio view's instrument names
 * (read locally from Flex by conid, DDR-0088) resolve at all. The server jitters the prices on
 * each read so the reading moves the way a live one does.
 */
function buildGatewayState() {
  const closing = world.daily[world.daily.length - 1]
  const rate = (c) => world.rateOn(c, closing.date)

  const positions = closing.holdings.map((h) => {
    const cost = h.lots.reduce((s, l) => s + l.quantity * l.costPerShare, 0)
    return {
      conid: h.instrument.conid,
      // No `ticker`: this gateway build does not send one, so `symbol` and `description` both
      // fall back to `contractDesc` (DDR-0066/0088). The fake gateway reproduces that rather
      // than being more generous than the real one.
      contractDesc: h.instrument.name,
      position: h.quantity,
      mktPrice: round(h.price, 4),
      mktValue: round(h.quantity * h.price, 2),
      avgCost: round(cost / h.quantity, 6),
      unrealizedPnl: round(h.quantity * h.price - cost, 2),
      currency: h.instrument.currency,
      industry: h.instrument.industry,
      category: h.instrument.category,
    }
  })

  const ledger = { BASE: baseEntry() }
  for (const [currency, balance] of Object.entries(closing.cashByCurrency)) {
    const stock = closing.holdings
      .filter((h) => h.instrument.currency === currency)
      .reduce((s, h) => s + h.quantity * h.price, 0)
    if (balance === 0 && stock === 0) continue
    ledger[currency] = {
      currency,
      cashbalance: round(balance, 2),
      stockmarketvalue: round(stock, 2),
      netliquidationvalue: round(balance + stock, 2),
      exchangerate: rate(currency),
    }
  }

  return {
    generatedAt: new Date(closing.date).toISOString(),
    accountId: world.accountId,
    baseCurrency: BASE_CURRENCY,
    rates: Object.fromEntries(
      [...world.fx.keys()].map((c) => [c, rate(c)]),
    ),
    positions,
    ledger,
  }

  function baseEntry() {
    return {
      currency: 'BASE',
      cashbalance: round(closing.cash, 2),
      stockmarketvalue: round(closing.stock, 2),
      netliquidationvalue: round(closing.total, 2),
      exchangerate: 1,
    }
  }
}

// ---- write ------------------------------------------------------------------

const statements = STATEMENTS.map(buildStatement)

mkdirSync(flexDir, { recursive: true })
mkdirSync(gatewayDir, { recursive: true })

for (const s of statements) {
  const year = s.spec.toDate.slice(0, 4)
  const path = join(flexDir, `demo-${year}.xml`)
  writeFileSync(path, renderStatement(s), 'utf8')
  console.log(
    `wrote ${path}  ${s.equityRows.length} days · ${s.trades.length} trades · ` +
      `${s.cashRows.length} cash rows · NAV ${s.nav.startingValue.toFixed(0)} → ${s.nav.endingValue.toFixed(0)} ` +
      `· TWR ${s.nav.twr.toFixed(2)}%`,
  )
}

const state = buildGatewayState()
writeFileSync(join(gatewayDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
console.log(
  `wrote ${join(gatewayDir, 'state.json')}  ${state.positions.length} positions · ` +
    `NAV ${state.ledger.BASE.netliquidationvalue} ${BASE_CURRENCY}`,
)

// A demo whose cash went negative would show a borrowed portfolio nobody asked for.
const worstCash = Math.min(...world.daily.map((r) => r.cashByCurrency.EUR))
if (worstCash < 0) {
  console.warn(`WARNING: base cash went to ${worstCash.toFixed(2)} — adjust DEPOSITS or TRADES.`)
}
