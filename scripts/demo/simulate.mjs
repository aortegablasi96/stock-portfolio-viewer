/**
 * The demo simulation: one pass over the fictional world in `universe.mjs` that produces
 * every figure the Flex export and the fake gateway need.
 *
 * It is deliberately ONE simulation rather than a set of hand-written fixtures. Everything the
 * app cross-checks — a position's `percentOfNAV` against the ending NAV, the daily equity
 * series against `ChangeInNAV.endingValue`, realized P&L against the trades that produced it,
 * an accrued dividend against the cash that later pays it — has to agree, and figures typed by
 * hand do not agree. Deriving them all from one state machine means they cannot disagree.
 *
 * Seeded, so regenerating produces byte-identical output: the committed XML has a diff only
 * when this code or the universe changes.
 */

import {
  ACCOUNT_ID,
  COMMISSION,
  CURRENCIES,
  DEPOSITS,
  INSTRUMENTS,
  MARKET_BETA_REFERENCE,
  MARKET_DIPS,
  MAX_SEGMENT_DAYS,
  PRICE_EPOCH,
  STATEMENTS,
  TRADES,
  TRANSACTION_TAX_COUNTRIES,
  WITHHOLDING_BY_COUNTRY,
} from './universe.mjs'

// ---- primitives -------------------------------------------------------------

