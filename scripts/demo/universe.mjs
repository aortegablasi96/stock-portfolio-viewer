/**
 * The world the demo data is generated from.
 *
 * The **companies are real and well known** — a demo reads as a portfolio when the names are
 * ones the audience recognises, and invented tickers read as a test fixture. Everything else is
 * INVENTED: every quantity, price, price path, trade date, dividend, balance, and the account
 * number itself. Nothing here is market data, nothing is a recommendation, and nothing
 * describes anyone's real position. Prices are only in the right ballpark so the figures sit
 * naturally beside each other; they are not quotes and never were.
 *
 * The identifiers each company genuinely publishes — ISIN, listing exchange, issuer country,
 * IBKR's sector and industry — are real, because a demo that files Nestlé under Banks looks
 * broken. IBKR contract ids are not: those identify nothing outside this file.
 *
 * Structure only is copied from the real Flex exports in `docs/flex-queries/` (gitignored):
 * which sections exist, which attributes each row carries, and how the figures relate.
 */

/** Fictional IBKR account number. Real ones are `U` + 8 digits; this one is not issued. */
export const ACCOUNT_ID = 'U7734120'

export const BASE_CURRENCY = 'EUR'

/**
 * The statements the demo imports: the stub quarter the account opened in, one closed full
 * year, and a year-to-date.
 *
 * More than one on purpose — a single statement would never exercise the traps that only
 * appear across statements (realized P&L sums, unrealized P&L must not, and
 * `flex_equity_summaries` duplicates a shared calendar day).
 *
 * The opening quarter earns its place twice over. It gives 2025 a real starting value, and it
 * puts the *opening purchases* inside imported history — without which the Dividends view
 * reconstructs share counts from trades it cannot see and divides a payment by the wrong
 * number, quoting a per-share figure that never existed.
 */
export const STATEMENTS = [
  { fromDate: '2024-10-01', toDate: '2024-12-31', period: 'Custom', whenGenerated: '20250102;065500' },
  { fromDate: '2025-01-01', toDate: '2025-12-31', period: 'Year', whenGenerated: '20260102;071500' },
  { fromDate: '2026-01-01', toDate: '2026-09-04', period: 'YearToDate', whenGenerated: '20260905;064210' },
]

/**
 * The day prices are seeded on. A quarter *before* the first statement, because an account that
 * opens at zero has no opening value — and the app then has no denominator, so its headline
 * "value change %" reads as an em dash. Real statements almost always carry positions forward,
 * and the demo should show the case the owner actually has.
 */
export const PRICE_EPOCH = '2024-09-30'

/**
 * How every price and rate in the demo is shaped.
 *
 * A plain random walk was the obvious way to do this and it was wrong: over one year the noise
 * swamps the drift, so the instrument written to be the winner exited at a loss and the one
 * written to be the loser closed up. A demo needs a *story* — a gain to realise, a loser still
 * held, a sector that dragged — and a seed cannot be asked to tell one.
 *
 * So each path is a Brownian **bridge**: random walk texture between control points it is
 * pinned to. `vol` still sets how jagged the line is; `path` says where it has to arrive and
 * when, as a cumulative return from `PRICE_EPOCH`. The last control point must land on the
 * final statement's end date, so nothing is left to drift.
 *
 * The targets are invented, and deliberately not a replay of what these companies did.
 *
 * Two constants below bound how far the noise may wander between those points, and they exist
 * because of how the app draws its **return** curve. That curve is not the value series: inside
 * each statement period the app takes the shape of the daily mark-to-market series and stretches
 * it onto IBKR's reported TWR for the period. So any excursion the MTM path makes that the
 * period total does not is amplified — a path that peaks at twice its own endpoint draws a
 * return curve that overshoots to twice the period's return and falls back, and daily noise
 * that accumulates over a year draws a curve that jitters by more than the year's return. The
 * demo shipped like that once and it read as a broken chart.
 */

/**
 * The longest run of trading days a path may go without being pinned to a target. A month, so
 * the bridge's wander is a month's worth rather than a year's, without touching daily texture.
 */
export const MAX_SEGMENT_DAYS = 21

/**
 * Market-wide setbacks every instrument bends through, as a fraction below the trend it would
 * otherwise have followed on that date. Declared rather than left to the noise: a drawdown in
 * the data is in *both* the value curve and the MTM series, so the two charts agree about it.
 *
 * Each is written as three points — a slide, a trough, and most of a recovery — because a
 * single point would draw a V, and drawdowns are not V-shaped.
 */
export const MARKET_DIPS = [
  { date: '2025-04-30', depth: -0.03 },
  { date: '2025-06-27', depth: -0.09 },
  { date: '2025-08-15', depth: -0.03 },
  { date: '2026-05-29', depth: -0.03 },
  { date: '2026-07-15', depth: -0.06 },
  { date: '2026-08-14', depth: -0.02 },
]

