import { describe, it, expect } from 'vitest'
import {
  formatCompanyName,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatMonth,
  formatPercent,
  formatPercentValue,
  formatPerShare,
  formatQuantity,
  formatSignedCurrency,
  formatSignedPercent,
  formatUpdatedAt,
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

describe('formatPerShare', () => {
  it('keeps the precision a real dividend rate needs, where 2 decimals would lose it', () => {
    // A genuine rate: CAD 0.093999 per share. formatCurrency would round it to 0.09.
    expect(formatPerShare(0.093999, 'CAD')).toMatch(/0\.094/)
    expect(formatCurrency(0.093999, 'CAD')).toMatch(/0\.09(?!4)/)
  })

  it('still shows the usual two decimals for ordinary rates', () => {
    expect(formatPerShare(1.46, 'CAD')).toMatch(/1\.46/)
    expect(formatPerShare(2, 'USD')).toMatch(/2\.00/)
  })

  it('carries the sign of a per-share withholding amount', () => {
    expect(formatPerShare(-0.075, 'USD')).toMatch(/-.*0\.075/)
  })

  it('falls back to plain formatting for an invalid or BASE currency code', () => {
    expect(() => formatPerShare(0.5, 'not-a-code')).not.toThrow()
    expect(formatPerShare(0.5, 'BASE')).toMatch(/0\.50/)
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

describe('formatCompanyName', () => {
  it('strips share-class and legal-form suffixes and title-cases (real Flex names)', () => {
    expect(formatCompanyName('INTERACTIVE BROKERS GRO-CL A')).toBe('Interactive Brokers')
    expect(formatCompanyName('SERABI GOLD PLC')).toBe('Serabi Gold')
    expect(formatCompanyName('GOEASY LTD')).toBe('Goeasy')
    expect(formatCompanyName('FILA SPA')).toBe('Fila')
    expect(formatCompanyName('NAGARRO SE')).toBe('Nagarro')
    expect(formatCompanyName('CONCENTRIX CORP')).toBe('Concentrix')
    expect(formatCompanyName('GLOBAL PAYMENTS INC')).toBe('Global Payments')
  })

  it('keeps an apostrophe intact rather than capitalising the letter after it', () => {
    expect(formatCompanyName("LEON'S FURNITURE LTD")).toBe("Leon's Furniture")
  })

  it('handles an explicit share class and multiple trailing suffixes', () => {
    expect(formatCompanyName('VISA INC-CLASS A')).toBe('Visa')
    expect(formatCompanyName('SOME NAME HOLDINGS PLC')).toBe('Some Name')
  })

  it('returns the trimmed input unchanged when there is nothing to strip', () => {
    expect(formatCompanyName('  apple  ')).toBe('Apple')
    expect(formatCompanyName('')).toBe('')
  })
})

describe('formatUpdatedAt', () => {
  it('shows only a clock time when the reading is from today', () => {
    const now = new Date(2026, 6, 28, 16, 5).getTime()
    const at = new Date(2026, 6, 28, 14, 32).getTime()

    const out = formatUpdatedAt(at, now)

    expect(out).toMatch(/32/)
    expect(out).not.toMatch(/jul/i)
  })

  it('adds the day and month once the reading is from an earlier day', () => {
    const now = new Date(2026, 6, 28, 9, 0).getTime()
    const at = new Date(2026, 6, 27, 21, 15).getTime()

    const out = formatUpdatedAt(at, now)

    expect(out).toMatch(/27/)
    expect(out).toMatch(/jul/i)
    expect(out).toMatch(/15/)
  })

  it('treats the same clock time a year apart as an earlier day', () => {
    const now = new Date(2026, 6, 28, 10, 0).getTime()
    const at = new Date(2025, 6, 28, 10, 0).getTime()

    expect(formatUpdatedAt(at, now)).toMatch(/jul/i)
  })
})
