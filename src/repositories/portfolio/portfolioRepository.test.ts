import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { portfolioRepository } from './portfolioRepository'
import { gatewayCache, LIVE_TTL_MS } from './gatewayCache'
import { ibkrGateway, type LedgerEntry } from './ibkrGateway'
import { IbkrGatewayError, IbkrNotConnectedError, IbkrTimeoutError } from '@shared/errors'

vi.mock('./ibkrGateway', () => ({
  ibkrGateway: {
    ensureAuthenticated: vi.fn(),
    getAccountId: vi.fn(),
    getPositions: vi.fn(),
    getLedger: vi.fn(),
    getExchangeRate: vi.fn(),
  },
}))

const gw = vi.mocked(ibkrGateway)

const ledger: Record<string, LedgerEntry> = {
  BASE: { currency: 'BASE', cashbalance: 359.3, stockmarketvalue: 63483.23, exchangerate: 1 },
  EUR: { currency: 'EUR', cashbalance: 0.59, exchangerate: 1 },
}

beforeEach(() => {
  vi.clearAllMocks()
  // The repository memoizes gateway reads in a module-level cache (Story #106); every test
  // starts from a cold one so call counts mean what they say.
  gatewayCache.invalidate()
  gw.getAccountId.mockResolvedValue('U1')
  gw.getPositions.mockResolvedValue([])
  gw.getLedger.mockResolvedValue(ledger)
})

describe('portfolioRepository.getBalances', () => {
  it('reports the aggregate BASE values under the resolved ISO base currency, not "BASE"', async () => {
    // The live gateway labels the aggregate entry `currency: "BASE"`; the real base ISO is
    // the per-currency entry whose rate to base is 1 (regression from Story #28). `netliquidationvalue`
    // here is deliberately stock+cash+3.17 of dividend accrual to prove net is computed, not read.
    gw.getLedger.mockResolvedValue({
      BASE: {
        currency: 'BASE',
        cashbalance: 359.3,
        stockmarketvalue: 63483.23,
        netliquidationvalue: 63845.7,
        exchangerate: 1,
      },
      EUR: { currency: 'EUR', cashbalance: 0.59, netliquidationvalue: 17991.29, exchangerate: 1 },
      USD: { currency: 'USD', cashbalance: 146.56, netliquidationvalue: 33336.54, exchangerate: 0.8762 },
    })

    const balances = await portfolioRepository.getBalances()

    expect(balances.currency).toBe('EUR')
    // Values come from the BASE aggregate (total cash across currencies), not the EUR-only entry.
    expect(balances.totalCashValue).toBe(359.3)
    expect(balances.stockMarketValue).toBe(63483.23)
    // Net = holdings + cash (63483.23 + 359.3), NOT IBKR's netliquidationvalue (63845.7, which
    // also folds in the 3.17 dividend accrual) — Bug #68 refinement.
    expect(balances.netLiquidation).toBe(63842.53)
  })

  it('falls back to a single-currency ledger entry when there is no BASE placeholder', async () => {
    gw.getLedger.mockResolvedValue({
      USD: { currency: 'USD', cashbalance: 500, netliquidationvalue: 1500, exchangerate: 1 },
    })

    const balances = await portfolioRepository.getBalances()
    expect(balances.currency).toBe('USD')
    expect(balances.totalCashValue).toBe(500)
  })
})

describe('portfolioRepository.getHoldings', () => {
  it('excludes closed (zero-quantity) positions', async () => {
    gw.getPositions.mockResolvedValue([
      { conid: 1, ticker: 'AAA', position: 3, mktValue: 30, currency: 'USD' },
      { conid: 2, ticker: 'BBB', position: 0, mktValue: 0, currency: 'USD' },
    ])

    const holdings = await portfolioRepository.getHoldings()
    expect(holdings.map((h) => h.symbol)).toEqual(['AAA'])
  })
})

