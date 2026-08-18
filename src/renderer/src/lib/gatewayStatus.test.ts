import { describe, expect, it } from 'vitest'
import {
  describeGateway,
  isStale,
  GATEWAY_LABEL,
  GATEWAY_READING_TTL_MS,
  type GatewayStatus,
} from './gatewayStatus'

const NOW = Date.UTC(2026, 7, 18, 14, 32, 0)
const ago = (ms: number): number => NOW - ms

/** Every outcome the badge can be asked to describe, with the age that reaches its wording. */
const OUTCOMES: { status: GatewayStatus; age: number }[] = [
  { status: 'live', age: 0 },
  { status: 'live', age: GATEWAY_READING_TTL_MS },
  { status: 'not_connected', age: 0 },
  { status: 'not_responding', age: 0 },
  { status: 'error', age: 0 },
]

describe('a reading the app has not taken yet', () => {
  it('says so rather than guessing', () => {
    const badge = describeGateway(null, NOW)
    expect(badge.detail).toBe('Not checked yet')
    expect(badge.tone).toBe('idle')
    expect(badge.stale).toBe(false)
  })
})

describe('a live gateway', () => {
  it('reports live, with when it was checked', () => {
    const badge = describeGateway({ status: 'live', at: ago(60_000) }, NOW)
    expect(badge.tone).toBe('live')
    expect(badge.detail).toMatch(/^Live · /)
    expect(badge.stale).toBe(false)
  })

  it('is still live one millisecond inside the window', () => {
    const badge = describeGateway({ status: 'live', at: ago(GATEWAY_READING_TTL_MS - 1) }, NOW)
    expect(badge.detail).toMatch(/^Live · /)
    expect(badge.stale).toBe(false)
  })

  it('stops claiming to be live the moment the reading ages out', () => {
    // The story's sharpest criterion: never "live" on stale information. The reading is not
    // deleted — it is demoted to what it honestly is, an observation with a time on it.
    const badge = describeGateway({ status: 'live', at: ago(GATEWAY_READING_TTL_MS) }, NOW)
    expect(badge.stale).toBe(true)
    expect(badge.tone).toBe('idle')
    expect(badge.detail).toMatch(/^Last seen /)
    expect(badge.detail).not.toMatch(/Live/)
  })

  it('keeps saying when, however old the reading gets', () => {
    const badge = describeGateway({ status: 'live', at: ago(6 * 60 * 60_000) }, NOW)
    expect(badge.detail).toMatch(/^Last seen /)
  })
})

describe('the three unhappy outcomes stay three', () => {
  it('separates a gateway that is not running from one that stalled (DDR-0022)', () => {
    const notConnected = describeGateway({ status: 'not_connected', at: NOW }, NOW)
    const notResponding = describeGateway({ status: 'not_responding', at: NOW }, NOW)
    expect(notConnected.detail).toBe('Not running')
    expect(notResponding.detail).toBe('Stalled')
    // The wording is what carries it; the tone only seconds it. Merging these two would throw
    // away the one thing that says whether to start the gateway or re-authenticate it.
    expect(notConnected.detail).not.toBe(notResponding.detail)
  })

  it('reports a failed read as unavailable rather than as offline', () => {
    expect(describeGateway({ status: 'error', at: NOW }, NOW).detail).toBe('Unavailable')
  })

  it('does not age out — an old "not running" is still true', () => {
    // Only "Live" can mislead by getting old. Blanking the others would swap a true statement
    // for no statement.
    const badge = describeGateway({ status: 'not_connected', at: ago(GATEWAY_READING_TTL_MS * 4) }, NOW)
    expect(badge.detail).toBe('Not running')
    expect(badge.stale).toBe(false)
  })
})

describe('colour is never the only channel', () => {
  it('gives every outcome its own wording', () => {
    const details = OUTCOMES.map(({ status, age }) =>
      describeGateway({ status, at: ago(age) }, NOW).detail,
    )
    details.push(describeGateway(null, NOW).detail)
    expect(new Set(details).size).toBe(details.length)
  })

  it('has fewer tones than outcomes, which is why the wording has to carry it', () => {
    const tones = new Set(
      OUTCOMES.map(({ status, age }) => describeGateway({ status, at: ago(age) }, NOW).tone),
    )
    expect(tones.size).toBeLessThan(OUTCOMES.length)
  })

  it('names the same subject every time', () => {
    for (const { status, age } of OUTCOMES) {
      expect(describeGateway({ status, at: ago(age) }, NOW).label).toBe(GATEWAY_LABEL)
    }
    expect(describeGateway(null, NOW).label).toBe(GATEWAY_LABEL)
  })
})

describe('the freshness window', () => {
  it('mirrors the repository’s session TTL, five minutes', () => {
    // Restated rather than imported: the renderer may not reach @repositories, and the number is
    // load-bearing enough that a silent drift to, say, an hour should be a visible edit here.
    expect(GATEWAY_READING_TTL_MS).toBe(5 * 60_000)
  })

  it('is a boundary, not a range', () => {
    expect(isStale({ status: 'live', at: ago(GATEWAY_READING_TTL_MS - 1) }, NOW)).toBe(false)
    expect(isStale({ status: 'live', at: ago(GATEWAY_READING_TTL_MS) }, NOW)).toBe(true)
  })

  it('treats a reading from the future as fresh rather than as stale', () => {
    // A clock adjustment mid-session should not make a reading taken seconds ago unreadable.
    expect(isStale({ status: 'live', at: NOW + 60_000 }, NOW)).toBe(false)
  })
})
