import { describe, expect, it } from 'vitest'
import type { Holding } from '@shared/domain/portfolio'
import { unrealizedPnlOf, unrealizedPnlTone } from './holdingPnl'

/**
 * The holdings table's Unrealized P&L cell (Story #263). Vitest runs with no jsdom, so these two
 * rules are testable only because they live outside the component — the split the renderer follows
 * for every piece of logic a view carries.
 */
function holding(overrides: Partial<Holding> = {}): Holding {
  return {
    conid: 1,
    symbol: 'AAA',
    description: 'AAA',
    companyName: null,
    quantity: 10,
    averageCost: 5,
    marketPrice: 7,
    marketValue: 70,
    unrealizedPnl: 20,
    currency: 'USD',
    ...overrides,
  }
}

describe('unrealizedPnlOf', () => {
  it('takes the converted figure and the display currency when one was requested', () => {
    const pnl = unrealizedPnlOf(holding({ displayUnrealizedPnl: 18 }), 'EUR')
    expect(pnl).toEqual({ value: 18, currency: 'EUR' })
  })

  it('takes the native figure and the position currency when none was', () => {
    const pnl = unrealizedPnlOf(holding())
    expect(pnl).toEqual({ value: 20, currency: 'USD' })
  })

  /**
   * The row whose rate was unavailable. Its Market value cell already carries the "no exchange
   * rate" badge and the table its notice, so the P&L column says nothing rather than flagging the
   * same fact a second time on the same line (DDR-0007).
   */
  it('has no value where the position could not be converted', () => {
    const pnl = unrealizedPnlOf(holding({ displayUnrealizedPnl: null }), 'EUR')
    expect(pnl.value).toBeNull()
  })

  /**
   * The field is *absent* — not null — on a snapshot-sourced holding and on the native overview.
   * An `undefined` reaching the cell would render as an empty cell rather than as the em dash that
   * says "not known", so it is normalised here.
   */
  it('normalises an absent converted figure to null rather than letting undefined through', () => {
    const withoutField = holding()
    delete withoutField.displayUnrealizedPnl
    expect('displayUnrealizedPnl' in withoutField).toBe(false)
    expect(unrealizedPnlOf(withoutField, 'EUR').value).toBeNull()
  })

  it('reports the native figure as unknown where the gateway never supplied one', () => {
    expect(unrealizedPnlOf(holding({ unrealizedPnl: null })).value).toBeNull()
  })
})

describe('unrealizedPnlTone', () => {
  it('tones a gain and a loss', () => {
    expect(unrealizedPnlTone({ value: 20, currency: 'EUR' })).toBe('positive')
    expect(unrealizedPnlTone({ value: -20, currency: 'EUR' })).toBe('negative')
  })

  it('leaves a flat position neutral', () => {
    expect(unrealizedPnlTone({ value: 0, currency: 'EUR' })).toBe('neutral')
  })

  /**
   * The one that would fail quietly. `toneOf` takes a number, so the natural spelling at a call
   * site is `toneOf(value ?? 0)`; get the coalesce wrong — or reach for a truthiness check — and an
   * *unknown* P&L is painted as a loss. An em dash in the loss tone is a statement, and a false one.
   */
  it('leaves an unknown figure neutral rather than painting it as a loss', () => {
    expect(unrealizedPnlTone({ value: null, currency: 'EUR' })).toBe('neutral')
  })
})
