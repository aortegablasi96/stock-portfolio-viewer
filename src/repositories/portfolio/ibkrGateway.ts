import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { z } from 'zod'
import { IbkrGatewayError, IbkrNotConnectedError } from '@shared/errors'

/**
 * Low-level client for the Interactive Brokers **Client Portal Gateway** local REST
 * API (ADR-0004). This is the single place that knows the IBKR wire format and speaks
 * HTTP; it validates every response with Zod at ingress (external data is untrusted,
 * mirroring the IPC boundary in ADR-0002) and returns typed raw DTOs.
 *
 * It never contains business logic — mapping to domain models is the repository's job,
 * and allocation/assembly is the service's. Read-only endpoints only; no order/trade
 * calls are ever made (analytics-first, no-trading stance).
 */

const DEFAULT_BASE_URL = 'https://localhost:5000'
const API_PREFIX = '/v1/api'

/** Gateway base URL from config, trailing slashes trimmed. Defaults to the local gateway. */
function baseUrl(): string {
  return (process.env['IBKR_GATEWAY_URL'] ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
}

// ---- raw IBKR response schemas ---------------------------------------------

const authStatusSchema = z
  .object({
    authenticated: z.boolean().optional(),
    connected: z.boolean().optional(),
  })
  .passthrough()

const accountSchema = z
  .object({
    id: z.string().optional(),
    accountId: z.string().optional(),
  })
  .passthrough()
const accountsSchema = z.array(accountSchema)

const rawPositionSchema = z
  .object({
    conid: z.number(),
    contractDesc: z.string().optional(),
    ticker: z.string().optional(),
    position: z.number().optional(),
    mktPrice: z.number().optional(),
    mktValue: z.number().optional(),
    avgCost: z.number().optional(),
    currency: z.string().optional(),
  })
  .passthrough()
const rawPositionsSchema = z.array(rawPositionSchema)
export type RawPosition = z.infer<typeof rawPositionSchema>

const ledgerEntrySchema = z
  .object({
    cashbalance: z.number().optional(),
    netliquidationvalue: z.number().optional(),
    currency: z.string().optional(),
  })
  .passthrough()
const ledgerSchema = z.record(z.string(), ledgerEntrySchema)
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>

// ---- transport --------------------------------------------------------------

/** GET a raw response body, mapping connection/HTTP failures to typed errors. */
function rawGet(url: URL): Promise<string> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:'
    // The Client Portal Gateway returns 403 "Access Denied" to requests without a
    // User-Agent header (node:https sends none by default), so set one explicitly.
    const headers = { Accept: 'application/json', 'User-Agent': 'stock-portfolio-viewer' }

    const onResponse = (res: IncomingMessage): void => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        const status = res.statusCode ?? 0
        const body = Buffer.concat(chunks).toString('utf8')
        if (status === 401 || status === 403) {
          reject(
            new IbkrNotConnectedError(
              'Interactive Brokers session is not authenticated. Log in to the Client Portal Gateway.',
            ),
          )
          return
        }
        if (status < 200 || status >= 300) {
          reject(new IbkrGatewayError(`IBKR gateway returned HTTP ${status} for ${url.pathname}`))
          return
        }
        resolve(body)
      })
    }

    // The local Client Portal Gateway serves a self-signed certificate on localhost.
    // `rejectUnauthorized: false` is scoped to this single request/agent only — never a
    // process-global TLS override (ADR-0004).
    const req = isHttps
      ? httpsRequest(url, { method: 'GET', headers, rejectUnauthorized: false }, onResponse)
      : httpRequest(url, { method: 'GET', headers }, onResponse)

    req.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
        reject(
          new IbkrNotConnectedError(
            'Cannot reach the Interactive Brokers Client Portal Gateway. Is it running?',
          ),
        )
        return
      }
      reject(new IbkrGatewayError(err.message))
    })
    req.end()
  })
}

/** GET a JSON endpoint and validate it against `schema`. */
async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const url = new URL(baseUrl() + API_PREFIX + path)
  const body = await rawGet(url)

  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    throw new IbkrGatewayError(`Invalid JSON from the IBKR gateway at ${path}`)
  }

  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    throw new IbkrGatewayError(`Unexpected IBKR gateway response at ${path}: ${parsed.error.message}`)
  }
  return parsed.data
}

// ---- public surface ---------------------------------------------------------

async function getAuthStatus(): Promise<z.infer<typeof authStatusSchema>> {
  return getJson('/iserver/auth/status', authStatusSchema)
}

/** Throw `IbkrNotConnectedError` unless the gateway reports an authenticated session. */
async function ensureAuthenticated(): Promise<void> {
  const status = await getAuthStatus()
  if (!status.authenticated) {
    throw new IbkrNotConnectedError(
      'Interactive Brokers session is not authenticated. Log in to the Client Portal Gateway.',
    )
  }
}

/** The account to read: the configured `IBKR_ACCOUNT_ID`, else the first account the gateway lists. */
async function getAccountId(): Promise<string> {
  const configured = process.env['IBKR_ACCOUNT_ID']?.trim()
  if (configured) return configured

  const accounts = await getJson('/portfolio/accounts', accountsSchema)
  const first = accounts[0]
  const id = first?.accountId ?? first?.id
  if (!id) {
    throw new IbkrGatewayError('The IBKR gateway returned no accounts.')
  }
  return id
}

/** Positions for an account. M1 reads the first page (a personal portfolio fits one page). */
async function getPositions(accountId: string): Promise<RawPosition[]> {
  return getJson(`/portfolio/${encodeURIComponent(accountId)}/positions/0`, rawPositionsSchema)
}

/** Cash/value ledger for an account, keyed by currency (`BASE` aggregates in base currency). */
async function getLedger(accountId: string): Promise<Record<string, LedgerEntry>> {
  return getJson(`/portfolio/${encodeURIComponent(accountId)}/ledger`, ledgerSchema)
}

export const ibkrGateway = {
  getAuthStatus,
  ensureAuthenticated,
  getAccountId,
  getPositions,
  getLedger,
}