/**
 * The volatility a dip's declared depth is quoted against. An instrument bends by
 * `depth × vol / MARKET_BETA_REFERENCE`, so Nestlé gives up less than ASML in the same week.
 */
export const MARKET_BETA_REFERENCE = 0.16

/**
 * Currencies held, and how each moves against the base. `rate` is units of base (EUR) per unit
 * of the currency on `PRICE_EPOCH`. The base currency is pinned at exactly 1 and never moves,
 * which is what IBKR reports for it.
 */
export const CURRENCIES = {
  EUR: { rate: 1, vol: 0, path: [] },
  USD: {
    rate: 0.9184,
    vol: 0.036,
    path: [
      { date: '2024-12-31', return: 0.008 },
      { date: '2025-12-31', return: -0.012 },
      { date: '2026-09-04', return: -0.025 },
    ],
  },
  CHF: {
    rate: 1.0642,
    vol: 0.027,
    path: [
      { date: '2024-12-31', return: 0.004 },
      { date: '2025-12-31', return: 0.018 },
      { date: '2026-09-04', return: 0.032 },
    ],
  },
  GBP: {
    rate: 1.1735,
    vol: 0.03,
    path: [
      { date: '2024-12-31', return: 0.002 },
      { date: '2025-12-31', return: -0.004 },
      { date: '2026-09-04', return: 0.006 },
    ],
  },
  CAD: {
    rate: 0.6421,
    vol: 0.03,
    path: [
      { date: '2024-12-31', return: -0.005 },
      { date: '2025-12-31', return: -0.014 },
      { date: '2026-09-04', return: -0.02 },
    ],
  },
  JPY: {
    rate: 0.006134,
    vol: 0.048,
    path: [
      { date: '2024-12-31', return: 0.01 },
      { date: '2025-12-31', return: 0.026 },
      { date: '2026-09-04', return: 0.047 },
    ],
  },
}

/**
 * Withholding rates applied to a dividend, by the issuer's country. Real treaty rates, so the
 * Dividends view's gross/net split reads plausibly; the amounts they apply to are not.
 */
export const WITHHOLDING_BY_COUNTRY = {
  NL: 0.15,
  US: 0.15,
  GB: 0,
  CA: 0.15,
  JP: 0.15315,
  ES: 0.19,
  FR: 0.128,
  CH: 0.35,
  DE: 0.26375,
}

/**
 * The instrument universe: nine holdings spread deliberately wide — **eight IBKR sectors, six
 * currencies and eight countries** — plus two positions the demo closes. The spread is the
 * point: a donut, a country map and a currency breakdown all have to have something to draw,
 * and a portfolio of nine US tech names would leave three of the app's views saying one thing.
 *
 * `industry` / `category` are what the fake gateway serves from
 * `/iserver/contract/{conid}/info` — IBKR's own two-level classification, where `industry` is
 * the broad sector the app groups by and `category` the narrower one. The vocabulary follows
 * IBKR's ("Consumer, Non-cyclical", "Basic Materials", …) rather than GICS, because that is
 * what the app actually receives and caches.
 *
 * `price` is a plausible opening level, not a quote; `vol` and `path` shape the invented price
 * history from it. The targets give the demo a portfolio that rises overall while still holding
 * losers and realising one gain and one loss — a chart where everything goes up demonstrates
 * nothing.
 */
