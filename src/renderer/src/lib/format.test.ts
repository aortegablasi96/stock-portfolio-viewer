import { describe, it, expect } from 'vitest'
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatMonth,
  formatPercent,
  formatPercentValue,
  formatQuantity,
  formatSignedCurrency,
  formatSignedPercent,
} from './format'

describe('formatCurrency', () => {
  it('formats a valid ISO currency with its symbol', () => {
    // Locale-independent check: the digits and separators may vary, but a $ appears for USD.
    expect(formatCurrency(1234.5, 'USD')).toMatch(/\$\s?1,?234\.50|1[.,]234[.,]50/)
  })

  it('falls back to plain 2-decimal formatting for the BASE pseudo-currency', () => {
    expect(formatCurrency(1000, 'BASE')).not.toMatch(/[A-Z]{3}/)
    expect(formatCurrency(1000, 'BASE')).toMatch(/1[.,]000\.00|1000\.00/)
  })

  it('falls back to plain formatting for an empty or invalid currency code', () => {
    expect(() => formatCurrency(10, '')).not.toThrow()
    expect(() => formatCurrency(10, 'not-a-code')).not.toThrow()
    expect(formatCurrency(10, '')).toMatch(/10\.00/)
  })
})

describe('formatPercent', () => {
  it('renders a fraction as a one-decimal percentage', () => {
    expect(formatPercent(0.6)).toMatch(/60\.0\s?%/)
    expect(formatPercent(0)).toMatch(/0\.0\s?%/)
  })
})

describe('formatQuantity', () => {
  it('formats whole and fractional quantities without forcing decimals', () => {
    expect(formatQuantity(100)).toMatch(/^100$|^100(\.0+)?$/)
    expect(formatQuantity(1.5)).toMatch(/1\.5/)
  })
})

describe('formatDateTime', () => {
  it('renders an epoch-ms timestamp as a non-empty date-time string', () => {
    const out = formatDateTime(Date.UTC(2026, 6, 4, 15, 30))
    expect(out).toMatch(/2026/)
    expect(out.length).toBeGreaterThan(0)
  })
})

describe('formatDate', () => {
  it('renders an epoch-ms date without a time component', () => {
    const out = formatDate(Date.UTC(2026, 0, 1))
    expect(out).toMatch(/2026/)
    expect(out).not.toMatch(/:\d\d/)
  })
})

describe('formatSignedCurrency', () => {
  it('prefixes a leading + for positive, - for negative, nothing for zero', () => {
    expect(formatSignedCurrency(10, 'USD')).toMatch(/^\+/)
    expect(formatSignedCurrency(-10, 'USD')).toMatch(/^-/)
    expect(formatSignedCurrency(0, 'USD')).not.toMatch(/^[+-]/)
  })
})

describe('formatPercentValue / formatSignedPercent', () => {
  it('formats an already-percent value with two decimals and a % sign', () => {
    expect(formatPercentValue(7.125)).toMatch(/7\.1[23]\s?%/)
  })

  it('adds an explicit sign only for non-zero values', () => {
    expect(formatSignedPercent(7.12)).toMatch(/^\+7\.12\s?%/)
    expect(formatSignedPercent(-3.5)).toMatch(/^-3\.50\s?%/)
    expect(formatSignedPercent(0)).not.toMatch(/^[+-]/)
  })
})

describe('formatMonth', () => {
  it('renders a YYYY-MM key as a short month + year', () => {
    const out = formatMonth('2026-01')
    expect(out).toMatch(/2026/)
    expect(out).toMatch(/jan/i)
  })

  it('passes through a non-month key such as "Unknown"', () => {
    expect(formatMonth('Unknown')).toBe('Unknown')
  })
})