/** Seeded PRNG (mulberry32) — same seed, same portfolio, every run. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box–Muller: a standard normal from two uniforms. */
function normal(rand) {
  const u = Math.max(rand(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

export const day = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
export const iso = (ms) => new Date(ms).toISOString().slice(0, 10)
export const flexDate = (ms) => iso(ms).replace(/-/g, '')
const DAY_MS = 86_400_000

/**
 * Market holidays skipped across every venue. A per-exchange calendar would be more faithful
 * and would buy the demo nothing — the daily series only has to look like trading days.
 */
const HOLIDAYS = new Set(['01-01', '05-01', '12-25', '12-26'])

function isTradingDay(ms) {
  const d = new Date(ms).getUTCDay()
  if (d === 0 || d === 6) return false
  return !HOLIDAYS.has(iso(ms).slice(5))
}

/** Every trading day in `[from, to]`, inclusive. */
function tradingDays(from, to) {
  const out = []
  for (let t = from; t <= to; t += DAY_MS) if (isTradingDay(t)) out.push(t)
  return out
}

/** The first trading day on or after `ms`. */
function onOrAfter(ms) {
  let t = ms
  while (!isTradingDay(t)) t += DAY_MS
  return t
}

const round = (n, dp) => Math.round(n * 10 ** dp) / 10 ** dp
/** Price tick: whole yen, cents everywhere else. */
const tick = (currency) => (currency === 'JPY' ? 0 : 2)

// ---- the simulation ---------------------------------------------------------

export function simulate() {
  const epoch = day(PRICE_EPOCH)
  const lastDay = day(STATEMENTS[STATEMENTS.length - 1].toDate)
  const days = tradingDays(epoch, lastDay)
  const dayIndex = new Map(days.map((d, i) => [d, i]))

  // --- price and FX paths ---------------------------------------------------

  /**
   * A Brownian bridge through the spec's control points.
   *
   * The noise is a zero-drift random walk; each segment between two control points then has
   * its own realised drift subtracted and the target's added, linearly in trading days. So the
   * line wiggles like a price and still arrives exactly where the universe says it must —
   * which is what lets the demo promise "this position is the one you sold at a gain".
   */
  function bridge(spec, seed, dp, floor) {
    const rand = rng(seed)
    const step = spec.vol * Math.sqrt(1 / 252)
    const noise = [0]
    for (let i = 1; i < days.length; i += 1) noise.push(noise[i - 1] + step * normal(rand))

    const declared = [
      { index: 0, logReturn: 0 },
      ...spec.path.map((point) => ({
        index: dayIndex.get(onOrAfter(day(point.date))) ?? days.length - 1,
        logReturn: Math.log(1 + point.return),
      })),
    ]
    const controls = pinDown(withMarketShape(declared, spec.beta ?? 0))

    const path = new Map()
    path.set(days[0], round(spec.start, dp))
    for (let c = 1; c < controls.length; c += 1) {
      const a = controls[c - 1]
      const b = controls[c]
      const span = b.index - a.index
      for (let i = a.index + 1; i <= b.index; i += 1) {
        const frac = span > 0 ? (i - a.index) / span : 1
        const logValue =
          a.logReturn +
          (noise[i] - noise[a.index]) -
          (noise[b.index] - noise[a.index]) * frac +
          (b.logReturn - a.logReturn) * frac
        path.set(days[i], Math.max(round(spec.start * Math.exp(logValue), dp), floor))
      }
    }
    return path
  }

  /** Linear interpolation of a control list's log-return at an arbitrary trading-day index. */
  function interpolate(controls, index) {
    for (let c = 1; c < controls.length; c += 1) {
      const a = controls[c - 1]
      const b = controls[c]
      if (index > b.index) continue
      const span = b.index - a.index
      const frac = span > 0 ? (index - a.index) / span : 1
      return a.logReturn + (b.logReturn - a.logReturn) * frac
    }
    return controls[controls.length - 1].logReturn
  }

  /**
   * Bend every path through the same market-wide dips (`MARKET_DIPS`), scaled by the
   * instrument's own volatility so a defensive name falls less than a cyclical one.
   *
   * The dips are *declared* rather than left to the noise, and that is the whole point. The
   * app's return curve is not drawn from the value series: within each statement period it
   * takes the shape of the daily MTM series and stretches it onto IBKR's reported TWR for that
   * period (`buildReturnSeries`). Anything the MTM path does that the period total does not is
   * therefore amplified — a wander that peaks at twice its own endpoint draws a curve that
   * overshoots to twice the period's return and falls back. Undeclared noise is exactly such a
   * wander. Declared shape is not: it is in both series, so the two charts agree.
   */
  function withMarketShape(controls, beta) {
    if (beta === 0 || MARKET_DIPS.length === 0) return controls
    const dips = MARKET_DIPS.map((dip) => {
      const index = dayIndex.get(onOrAfter(day(dip.date))) ?? days.length - 1
      return { index, logReturn: interpolate(controls, index) + Math.log(1 + dip.depth * beta) }
    }).filter((dip) => dip.index > 0 && dip.index < days.length - 1)

    return [...controls, ...dips].sort((a, b) => a.index - b.index)
  }

  /**
   * Split any control segment longer than a month, interpolating the targets.
   *
   * The noise between two control points is a bridge, so its wander grows with the gap: over a
   * year it drifts far from the trend and, for the reason above, the return curve amplifies
   * that drift. Pinning the path down monthly bounds the wander to a month's worth without
   * flattening it — the daily texture is untouched, only its ability to accumulate.
   */
  function pinDown(controls) {
    const out = [controls[0]]
    for (let c = 1; c < controls.length; c += 1) {
      const a = controls[c - 1]
      const b = controls[c]
      const pieces = Math.max(1, Math.ceil((b.index - a.index) / MAX_SEGMENT_DAYS))
      for (let p = 1; p < pieces; p += 1) {
        const index = a.index + Math.round(((b.index - a.index) * p) / pieces)
        out.push({ index, logReturn: a.logReturn + ((b.logReturn - a.logReturn) * p) / pieces })
      }
      out.push(b)
    }
    return out
  }

  /** currency → day → rate into base. */
  const fx = new Map()
  for (const [code, spec] of Object.entries(CURRENCIES)) {
    fx.set(
      code,
      code === 'EUR'
        ? new Map(days.map((d) => [d, 1]))
        : bridge({ ...spec, start: spec.rate }, hash(`fx:${code}`), 6, 1e-6),
    )
  }

  /** symbol → day → price, in the instrument's own currency. */
  const prices = new Map()
  for (const inst of INSTRUMENTS) {
    prices.set(
      inst.symbol,
      bridge(
        { ...inst, start: inst.price, beta: inst.vol / MARKET_BETA_REFERENCE },
        hash(`px:${inst.symbol}`),
        tick(inst.currency),
        currencyFloor(inst.currency),
      ),
    )
  }

  const bySymbol = new Map(INSTRUMENTS.map((i) => [i.symbol, i]))
  const priceOn = (symbol, d) => prices.get(symbol).get(d)
  const rateOn = (currency, d) => fx.get(currency).get(d)

  // --- state ----------------------------------------------------------------
  /** currency → balance. Cash is held per currency, as a real IBKR account does. */
  const cash = Object.fromEntries(Object.keys(CURRENCIES).map((c) => [c, 0]))
  /** symbol → open FIFO lots, oldest first: { date, quantity, costPerShare }. */
  const lots = new Map(INSTRUMENTS.map((i) => [i.symbol, []]))
  const positionOf = (symbol) => lots.get(symbol).reduce((q, l) => q + l.quantity, 0)

  const trades = []
  const cashTransactions = []
  /** Declared but unpaid dividends, dropped as each pays. */
  let pendingAccruals = []
  /** day → { stock, cash, accruals, total } in base, plus per-instrument detail. */
  const daily = []
  const priorPeriodRows = []
  /** symbol → realized slices, for the FIFO performance summaries. */
  const realized = []

  const eventsByDay = groupEvents()

  let transactionIdSeq = 41_000_000_001
  let actionIdSeq = 190_500_101

  for (let i = 0; i < days.length; i += 1) {
    const d = days[i]
    const prev = days[i - 1]

    // 1. Mark the book against the previous close, before anything trades today. This is
    //    exactly what IBKR's PriorPeriodPosition rows report, so it is recorded as it happens.
    if (prev !== undefined) {
      for (const inst of INSTRUMENTS) {
        const qty = positionOf(inst.symbol)
        if (qty === 0) continue
        const move = priceOn(inst.symbol, d) - priceOn(inst.symbol, prev)
        priorPeriodRows.push({
          date: d,
          instrument: inst,
          price: priceOn(inst.symbol, d),
          fxRateToBase: rateOn(inst.currency, d),
          priorMtmPnl: round(qty * move, 2),
        })
      }
    }

    // 2. External contributions.
    for (const deposit of eventsByDay.deposits.get(d) ?? []) {
      cash.EUR += deposit.amount
      cashTransactions.push({
        day: d,
        dateTime: `${flexDate(d)};202000`,
        settleDate: d,
        currency: 'EUR',
        fxRateToBase: 1,
        amount: deposit.amount,
        type: 'Deposits/Withdrawals',
        description: 'CASH RECEIPTS / ELECTRONIC FUND TRANSFERS',
        instrument: null,
        transactionId: String(transactionIdSeq++),
      })
    }

    // 3. Dividends paying today, and the accrual each one closes.
    pendingAccruals = pendingAccruals.filter((accrual) => {
      if (accrual.payDate !== d) return true
      const inst = accrual.instrument
      const rate = rateOn(inst.currency, d)
      cash[inst.currency] += accrual.netAmount
      cashTransactions.push({
        day: d,
        dateTime: `${flexDate(d)};202000`,
        settleDate: d,
        exDate: accrual.exDate,
        currency: inst.currency,
        fxRateToBase: rate,
        amount: accrual.grossAmount,
        type: 'Dividends',
        description: `${inst.symbol} (${inst.isin}) CASH DIVIDEND ${inst.currency} ${accrual.perShare} PER SHARE`,
        instrument: inst,
        transactionId: String(transactionIdSeq++),
      })
      if (accrual.tax > 0) {
        cashTransactions.push({
          day: d,
          dateTime: `${flexDate(d)};202000`,
          settleDate: d,
          exDate: accrual.exDate,
          currency: inst.currency,
          fxRateToBase: rate,
          amount: -accrual.tax,
          type: 'Withholding Tax',
          description: `${inst.symbol} (${inst.isin}) CASH DIVIDEND ${inst.currency} ${accrual.perShare} PER SHARE - ${inst.country} TAX`,
          instrument: inst,
          transactionId: String(transactionIdSeq++),
        })
      }
      return false
    })

    // 4. Trades.
    for (const order of eventsByDay.trades.get(d) ?? []) {
      const inst = bySymbol.get(order.symbol)
      const mark = priceOn(inst.symbol, d)
      // A fill is not the close: buys pay up a touch, sells give a touch away.
      const price = round(mark * (order.quantity > 0 ? 1.0015 : 0.9985), tick(inst.currency))
      const commission = COMMISSION[inst.currency]
      const rate = rateOn(inst.currency, d)
      const gross = round(Math.abs(order.quantity) * price, 2)
      const tax = round(gross * (order.quantity > 0 ? (TRANSACTION_TAX_COUNTRIES[inst.country] ?? 0) : 0), 2)

      const trade = {
        day: d,
        instrument: inst,
        quantity: order.quantity,
        tradePrice: price,
        closePrice: mark,
        fxRateToBase: rate,
        commission: -commission,
        taxes: -tax,
        lots: [],
      }

      if (order.quantity > 0) {
        const cost = round(gross + commission + tax, 2)
        spend(cash, inst.currency, cost, d, rateOn)
        lots.get(inst.symbol).push({
          date: d,
          quantity: order.quantity,
          costPerShare: round(cost / order.quantity, 6),
        })
        trade.openClose = 'O'
        trade.tradeMoney = gross
        trade.proceeds = -gross
        trade.netCash = -cost
        trade.cost = cost
        trade.realized = null
        trade.mtmPnl = round(order.quantity * (mark - price), 2)
      } else {
        const sold = Math.abs(order.quantity)
        const proceeds = round(gross - commission, 2)
        cash[inst.currency] += proceeds
        let remaining = sold
        let costConsumed = 0
        const open = lots.get(inst.symbol)
        while (remaining > 0 && open.length > 0) {
          const lot = open[0]
          const take = Math.min(lot.quantity, remaining)
          const lotCost = round(take * lot.costPerShare, 2)
          const lotProceeds = round((take / sold) * proceeds, 2)
          const term = d - lot.date >= 365 * DAY_MS ? 'LT' : 'ST'
          const slice = {
            date: d,
            instrument: inst,
            openedOn: lot.date,
            quantity: take,
            costPerShare: lot.costPerShare,
            cost: lotCost,
            realized: round(lotProceeds - lotCost, 2),
            term,
            fxRateToBase: rate,
          }
          trade.lots.push(slice)
          realized.push(slice)
          costConsumed += lotCost
          remaining -= take
          lot.quantity -= take
          if (lot.quantity === 0) open.shift()
        }
        trade.openClose = 'C'
        trade.tradeMoney = -gross
        trade.proceeds = gross
        trade.netCash = proceeds
        trade.cost = -round(costConsumed, 2)
        trade.realized = round(proceeds - costConsumed, 2)
        trade.mtmPnl = round(sold * (price - mark), 2)
      }
      trades.push(trade)
    }

    // 5. Dividends declaring today (ex-date), against the position now held.
    for (const declaration of eventsByDay.exDates.get(d) ?? []) {
      const inst = declaration.instrument
      const quantity = positionOf(inst.symbol)
      if (quantity <= 0) continue
      const grossAmount = round(quantity * declaration.perShare, 2)
      const tax = round(grossAmount * (WITHHOLDING_BY_COUNTRY[inst.country] ?? 0), 2)
      pendingAccruals.push({
        instrument: inst,
        exDate: d,
        payDate: declaration.payDate,
        quantity,
        perShare: declaration.perShare,
        grossAmount,
        tax,
        netAmount: round(grossAmount - tax, 2),
        actionId: String(actionIdSeq++),
      })
    }

    // 6. Close the day: mark every component into base currency.
    const holdings = INSTRUMENTS.map((inst) => ({
      instrument: inst,
      quantity: positionOf(inst.symbol),
      price: priceOn(inst.symbol, d),
      fxRateToBase: rateOn(inst.currency, d),
      lots: lots.get(inst.symbol).map((l) => ({ ...l })),
    })).filter((h) => h.quantity !== 0)

    const stock = holdings.reduce((s, h) => s + h.quantity * h.price * h.fxRateToBase, 0)
    const cashBase = Object.entries(cash).reduce((s, [c, v]) => s + v * rateOn(c, d), 0)
    const accrualsBase = pendingAccruals.reduce(
      (s, a) => s + a.netAmount * rateOn(a.instrument.currency, d),
      0,
    )

    daily.push({
      date: d,
      stock: round(stock, 6),
      cash: round(cashBase, 6),
      accruals: round(accrualsBase, 6),
      total: round(stock + cashBase + accrualsBase, 6),
      holdings,
      cashByCurrency: { ...cash },
      pendingAccruals: pendingAccruals.map((a) => ({ ...a })),
    })
  }

  return {
    accountId: ACCOUNT_ID,
    days,
    dayIndex,
    daily,
    trades,
    cashTransactions,
    priorPeriodRows,
    realized,
    prices,
    fx,
    priceOn,
    rateOn,
  }

  // --- helpers that close over the universe ---------------------------------

  function groupEvents() {
    const deposits = new Map()
    for (const deposit of DEPOSITS) {
      const d = onOrAfter(day(deposit.date))
      push(deposits, d, deposit)
    }

    const tradeDays = new Map()
    for (const order of TRADES) push(tradeDays, onOrAfter(day(order.date)), order)

    // Dividend declarations: an ex-date every scheduled month, paying ~two weeks later.
    const exDates = new Map()
    for (const inst of INSTRUMENTS) {
      if (!inst.dividend) continue
      for (let year = 2024; year <= 2026; year += 1) {
        for (const month of inst.dividend.months) {
          const ex = onOrAfter(Date.UTC(year, month - 1, inst.dividend.day))
          if (ex < days[0] || ex > lastDay) continue
          push(exDates, ex, {
            instrument: inst,
            perShare: inst.dividend.perShare,
            payDate: onOrAfter(ex + 14 * DAY_MS),
          })
        }
      }
    }
    return { deposits, trades: tradeDays, exDates }
  }
}

function push(map, key, value) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/**
 * Pay `amount` out of a currency balance, converting from base first when the balance would
 * go negative — which is how the account behaves when a euro-funded account buys in dollars.
 * The conversion itself is not recorded as a Flex row; the demo's cash currencies exist so the
 * gateway ledger has more than one line, not to demonstrate FX trading.
 */
function spend(cash, currency, amount, d, rateOn) {
  const short = amount - cash[currency]
  if (short > 0 && currency !== 'EUR') {
    cash.EUR -= short * rateOn(currency, d)
    cash[currency] += short
  }
  cash[currency] -= amount
}

/** Prices are floored so a bad draw cannot produce a zero or negative quote. */
function currencyFloor(currency) {
  return currency === 'JPY' ? 1 : 0.01
}

/** A stable 32-bit seed from a string, so each path is independent but reproducible. */
function hash(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export { day as toDay, isTradingDay, onOrAfter, round, tradingDays }