export const INSTRUMENTS = [
  {
    symbol: 'ASML',
    name: 'ASML HOLDING NV',
    conid: 71004201,
    currency: 'EUR',
    country: 'NL',
    exchange: 'AEB',
    isin: 'NL0010273215',
    industry: 'Technology',
    category: 'Semiconductors',
    price: 682,
    vol: 0.186,
    path: [
      { date: '2024-12-31', return: 0.05 },
      { date: '2025-12-31', return: 0.22 },
      { date: '2026-09-04', return: 0.41 },
    ],
    dividend: { perShare: 1.52, months: [2, 5, 8, 11], day: 14 },
  },
  {
    symbol: 'SAN',
    name: 'BANCO SANTANDER SA',
    conid: 71004202,
    currency: 'EUR',
    country: 'ES',
    exchange: 'BM',
    isin: 'ES0113900J37',
    industry: 'Financial',
    category: 'Banks',
    price: 4.52,
    vol: 0.132,
    path: [
      { date: '2024-12-31', return: -0.02 },
      { date: '2025-12-31', return: 0.19 },
      { date: '2026-09-04', return: 0.28 },
    ],
    dividend: { perShare: 0.1, months: [5, 11], day: 2 },
  },
  {
    symbol: 'AAPL',
    name: 'APPLE INC',
    conid: 71004203,
    currency: 'USD',
    country: 'US',
    exchange: 'NASDAQ',
    isin: 'US0378331005',
    industry: 'Technology',
    category: 'Computers',
    price: 232.5,
    vol: 0.144,
    path: [
      { date: '2024-12-31', return: 0.06 },
      { date: '2025-12-31', return: 0.18 },
      { date: '2026-09-04', return: 0.31 },
    ],
    dividend: { perShare: 0.25, months: [2, 5, 8, 11], day: 9 },
  },
  {
    symbol: 'RIO',
    name: 'RIO TINTO PLC',
    conid: 71004204,
    currency: 'GBP',
    country: 'GB',
    exchange: 'LSE',
    isin: 'GB0007188757',
    industry: 'Basic Materials',
    category: 'Mining',
    price: 48.6,
    vol: 0.138,
    path: [
      { date: '2024-12-31', return: 0.03 },
      { date: '2025-12-31', return: 0.05 },
      { date: '2026-09-04', return: 0.11 },
    ],
    dividend: { perShare: 1.75, months: [3, 9], day: 6 },
  },
  {
    symbol: 'NESN',
    name: 'NESTLE SA',
    conid: 71004205,
    currency: 'CHF',
    country: 'CH',
    exchange: 'EBS',
    isin: 'CH0038863350',
    industry: 'Consumer, Non-cyclical',
    category: 'Food',
    price: 84.2,
    vol: 0.09,
    path: [
      { date: '2024-12-31', return: 0.01 },
      { date: '2025-12-31', return: 0.02 },
      { date: '2026-09-04', return: -0.04 },
    ],
    dividend: { perShare: 3.05, months: [4], day: 20 },
  },
  {
    symbol: 'XOM',
    name: 'EXXON MOBIL CORP',
    conid: 71004206,
    currency: 'USD',
    country: 'US',
    exchange: 'NYSE',
    isin: 'US30231G1022',
    industry: 'Energy',
    category: 'Oil&Gas',
    price: 118.4,
    vol: 0.132,
    path: [
      { date: '2024-12-31', return: -0.04 },
      { date: '2025-12-31', return: -0.1 },
      { date: '2026-09-04', return: -0.18 },
    ],
    // The 27th puts the August ex-date just before the year-to-date cut-off and its pay date
    // after, so the 2026 export carries an open accrual (see BCE for the 2025 one).
    dividend: { perShare: 0.99, months: [2, 5, 8, 11], day: 27 },
  },
  {
    symbol: 'BCE',
    name: 'BCE INC',
    conid: 71004207,
    currency: 'CAD',
    country: 'CA',
    exchange: 'TSE',
    isin: 'CA05534B7604',
    industry: 'Communications',
    category: 'Telecommunications',
    price: 45.3,
    vol: 0.114,
    path: [
      { date: '2024-12-31', return: 0.04 },
      { date: '2025-12-31', return: 0.06 },
      { date: '2026-09-04', return: 0.09 },
    ],
    // Likewise across the year end, so the 2025 export has an accrual for DDR-0010's
    // upcoming-income panel to show.
    dividend: { perShare: 0.99, months: [3, 6, 9, 12], day: 24 },
  },
  {
    symbol: '7203',
    name: 'TOYOTA MOTOR CORP',
    conid: 71004208,
    currency: 'JPY',
    country: 'JP',
    exchange: 'TSEJ',
    isin: 'JP3633400001',
    industry: 'Consumer, Cyclical',
    category: 'Auto Manufacturers',
    price: 2604,
    vol: 0.12,
    path: [
      { date: '2024-12-31', return: 0.02 },
      { date: '2025-12-31', return: 0.14 },
      { date: '2026-09-04', return: 0.23 },
    ],
    dividend: { perShare: 40, months: [3, 9], day: 27 },
  },
  {
    symbol: 'SU',
    name: 'SCHNEIDER ELECTRIC SE',
    conid: 71004209,
    currency: 'EUR',
    country: 'FR',
    exchange: 'SBF',
    isin: 'FR0000121972',
    industry: 'Industrial',
    category: 'Electrical Components',
    price: 231.4,
    vol: 0.126,
    path: [
      { date: '2024-12-31', return: 0.03 },
      { date: '2025-12-31', return: 0.12 },
      { date: '2026-09-04', return: 0.26 },
    ],
    dividend: { perShare: 3.5, months: [5], day: 6 },
  },
  {
    symbol: 'NVDA',
    name: 'NVIDIA CORP',
    conid: 71004210,
    currency: 'USD',
    country: 'US',
    exchange: 'NASDAQ',
    isin: 'US67066G1040',
    industry: 'Technology',
    category: 'Semiconductors',
    price: 121.4,
    vol: 0.36,
    // Bought in February 2025 and sold that September: the control point on the sale date is
    // what makes the realised gain a fact rather than a hope.
    path: [
      { date: '2024-12-31', return: 0.08 },
      { date: '2025-09-04', return: 0.55 },
      { date: '2026-09-04', return: 0.6 },
    ],
    dividend: null,
  },
  {
    symbol: 'BAYN',
    name: 'BAYER AG',
    conid: 71004211,
    currency: 'EUR',
    country: 'DE',
    exchange: 'IBIS',
    isin: 'DE000BAY0017',
    industry: 'Consumer, Non-cyclical',
    category: 'Pharmaceuticals',
    price: 27.1,
    vol: 0.26,
    // The other side of the story: bought late in 2025, sold in 2026 at a loss.
    path: [
      { date: '2024-12-31', return: -0.01 },
      { date: '2025-11-12', return: 0.03 },
      { date: '2026-04-21', return: -0.16 },
      { date: '2026-09-04', return: -0.14 },
    ],
    dividend: { perShare: 0.11, months: [5], day: 22 },
  },
]

