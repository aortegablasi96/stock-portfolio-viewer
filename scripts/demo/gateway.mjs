/**
 * A stand-in for the IBKR Client Portal Gateway, serving the demo portfolio.
 *
 * The app's live views (Portfolio, the sidebar's gateway badge, sector classification, FX
 * conversion) read a local REST API that only exists while the real gateway is running and
 * logged in. This serves the same endpoints off `demo/gateway/state.json`, so the whole app can
 * be demonstrated with no broker session and no real account.
 *
 * It answers exactly the six endpoints `src/repositories/portfolio/ibkrGateway.ts` calls, in
 * the shapes that file's Zod schemas accept — anything else is a 404, so a request the app
 * should not be making is visible rather than silently satisfied.
 *
 *   node scripts/demo/gateway.mjs [--port 5055] [--static] [--down]
 *
 *   --static  freeze prices at the last simulated close (default: drift them slightly, so the
 *             reading moves between refreshes the way a live one does)
 *   --down    answer every request with 401, to demonstrate the not-connected state
 *
 * Point the app at it with `IBKR_GATEWAY_URL=http://localhost:5055` in `.env`, and restart —
 * the variable is read once at startup.
 */

import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const statePath = join(here, '..', '..', 'demo', 'gateway', 'state.json')

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}

const PORT = Number(option('--port', 5055))
const STATIC = flag('--static')
const DOWN = flag('--down')

let state
try {
  state = JSON.parse(readFileSync(statePath, 'utf8'))
} catch {
  console.error(`No demo state at ${statePath}. Run: npm run demo:generate`)
  process.exit(1)
}

/**
 * Move every price by a small amount that changes once per bucket.
 *
 * Bucketed rather than per-request on purpose: one Portfolio refresh makes several calls, and
 * a reading whose positions and ledger were priced a few milliseconds apart would not add up.
 * Within a bucket every request sees the same market; across buckets it has moved.
 */
const BUCKET_MS = 20_000
function drift(conid) {
  if (STATIC) return 1
  const bucket = Math.floor(Date.now() / BUCKET_MS)
  // A cheap deterministic hash of (conid, bucket) → a factor within ±0.6%.
  let h = Math.imul(conid ^ bucket, 2654435761) >>> 0
  h ^= h >>> 13
  return 1 + ((h % 1201) / 1000 - 0.6) / 100
}

/** The current reading: positions at drifted prices, and a ledger derived from them. */
function reading() {
  const positions = state.positions.map((p) => {
    const price = round(p.mktPrice * drift(p.conid), 4)
    const value = round(p.position * price, 2)
    return {
      conid: p.conid,
      contractDesc: p.contractDesc,
      position: p.position,
      mktPrice: price,
      mktValue: value,
      avgCost: p.avgCost,
      unrealizedPnl: round(value - p.position * p.avgCost, 2),
      currency: p.currency,
      assetClass: 'STK',
    }
  })

  const stockByCurrency = new Map()
  for (const p of positions) {
    stockByCurrency.set(p.currency, (stockByCurrency.get(p.currency) ?? 0) + p.mktValue)
  }

  const ledger = {}
  let stockBase = 0
  let cashBase = 0
  for (const [code, entry] of Object.entries(state.ledger)) {
    if (code === 'BASE') continue
    const stock = round(stockByCurrency.get(code) ?? 0, 2)
    ledger[code] = {
      ...entry,
      stockmarketvalue: stock,
      netliquidationvalue: round(entry.cashbalance + stock, 2),
    }
    stockBase += stock * entry.exchangerate
    cashBase += entry.cashbalance * entry.exchangerate
  }
  ledger.BASE = {
    ...state.ledger.BASE,
    cashbalance: round(cashBase, 2),
    stockmarketvalue: round(stockBase, 2),
    netliquidationvalue: round(cashBase + stockBase, 2),
  }

  return { positions, ledger }
}

const round = (n, dp) => Math.round(n * 10 ** dp) / 10 ** dp

const classifications = new Map(
  state.positions.map((p) => [p.conid, { industry: p.industry, category: p.category }]),
)

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const path = url.pathname.replace(/^\/v1\/api/, '')
  const send = (status, body) => {
    const payload = JSON.stringify(body)
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
    res.end(payload)
    console.log(`${status} ${req.method} ${url.pathname}${url.search}`)
  }

  if (DOWN) {
    send(401, { error: 'not authenticated' })
    return
  }

  if (path === '/iserver/auth/status') {
    send(200, { authenticated: true, connected: true, competing: false, fail: '' })
    return
  }

  if (path === '/portfolio/accounts') {
    send(200, [{ id: state.accountId, accountId: state.accountId, currency: state.baseCurrency, type: 'DEMO' }])
    return
  }

  const positionsMatch = /^\/portfolio\/([^/]+)\/positions\/(\d+)$/.exec(path)
  if (positionsMatch) {
    // Page 0 carries the whole demo portfolio; any later page is empty, as IBKR's is.
    send(200, positionsMatch[2] === '0' ? reading().positions : [])
    return
  }

  if (/^\/portfolio\/[^/]+\/ledger$/.test(path)) {
    send(200, reading().ledger)
    return
  }

  if (path === '/iserver/exchangerate') {
    const source = url.searchParams.get('source') ?? ''
    const target = url.searchParams.get('target') ?? ''
    const rate = crossRate(source, target)
    if (rate === null) {
      send(404, { error: `no demo rate for ${source}->${target}` })
      return
    }
    send(200, { rate })
    return
  }

  const contractMatch = /^\/iserver\/contract\/(\d+)\/info$/.exec(path)
  if (contractMatch) {
    const found = classifications.get(Number(contractMatch[1]))
    // An unknown conid resolves to no classification rather than an error — which is what the
    // real gateway does for ETFs and cash, and the case DDR-0009 has the app degrade on.
    send(200, { conid: Number(contractMatch[1]), industry: found?.industry ?? '', category: found?.category ?? '' })
    return
  }

  send(404, { error: `demo gateway does not serve ${url.pathname}` })
})

/** Units of `target` per unit of `source`, via the base currency both are quoted against. */
function crossRate(source, target) {
  const from = state.rates[source]
  const to = state.rates[target]
  if (from === undefined || to === undefined) return null
  return round(from / to, 8)
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Demo IBKR gateway on http://localhost:${PORT}  (${state.positions.length} positions, account ${state.accountId})`)
  console.log(`Set IBKR_GATEWAY_URL=http://localhost:${PORT} in .env and restart the app.`)
  if (DOWN) console.log('Serving 401 to every request (--down).')
  if (STATIC) console.log('Prices frozen (--static).')
})
