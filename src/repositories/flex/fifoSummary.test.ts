import { describe, it, expect } from 'vitest'
import { isInstrumentSummary } from './fifoSummary'
import type { FifoSummaryRow } from './flexReadRepository'

function fifo(overrides: Partial<FifoSummaryRow>): FifoSummaryRow {
  return {
    conid: 1,
    symbol: 'AAA',
    description: 'Alpha',
    assetCategory: 'STK',
    realizedStProfit: 0,
    realizedStLoss: 0,
    realizedLtProfit: 0,
    realizedLtLoss: 0,
    totalRealizedPnl: 0,
    totalUnrealizedPnl: 0,
    ...overrides,
  }
}

describe('isInstrumentSummary', () => {
  it('keeps rows that carry a symbol (stocks and cash currencies alike)', () => {
    expect(isInstrumentSummary(fifo({ symbol: 'AAA' }))).toBe(true)
    expect(isInstrumentSummary(fifo({ conid: 1029, symbol: 'USD', assetCategory: 'CASH' }))).toBe(true)
  })

  it('drops the "Total (All Assets)" aggregate row (blank symbol/conid)', () => {
    expect(
      isInstrumentSummary(fifo({ conid: null, symbol: '', description: 'Total (All Assets)' })),
    ).toBe(false)
    expect(isInstrumentSummary(fifo({ symbol: '   ' }))).toBe(false)
  })
})