describe('portfolioRepository — gateway round trips (Story #106)', () => {
  it('assembles one overview with a single auth check and a single account-id resolution', async () => {
    // `portfolioService.getOverview` runs these two in parallel; before #106 that cost four
    // auth/account calls to fetch two pieces of data.
    await Promise.all([portfolioRepository.getHoldings(), portfolioRepository.getBalances()])

    expect(gw.ensureAuthenticated).toHaveBeenCalledTimes(1)
    expect(gw.getAccountId).toHaveBeenCalledTimes(1)
    expect(gw.getPositions).toHaveBeenCalledTimes(1)
    expect(gw.getLedger).toHaveBeenCalledTimes(1)
  })

  it('reuses holdings and balances across a display-currency switch', async () => {
    // A currency switch re-reads the overview only to re-convert it; the positions and ledger
    // it converts have not changed within the freshness window.
    await Promise.all([portfolioRepository.getHoldings(), portfolioRepository.getBalances()])
    await Promise.all([portfolioRepository.getHoldings(), portfolioRepository.getBalances()])

    expect(gw.getPositions).toHaveBeenCalledTimes(1)
    expect(gw.getLedger).toHaveBeenCalledTimes(1)
    expect(gw.ensureAuthenticated).toHaveBeenCalledTimes(1)
  })

  it('returns independent holding objects to each caller, never a shared cached array', async () => {
    gw.getPositions.mockResolvedValue([
      { conid: 1, ticker: 'AAA', position: 3, mktValue: 30, currency: 'USD' },
    ])

    const first = await portfolioRepository.getHoldings()
    first[0]!.marketValue = 999
    const second = await portfolioRepository.getHoldings()

    expect(second[0]?.marketValue).toBe(30)
  })

  describe('session invalidation', () => {
    // The session (auth + account id) outlives the live figures, so these tests step past the
    // *live* window only: the ledger is re-read while the memoized session is still fresh.
    // That is the setup in which a failure must be able to drop the session too.
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('holds the session across live re-reads while nothing has gone wrong', async () => {
      await portfolioRepository.getBalances()
      vi.advanceTimersByTime(LIVE_TTL_MS + 1)
      await portfolioRepository.getBalances()

      expect(gw.getLedger).toHaveBeenCalledTimes(2)
      expect(gw.ensureAuthenticated).toHaveBeenCalledTimes(1)
      expect(gw.getAccountId).toHaveBeenCalledTimes(1)
    })

    it('re-checks the session after a not-connected error, so reconnecting needs no restart', async () => {
      // The cached "authenticated" answer is exactly what a disconnect invalidates (AC:
      // cached auth/account state is dropped on a not-connected error).
      await portfolioRepository.getBalances()
      vi.advanceTimersByTime(LIVE_TTL_MS + 1)

      gw.getLedger.mockRejectedValueOnce(new IbkrNotConnectedError('gateway down'))
      await expect(portfolioRepository.getBalances()).rejects.toBeInstanceOf(IbkrNotConnectedError)
      await portfolioRepository.getBalances()

      expect(gw.ensureAuthenticated).toHaveBeenCalledTimes(2)
      expect(gw.getAccountId).toHaveBeenCalledTimes(2)
    })

    it('re-checks the session after a stalled gateway, whose session is the likely cause', async () => {
      await portfolioRepository.getBalances()
      vi.advanceTimersByTime(LIVE_TTL_MS + 1)

      gw.getLedger.mockRejectedValueOnce(new IbkrTimeoutError('no response within 15s'))
      await expect(portfolioRepository.getBalances()).rejects.toBeInstanceOf(IbkrTimeoutError)
      await portfolioRepository.getBalances()

      expect(gw.ensureAuthenticated).toHaveBeenCalledTimes(2)
    })
  })
})

describe('portfolioRepository.getExchangeRates', () => {
  it('omits a bogus non-positive rate so it cannot zero a converted value', async () => {
    // e.g. the gateway returns 0 for an unsupported pair — treat it as unavailable.
    gw.getExchangeRate.mockImplementation(async (source: string) => (source === 'CAD' ? 0.62 : 0))

    const rates = await portfolioRepository.getExchangeRates(['CAD', 'ZZZ'], 'EUR')

    expect(rates).toEqual({ EUR: 1, CAD: 0.62 })
    expect(rates.ZZZ).toBeUndefined()
  })

  it('omits a pair whose rate lookup fails, but propagates a not-connected error', async () => {
    gw.getExchangeRate.mockRejectedValueOnce(new IbkrGatewayError('unsupported'))
    const rates = await portfolioRepository.getExchangeRates(['GBP'], 'EUR')
    expect(rates).toEqual({ EUR: 1 })

    gw.getExchangeRate.mockRejectedValueOnce(new IbkrNotConnectedError('gateway down'))
    await expect(portfolioRepository.getExchangeRates(['GBP'], 'EUR')).rejects.toBeInstanceOf(
      IbkrNotConnectedError,
    )
  })

  it('treats a timed-out rate as unavailable rather than zeroing the position (Story #104)', async () => {
    // DDR-0007: no rate means the position renders unconverted (displayValue === null), never
    // multiplied by a made-up number. A stall must land in that same bucket, not throw.
    gw.getExchangeRate.mockRejectedValueOnce(new IbkrTimeoutError('no response within 15s'))

    const rates = await portfolioRepository.getExchangeRates(['GBP'], 'EUR')

    expect(rates).toEqual({ EUR: 1 })
  })

  it('issues every pair concurrently, so a stall costs one timeout and not one per currency', async () => {
    // Story #106 replaces #104's sequential `break` with concurrency. The guarantee DDR-0022
    // cares about ("never wait timeout × currencies") is now met by every request already
    // being in flight — and the pairs that *did* answer keep their rates rather than being
    // skipped because an earlier one stalled.
    let inFlight = 0
    let peak = 0
    gw.getExchangeRate.mockImplementation(async (source: string) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await Promise.resolve()
      inFlight -= 1
      if (source === 'GBP') throw new IbkrTimeoutError('no response within 15s')
      return source === 'USD' ? 0.87 : 1.04
    })

    const rates = await portfolioRepository.getExchangeRates(['USD', 'GBP', 'CHF'], 'EUR')

    expect(gw.getExchangeRate).toHaveBeenCalledTimes(3)
    expect(peak).toBe(3)
    // CHF answered even though GBP stalled first; GBP is omitted, so it renders unconverted.
    expect(rates).toEqual({ EUR: 1, USD: 0.87, CHF: 1.04 })
  })

  it('reuses a rate when the owner switches back to a currency just converted to', async () => {
    gw.getExchangeRate.mockResolvedValue(0.87)

    await portfolioRepository.getExchangeRates(['USD'], 'EUR')
    await portfolioRepository.getExchangeRates(['USD'], 'EUR')

    expect(gw.getExchangeRate).toHaveBeenCalledTimes(1)
  })

  it('keeps rates for different targets apart', async () => {
    gw.getExchangeRate.mockImplementation(async (_source: string, target: string) =>
      target === 'EUR' ? 0.87 : 1.14,
    )

    expect(await portfolioRepository.getExchangeRates(['USD'], 'EUR')).toEqual({ EUR: 1, USD: 0.87 })
    expect(await portfolioRepository.getExchangeRates(['EUR'], 'USD')).toEqual({ USD: 1, EUR: 1.14 })
  })
})
