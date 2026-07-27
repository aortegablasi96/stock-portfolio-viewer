import { describe, it, expect } from 'vitest'
import { fromLatestStatement, isInstrumentSummary } from './fifoSummary'
import type { FifoSummaryRow } from './flexReadRepository'

function fifo(overrides: Partial<FifoSummaryRow>): FifoSummaryRow {
  return {
    statementId: 1,
    statementToDate: Date.UTC(2025, 11, 31),
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

describe('fromLatestStatement', () => {
  const older = Date.UTC(2025, 11, 31)
  const newer = Date.UTC(2026, 6, 22)

  it('returns nothing for no rows', () => {
    expect(fromLatestStatement([])).toEqual([])
  })

  it('keeps every row of the statement with the latest end date', () => {
    const rows = [
      fifo({ statementId: 1, statementToDate: older, symbol: 'AAA' }),
      fifo({ statementId: 1, statementToDate: older, symbol: 'BBB' }),
      fifo({ statementId: 2, statementToDate: newer, symbol: 'AAA' }),
      fifo({ statementId: 2, statementToDate: newer, symbol: 'CCC' }),
    ]
    expect(fromLatestStatement(rows).map((r) => r.symbol)).toEqual(['AAA', 'CCC'])
  })

  it('goes by end date, not by import order (statement ids are assigned on import)', () => {
    // The newest period was imported first, so it has the *lower* id.
    const rows = [
      fifo({ statementId: 1, statementToDate: newer, symbol: 'AAA' }),
      fifo({ statementId: 2, statementToDate: older, symbol: 'BBB' }),
    ]
    expect(fromLatestStatement(rows).map((r) => r.symbol)).toEqual(['AAA'])
  })

  it('breaks a tie on the same end date with the later import', () => {
    const rows = [
      fifo({ statementId: 1, statementToDate: newer, symbol: 'AAA' }),
      fifo({ statementId: 2, statementToDate: newer, symbol: 'BBB' }),
    ]
    expect(fromLatestStatement(rows).map((r) => r.symbol)).toEqual(['BBB'])
  })

  it('passes a single statement through untouched', () => {
    const rows = [fifo({ symbol: 'AAA' }), fifo({ symbol: 'BBB' })]
    expect(fromLatestStatement(rows)).toEqual(rows)
  })
})
