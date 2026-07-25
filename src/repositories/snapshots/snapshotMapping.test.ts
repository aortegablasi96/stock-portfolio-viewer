import { describe, it, expect } from 'vitest'
import type { PortfolioOverview } from '@shared/domain/portfolio'
import type { SnapshotRow, SnapshotHoldingRow } from '@db/schema'
import {
  toMinor,
  fromMinor,
  toHeaderValues,
  toHoldingValues,
  rowToSummary,
  rowToHolding,
} from './snapshotMapping'

/**
 * Pure mapping tests — the meaningful repository logic is the decimal⇄minor-units
 * conversion and row construction (DDR-0003). These run under plain Node without
 * the `better-sqlite3` native driver (which is built for Electron's ABI and can't
 * load in Vitest — see CLAUDE.md). The Drizzle wiring in `snapshotRepository` is
 * exercised end-to-end by the Playwright e2e run against the built app.
 */

function overview(overrides: Partial<PortfolioOverview> = {}): PortfolioOverview {
  return {
    holdings: [
      {
        conid: 265598,
        symbol: 'AAPL',
        description: 'APPLE INC',
        quantity: 50,
        averageCost: 150.1,
        marketPrice: 212.34,
        marketValue: 10617,
        currency: 'USD',
      },
      {
        conid: 272093,
        symbol: 'MSFT',
        description: 'MICROSOFT CORP',
        quantity: 30,
        averageCost: null,
        marketPrice: null,
        marketValue: 13446.56,
        currency: 'USD',
      },
    ],
    balances: {
      currency: 'USD',
      totalCashValue: 1234.56,
      netLiquidation: 25298.12,
      stockMarketValue: 24063.56,
    },
    allocation: [],
    totalMarketValue: 24063.56,
    ...overrides,
  }
}

describe('snapshot minor-units conversion', () => {
  it('converts decimals to integer cents and back exactly', () => {
    expect(toMinor(10617)).toBe(1_061_700)
    expect(toMinor(1234.56)).toBe(123_456)
    expect(fromMinor(123_456)).toBe(1234.56)
    expect(fromMinor(toMinor(13446.56))).toBe(13446.56)
  })

  it('rounds sub-cent inputs to the nearest cent (scale-2 assumption)', () => {
    expect(toMinor(118.505)).toBe(11_851)
    expect(toMinor(0.004)).toBe(0)
  })
})

describe('toHeaderValues', () => {
  it('derives header totals from the overview in minor units', () => {
    const values = toHeaderValues({ capturedAt: 1_000, source: 'ibkr', overview: overview() }, 9_999)
    expect(values).toEqual({
      capturedAt: 1_000,
      source: 'ibkr',
      baseCurrency: 'USD',
      totalMarketValue: 2_406_356,
      netLiquidation: 2_529_812,
      totalCash: 123_456,
      holdingsCount: 2,
      createdAt: 9_999,
    })
  })

  it('records a valid empty (cash-only) portfolio', () => {
    const values = toHeaderValues(
      {
        capturedAt: 1_000,
        source: 'ibkr',
        overview: overview({
          holdings: [],
          totalMarketValue: 0,
          balances: {
            currency: 'USD',
            totalCashValue: 1234.56,
            netLiquidation: 25298.12,
            stockMarketValue: 0,
          },
        }),
      },
      0,
    )
    expect(values.holdingsCount).toBe(0)
    expect(values.totalMarketValue).toBe(0)
    expect(values.totalCash).toBe(123_456)
  })

  it('takes the holdings total from the base-currency ledger value, not the native sum (Bug #68)', () => {
    // The native overview total is a mixed-currency sum the capture path must ignore; the
    // stored total must be the base-currency holdings value from `balances`.
    const values = toHeaderValues(
      {
        capturedAt: 1_000,
        source: 'ibkr',
        overview: overview({
          totalMarketValue: 581_226, // bogus mixed-currency sum
          balances: {
            currency: 'EUR',
            totalCashValue: 360.29,
            netLiquidation: 59_796.27,
            stockMarketValue: 59_432.82,
          },
        }),
      },
      0,
    )
    expect(values.totalMarketValue).toBe(5_943_282) // base value, not toMinor(581_226)
    expect(values.baseCurrency).toBe('EUR')
  })
})

describe('toHoldingValues', () => {
  it('maps money to minor units and preserves nullable cost/price and fractional quantity', () => {
    const [apple, msft] = overview().holdings
    expect(toHoldingValues(apple!, 7)).toEqual({
      snapshotId: 7,
      conid: 265598,
      symbol: 'AAPL',
      description: 'APPLE INC',
      quantity: 50,
      averageCost: 15_010,
      marketPrice: 21_234,
      marketValue: 1_061_700,
      currency: 'USD',
    })
    const msftRow = toHoldingValues(msft!, 7)
    expect(msftRow.averageCost).toBeNull()
    expect(msftRow.marketPrice).toBeNull()
    expect(msftRow.marketValue).toBe(1_344_656)
  })

  it('keeps fractional share counts as-is (quantity is not money)', () => {
    const holding = { ...overview().holdings[0]!, quantity: 0.12345 }
    expect(toHoldingValues(holding, 1).quantity).toBe(0.12345)
  })
})

describe('row → domain', () => {
  const headerRow: SnapshotRow = {
    id: 42,
    capturedAt: 1_000,
    source: 'ibkr',
    baseCurrency: 'USD',
    totalMarketValue: 2_406_356,
    netLiquidation: 2_529_812,
    totalCash: 123_456,
    holdingsCount: 2,
    createdAt: 9_999,
  }

  it('rowToSummary converts stored cents back to decimals', () => {
    expect(rowToSummary(headerRow)).toEqual({
      id: 42,
      capturedAt: 1_000,
      source: 'ibkr',
      baseCurrency: 'USD',
      totalMarketValue: 24063.56,
      netLiquidation: 25298.12,
      totalCash: 1234.56,
      holdingsCount: 2,
    })
  })

  it('rowToHolding restores decimals and null cost/price', () => {
    const row: SnapshotHoldingRow = {
      id: 1,
      snapshotId: 42,
      conid: 272093,
      symbol: 'MSFT',
      description: 'MICROSOFT CORP',
      quantity: 30,
      averageCost: null,
      marketPrice: null,
      marketValue: 1_344_656,
      currency: 'USD',
    }
    expect(rowToHolding(row)).toEqual({
      conid: 272093,
      symbol: 'MSFT',
      description: 'MICROSOFT CORP',
      quantity: 30,
      averageCost: null,
      marketPrice: null,
      marketValue: 13446.56,
      currency: 'USD',
    })
  })

  it('round-trips a holding through minor units without drift', () => {
    const original = overview().holdings[0]!
    const row = { id: 1, ...toHoldingValues(original, 1) } as SnapshotHoldingRow
    expect(rowToHolding(row)).toEqual(original)
  })
})
