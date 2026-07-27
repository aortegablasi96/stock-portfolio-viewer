import { IbkrNotConnectedError, IbkrTimeoutError } from '@shared/errors'

/**
 * A tiny freshness-bounded memo for reads against the Interactive Brokers Client Portal
 * Gateway (Story #106, DDR-0024).
 *
 * It exists because assembling one overview used to cost far more round trips than the data
 * needs: `getHoldings()` and `getBalances()` each re-checked auth and re-resolved the account
 * id, and every display-currency switch re-fetched positions and the ledger that had not
 * changed. Two things fix that, and this module is both:
 *
 * - **In-flight de-duplication.** Concurrent callers share one promise, so the `Promise.all`
 *   in `portfolioService.getOverview` makes one auth check and one account-id resolution
 *   rather than two of each.
 * - **A short, explicit freshness window.** A settled read stays reusable for `ttlMs`, so a
 *   currency switch (or the on-open snapshot capture racing the dashboard's own load) reuses
 *   what was just fetched instead of asking again.
 *
 * It deliberately caches *only* what the repository reads from the gateway. It is not a
 * general-purpose cache and knows nothing about domain models — the repository still maps
 * every cached DTO into fresh domain objects, so no caller can mutate another's data.
 *
 * This module touches no data source, so it is unit-tested directly like the other pure
 * repository helpers (`fifoSummary`, `flexStatementParser`).
 */

/**
 * Freshness window for the gateway *session*: the auth check and the resolved account id.
 * Long, because neither changes during normal use and a stale answer is self-correcting — a
 * session that expires makes the next data request return 401/403, which the transport maps to
 * `IbkrNotConnectedError` and which drops every entry here (see `read`).
 */
export const SESSION_TTL_MS = 5 * 60_000

/**
 * Freshness window for live figures: positions, the ledger, and FX rates. Short, because
 * these move with the market. 30s is long enough to cover a display-currency switch and the
 * on-open capture/load pair, and short enough that any deliberate revisit re-reads the
 * gateway. The dashboard does not poll, so displayed data is already at least this old
 * between interactions.
 */
export const LIVE_TTL_MS = 30_000

interface Entry {
  /** The shared read — in flight or settled — so concurrent callers make one request. */
  readonly value: Promise<unknown>
  /** Epoch-ms at which the entry stops being fresh; `Infinity` while still in flight. */
  expiresAt: number
}

export interface GatewayCache {
  /**
   * The value for `key`, reusing a fresh or in-flight read and otherwise calling `load`.
   * A failed read is never cached, and a failure that means the session itself is suspect
   * drops every entry.
   */
  read<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T>
  /** Drop every entry, so the next read goes to the gateway. */
  invalidate(): void
}

/**
 * Create an isolated cache. `now` is injectable so the freshness window is testable. The
 * default calls `Date.now()` rather than capturing the reference, so it stays late-bound and
 * a test's fake clock is honoured.
 */
export function createGatewayCache(now: () => number = () => Date.now()): GatewayCache {
  const entries = new Map<string, Entry>()

  return {
    read<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
      const hit = entries.get(key)
      if (hit && hit.expiresAt > now()) return hit.value as Promise<T>

      // `Promise.resolve().then(load)` rather than `load()` so a *synchronous* throw becomes
      // a rejection this function can still account for, instead of escaping past the
      // bookkeeping below and leaving a permanently pending entry behind.
      const value = Promise.resolve().then(load)
      const entry: Entry = { value, expiresAt: Infinity }
      entries.set(key, entry)

      return value.then(
        (result) => {
          // The window is measured from when the data *arrived*, not when the request went
          // out, so a slow response isn't already half-stale by the time it lands. The
          // identity check keeps a late settle from resurrecting an entry that has since
          // been invalidated and replaced.
          if (entries.get(key) === entry) entry.expiresAt = now() + ttlMs
          return result
        },
        (err: unknown) => {
          // Never cache a failure: the next caller must be free to try again.
          if (entries.get(key) === entry) entries.delete(key)
          // A gateway that isn't running, or that accepted the request and then went quiet,
          // makes the *whole* memoized session suspect — a cached "authenticated: true" is
          // precisely what is most likely to be wrong (DDR-0022). Drop everything so
          // reconnecting works without restarting the app.
          if (err instanceof IbkrNotConnectedError || err instanceof IbkrTimeoutError) {
            entries.clear()
          }
          throw err
        },
      )
    },

    invalidate(): void {
      entries.clear()
    },
  }
}

/**
 * The cache shared by every gateway read in the portfolio repository. A module singleton
 * because the gateway is a single local session (DDR-0009) — one process, one owner, one
 * account — so there is nothing to scope it to.
 */
export const gatewayCache = createGatewayCache()
