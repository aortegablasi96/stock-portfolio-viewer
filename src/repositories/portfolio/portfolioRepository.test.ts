import { beforeEach, describe, expect, it, vi } from 'vitest'
import { portfolioRepository } from './portfolioRepository'
import { ibkrGateway, type LedgerEntry } from './ibkrGateway'
import { IbkrGatewayError, IbkrNotConnectedError, IbkrTimeoutError } from '@shared/errors'

vi.mock('./ibkrGateway', () => ({
  ibkrGateway: {
    ensureAuthenticated: vi.fn(),
    getAccountId: vi.fn(),
    getLedger: vi.fn(),
    getExchangeRate: vi.fn(),
  },
}))

const gw = vi.mocked(ibkrGateway)

beforeEach(() => {
  vi.clearAllMocks()
  gw.getAccountId.mockResolvedValue('U1')
})

describe('portfolioRepository.getBalances', () => {
  it('reports the aggregate BASE values under the resolved ISO base currency, not "BASE"', async () => {
    // The live gateway labels the aggregate entry `currency: "BASE"`; the real base ISO is
    // the per-currency entry whose rate to base is 1 (regression from Story #28). `netliquidationvalue`
    // here is deliberately stock+cash+3.17 of dividend accrual to prove net is computed, not read.
    const ledger: Record<string, LedgerEntry> = {
      BASE: {
        currency: 'BASE',
        cashbalance: 359.3,
        stockmarketvalue: 63483.23,
        netliquidationvalue: 63845.7,
        exchangerate: 1,
      },
      EUR: { currency: 'EUR', cashbalance: 0.59, netliquidationvalue: 17991.29, exchangerate: 1 },
      USD: { currency: 'USD', cashbalance: 146.56, netliquidationvalue: 33336.54, exchangerate: 0.8762 },
    }
    gw.getLedger.mockResolvedValue(ledger)

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

  it('stops asking after a timeout instead of waiting once per currency', async () => {
    // A stalled gateway times out on every remaining pair, so continuing would make the view
    // wait `timeout × currencies`. The rates gathered before the stall are kept.
    gw.getExchangeRate.mockImplementation(async (source: string) => {
      if (source === 'USD') return 0.87
      throw new IbkrTimeoutError('no response within 15s')
    })

    const rates = await portfolioRepository.getExchangeRates(['USD', 'GBP', 'CHF'], 'EUR')

    expect(rates).toEqual({ EUR: 1, USD: 0.87 })
    // GBP stalled; CHF was never attempted.
    expect(gw.getExchangeRate).toHaveBeenCalledTimes(2)
  })
})
