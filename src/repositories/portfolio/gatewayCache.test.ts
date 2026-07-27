import { describe, expect, it, vi } from 'vitest'
import { createGatewayCache } from './gatewayCache'
import { IbkrGatewayError, IbkrNotConnectedError, IbkrTimeoutError } from '@shared/errors'

/** A cache over a controllable clock, so freshness is asserted without real waiting. */
function cacheAt(start = 1_000): { cache: ReturnType<typeof createGatewayCache>; tick: (ms: number) => void } {
  let clock = start
  return {
    cache: createGatewayCache(() => clock),
    tick: (ms: number) => {
      clock += ms
    },
  }
}

/** A promise plus the trigger that settles it, for asserting in-flight behaviour. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('gatewayCache.read', () => {
  it('reuses a settled value inside its freshness window and re-reads after it', async () => {
    const { cache, tick } = cacheAt()
    const load = vi.fn().mockResolvedValue('U1')

    expect(await cache.read('accountId', 1_000, load)).toBe('U1')
    tick(999)
    expect(await cache.read('accountId', 1_000, load)).toBe('U1')
    expect(load).toHaveBeenCalledTimes(1)

    tick(2)
    expect(await cache.read('accountId', 1_000, load)).toBe('U1')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('measures the window from when the value arrived, not when the request went out', async () => {
    // A slow response must not land already half-stale.
    const { cache, tick } = cacheAt()
    const pending = deferred<string>()
    const load = vi.fn().mockReturnValue(pending.promise)

    const inFlight = cache.read('positions', 1_000, load)
    tick(900) // the request itself took 900ms
    pending.resolve('data')
    await inFlight

    tick(900) // 900ms since it *arrived* — still fresh, though 1800ms since it was requested
    expect(await cache.read('positions', 1_000, load)).toBe('data')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('de-duplicates concurrent readers into one request', async () => {
    // This is what collapses the overview's parallel getHoldings/getBalances into one
    // auth check and one account-id resolution (Story #106).
    const { cache } = cacheAt()
    const pending = deferred<string>()
    const load = vi.fn().mockReturnValue(pending.promise)

    const both = Promise.all([
      cache.read('auth', 1_000, load),
      cache.read('auth', 1_000, load),
    ])
    pending.resolve('ok')

    expect(await both).toEqual(['ok', 'ok'])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('never caches a failure, so the next caller may try again', async () => {
    const { cache } = cacheAt()
    const load = vi
      .fn()
      .mockRejectedValueOnce(new IbkrGatewayError('unsupported'))
      .mockResolvedValue(0.87)

    await expect(cache.read('fx:USD>EUR', 60_000, load)).rejects.toBeInstanceOf(IbkrGatewayError)
    expect(await cache.read('fx:USD>EUR', 60_000, load)).toBe(0.87)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('turns a synchronous throw into a rejection rather than a stuck entry', async () => {
    const { cache } = cacheAt()
    const load = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new IbkrGatewayError('boom')
      })
      .mockResolvedValue('recovered')

    await expect(cache.read('ledger', 1_000, load)).rejects.toBeInstanceOf(IbkrGatewayError)
    expect(await cache.read('ledger', 1_000, load)).toBe('recovered')
  })

  it.each([
    ['not-connected', () => new IbkrNotConnectedError('gateway down')],
    ['timed-out', () => new IbkrTimeoutError('no response within 15s')],
  ])('drops every entry when a read fails %s, so reconnecting re-checks the session', async (_label, makeError) => {
    // A cached "authenticated: true" is precisely what is most likely to be wrong when the
    // gateway stops answering, so the whole memoized session goes (DDR-0022).
    const { cache } = cacheAt()
    const auth = vi.fn().mockResolvedValue(undefined)
    await cache.read('auth', 60_000, auth)

    await expect(
      cache.read('positions', 60_000, () => Promise.reject(makeError())),
    ).rejects.toBeInstanceOf(Error)

    await cache.read('auth', 60_000, auth)
    expect(auth).toHaveBeenCalledTimes(2)
  })

  it('does not let a late failure evict the entry that replaced it', async () => {
    const { cache } = cacheAt()
    const slow = deferred<string>()
    const stale = cache.read('positions', 60_000, () => slow.promise)

    cache.invalidate()
    const fresh = vi.fn().mockResolvedValue('fresh')
    expect(await cache.read('positions', 60_000, fresh)).toBe('fresh')

    slow.reject(new IbkrGatewayError('too late'))
    await expect(stale).rejects.toBeInstanceOf(IbkrGatewayError)

    expect(await cache.read('positions', 60_000, fresh)).toBe('fresh')
    expect(fresh).toHaveBeenCalledTimes(1)
  })

  it('keeps entries under different keys independent', async () => {
    const { cache } = cacheAt()
    const positions = vi.fn().mockResolvedValue(['p'])
    const ledger = vi.fn().mockResolvedValue({ BASE: {} })

    expect(await cache.read('positions', 1_000, positions)).toEqual(['p'])
    expect(await cache.read('ledger', 1_000, ledger)).toEqual({ BASE: {} })
    expect(positions).toHaveBeenCalledTimes(1)
    expect(ledger).toHaveBeenCalledTimes(1)
  })

  it('invalidate() forces the next read back to the source', async () => {
    const { cache } = cacheAt()
    const load = vi.fn().mockResolvedValue('U1')

    await cache.read('accountId', 60_000, load)
    cache.invalidate()
    await cache.read('accountId', 60_000, load)

    expect(load).toHaveBeenCalledTimes(2)
  })
})
