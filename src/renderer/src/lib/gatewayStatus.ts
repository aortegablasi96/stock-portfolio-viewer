import { formatUpdatedAt } from '@shared/format'

/**
 * What the sidebar's gateway badge says, given what the app last learned (Story #183).
 *
 * The badge reports a state the app **actually knows**, and it learns it from exactly one place:
 * the result of `portfolio:getOverview`, which the Portfolio view issues every time it mounts
 * (that tab is deliberately excluded from stay-mounted, because live IBKR data changes with no
 * event to announce it — DDR-0027). Nothing here polls. A timer against the gateway would be
 * wrong twice over: every request is one bounded attempt and never a retry loop (DDR-0022), and
 * the repository already coalesces reads behind `gatewayCache` (DDR-0024), so a background poll
 * would either be answered from a cache — telling the badge nothing new — or spend the whole
 * 15s deadline on a question nobody asked.
 *
 * The cost of deriving rather than polling is that the reading **ages**, and a badge that keeps
 * saying "Live" over an hour-old reading is worse than one that says nothing. So freshness is
 * part of the answer: past {@link GATEWAY_READING_TTL_MS} a live reading stops claiming to be
 * live and starts reporting when it was taken.
 *
 * The three gateway outcomes stay three. `not_connected` (nothing is listening) and
 * `not_responding` (something accepted the request and then went quiet) are distinct on purpose,
 * and `IbkrTimeoutError` is deliberately not a subclass of `IbkrNotConnectedError` so no
 * `instanceof` can merge them (DDR-0022). Collapsing them here would throw the distinction away
 * one layer further out — and it is the distinction that tells the owner whether to *start* the
 * gateway or to *re-authenticate* it.
 *
 * Pure, so it is testable in Vitest's Node environment where no component can be rendered. The
 * component keeps only what needs a DOM: the one timer that re-renders the label when a live
 * reading crosses into stale.
 */

/** The outcomes a live read can have, mirroring `PortfolioOverviewResult`'s variants. */
export type GatewayStatus = 'live' | 'not_connected' | 'not_responding' | 'error'

/** What the app last learned about the gateway, and when it learned it. */
export interface GatewayReading {
  readonly status: GatewayStatus
  /** Epoch ms, as every timestamp in the app is. */
  readonly at: number
}

/**
 * The dot's colour role — three tones, never the only channel.
 *
 * `warn` is the loss tone as a **fill** (`--neg`, not `--neg-text`), because a dot is a filled
 * shape and picking the text half of that split is silent (DDR-0046).
 */
export type GatewayTone = 'live' | 'idle' | 'warn'

/** Everything the badge renders. `detail` is the channel that carries the meaning; `tone` seconds it. */
export interface GatewayBadge {
  readonly tone: GatewayTone
  /** The subject, always the same — the badge names what it is reporting on. */
  readonly label: string
  /** The state, in words. Distinct per outcome, so colour is never carrying it alone. */
  readonly detail: string
  /** Whether a live reading has aged past the point where it can still be called live. */
  readonly stale: boolean
}

/**
 * How long a live reading may still be called "Live".
 *
 * Five minutes, mirroring `SESSION_TTL_MS` in `repositories/portfolio/gatewayCache.ts` — the
 * window in which the repository itself still trusts its own memory of "authenticated". Past it
 * the repository would re-ask the gateway, so past it the badge stops asserting. The value is
 * restated rather than imported: the renderer may not import `@repositories` (an ESLint-enforced
 * layer boundary), and a display threshold that happens to agree with a cache TTL is not the same
 * fact as the TTL.
 */
export const GATEWAY_READING_TTL_MS = 5 * 60_000

/** The subject line, one string so nothing can spell it two ways. */
export const GATEWAY_LABEL = 'IBKR Gateway'

/**
 * An overview result's variant, as a reading.
 *
 * The mapping is one line and still worth naming: `ok` is the *only* variant that means the
 * gateway is answering, and the other three pass through unmerged. A `status === 'ok' ? … : …`
 * written inline at the call site is one careless edit away from an `else` that collapses the
 * three (DDR-0022).
 */
export function readingFrom(
  status: 'ok' | 'not_connected' | 'not_responding' | 'error',
  at: number,
): GatewayReading {
  return { status: status === 'ok' ? 'live' : status, at }
}

/** Whether a reading is too old to be reported as the current state. */
export function isStale(reading: GatewayReading, now: number): boolean {
  return now - reading.at >= GATEWAY_READING_TTL_MS
}

/**
 * What the badge shows for a reading, as of `now`.
 *
 * `now` is a parameter rather than a `Date.now()` call for the same reason `formatUpdatedAt`
 * takes one: staleness is the interesting behaviour here, and a function that reads the clock
 * itself can only be tested by waiting.
 *
 * Only a **live** reading is downgraded by age. The three unhappy outcomes are already the
 * absence of a working gateway, so an old one cannot mislead the way an old "Live" does — and
 * blanking them would replace a true statement with no statement.
 */
export function describeGateway(reading: GatewayReading | null, now: number): GatewayBadge {
  if (reading === null) {
    return { tone: 'idle', label: GATEWAY_LABEL, detail: 'Not checked yet', stale: false }
  }

  switch (reading.status) {
    case 'live': {
      const when = formatUpdatedAt(reading.at, now)
      return isStale(reading, now)
        ? { tone: 'idle', label: GATEWAY_LABEL, detail: `Last seen ${when}`, stale: true }
        : { tone: 'live', label: GATEWAY_LABEL, detail: `Live · ${when}`, stale: false }
    }
    // Nothing is listening: the gateway isn't running, and the fix is to start it.
    case 'not_connected':
      return { tone: 'idle', label: GATEWAY_LABEL, detail: 'Not running', stale: false }
    // It answered the door and then went quiet — usually an expired session, not a dead process.
    case 'not_responding':
      return { tone: 'warn', label: GATEWAY_LABEL, detail: 'Stalled', stale: false }
    case 'error':
      return { tone: 'warn', label: GATEWAY_LABEL, detail: 'Unavailable', stale: false }
  }
}