/**
 * External contributions, in base currency. The demo's owner funds the account over time rather
 * than in one lump, so the value curve has visible steps that the time-weighted return curve
 * deliberately ignores — which is the point of having both charts.
 */
export const DEPOSITS = [
  // The opening balance, dated the day BEFORE the first statement, so the account is already
  // funded when the imported history begins. It is therefore not a transaction in any statement
  // -- it is the first statement's `startingValue`, which is what IBKR reports for an account
  // that existed before the export's period. An account that opens at zero leaves the app's
  // "value change %" with no denominator, and the tile reads as an em dash.
  { date: '2024-09-30', amount: 68000 },
  // Top-ups afterwards. Deliberately a small fraction of the opening balance: the headline
  // value change is measured against that opening, so an account funded mostly by later
  // contributions reports a percentage that is mathematically true and reads as nonsense.
  { date: '2025-05-14', amount: 5000 },
  { date: '2025-10-02', amount: 5000 },
  { date: '2025-11-10', amount: 5000 },
  { date: '2026-02-11', amount: 9500 },
]

/**
 * The trade schedule. Positive quantity buys, negative sells; sells are matched FIFO by the
 * simulation, which is what produces the realized P&L the Trades and Performance views show.
 *
 * Two positions are closed entirely — NVDA at a gain in 2025, BAYN at a loss in 2026 — so the
 * realized-gains report has both ends to list, and one partial sale (RIO) is held long enough
 * to realise as a long-term gain. Everything else is still held at the end, which is what fills
 * the Portfolio, Allocation and map views.
 *
 * Quantities are sized to the invented opening prices so each position opens at roughly the
 * same euro amount. This is not a model portfolio and not advice.
 */
export const TRADES = [
  { date: '2024-10-02', symbol: 'ASML', quantity: 13 },
  { date: '2024-10-02', symbol: 'SAN', quantity: 2450 },
  { date: '2024-10-03', symbol: 'AAPL', quantity: 40 },
  { date: '2024-10-04', symbol: 'RIO', quantity: 200 },
  { date: '2025-02-20', symbol: 'NVDA', quantity: 40 },
  { date: '2025-05-16', symbol: 'NESN', quantity: 60 },
  { date: '2025-05-16', symbol: 'XOM', quantity: 60 },
  { date: '2025-09-04', symbol: 'NVDA', quantity: -40 },
  { date: '2025-10-06', symbol: 'BCE', quantity: 250 },
  { date: '2025-10-07', symbol: '7203', quantity: 400 },
  { date: '2025-11-12', symbol: 'BAYN', quantity: 250 },
  { date: '2025-12-04', symbol: 'NESN', quantity: 30 },
  { date: '2026-02-12', symbol: 'SU', quantity: 30 },
  { date: '2026-03-05', symbol: 'ASML', quantity: 4 },
  { date: '2026-04-21', symbol: 'BAYN', quantity: -250 },
  { date: '2026-05-13', symbol: 'RIO', quantity: -30 },
  { date: '2026-06-16', symbol: 'AAPL', quantity: 15 },
  { date: '2026-07-08', symbol: 'XOM', quantity: 40 },
]

/** IBKR's per-trade commission, in the trade's currency — a flat fee is close enough. */
export const COMMISSION = { EUR: 1.25, USD: 1.0, GBP: 1.7, CHF: 1.6, CAD: 1.0, JPY: 140 }

/** Financial transaction taxes, applied to buys in the issuer's country. Real rates. */
export const TRANSACTION_TAX_COUNTRIES = { ES: 0.002, FR: 0.003 }
