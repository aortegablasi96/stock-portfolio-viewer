import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import type { CompositionPoint } from '@shared/domain/performance'
import type { CompositionBand } from '@shared/domain/performance'
import {
  bandPaint,
  compositionColors,
  nearestIndex,
  orderComposition,
  shares,
  sliceComposition,
  stackGeometry,
  stackOrder,
  stackSpans,
  valueDomain,
} from './composition'

/**
 * The composition chart's stacking maths (Story #171, DDR-0050; cumulative since DDR-0052). The
 * invariant the whole chart rests on is that the bands sum to NAV at every point — a stacked chart
 * whose parts do not sum is worse than no chart — so that is asserted directly, including in the
 * two cases where it is least obvious: a day with negative cash and a day with no NAV at all.
 *
 * That invariant is now load-bearing in a way it was not before. The normalised chart divided by
 * `total`, so its top edge was 100% whether or not the bands really summed; the cumulative one
 * draws the sum itself, and the top edge *is* the reader's NAV figure. So the tests assert the
 * stack's top against `point.total`, not merely that the parts are consistent with each other.
 */

const point = (total: number, values: number[], date = 0): CompositionPoint => ({
  date,
  total,
  values,
})

/** Sum with a tolerance, since real NAV components are floats. */
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0)

const BOX = { width: 1000, height: 200, pad: { top: 10, right: 10, bottom: 20, left: 60 } }

describe('shares', () => {
  it('turns band values into proportions of NAV that sum to exactly 1', () => {
    const s = shares(point(1000, [900, 100]))
    expect(s).toEqual([0.9, 0.1])
    expect(sum(s)).toBe(1)
  })

  it('sums to 1 even when a band is negative (margin)', () => {
    // Stock exceeds NAV because cash is borrowed: 45000 − 5000 = 40000.
    const s = shares(point(40_000, [45_000, -5000]))
    expect(s[0]).toBeCloseTo(1.125, 10)
    expect(s[1]).toBeCloseTo(-0.125, 10)
    expect(sum(s)).toBeCloseTo(1, 10)
  })

  it('yields all-zero shares on a zero-NAV day rather than dividing by zero', () => {
    // The owner's real 2025 export opens on the day before the account was funded.
    const s = shares(point(0, [0, 0, 0]))
    expect(s).toEqual([0, 0, 0])
    expect(s.every(Number.isFinite)).toBe(true)
  })

  it('sums to 1 for real IBKR figures, which only reconcile to float precision', () => {
    const s = shares(point(38510.982350092, [38420.766223, 40.185955492, 50.0301716]))
    expect(sum(s)).toBeCloseTo(1, 12)
  })
})

describe('stackSpans', () => {
  it('stacks positive bands bottom-first, each starting where the last ended', () => {
    expect(stackSpans([500, 300, 200])).toEqual([
      { lo: 0, hi: 500 },
      { lo: 500, hi: 800 },
      { lo: 800, hi: 1000 },
    ])
  })

  it('puts the top of the stack on the day’s NAV, which is the chart’s whole promise', () => {
    const p = point(38_510.98, [38_420.77, 40.19, 50.02])
    const spans = stackSpans(p.values)
    expect(spans[spans.length - 1]!.hi).toBeCloseTo(p.total, 6)
  })

  it('hangs a negative band below the zero line instead of clamping it', () => {
    const spans = stackSpans([45_000, -5000])
    expect(spans[0]).toEqual({ lo: 0, hi: 45_000 })
    // Below the baseline, not stacked on top of the band above it.
    expect(spans[1]).toEqual({ lo: -5000, hi: 0 })
  })

  it('keeps the positive stack anchored at zero when a band goes negative', () => {
    // The margin band must not drag the bands above it down through the baseline — a reader
    // comparing two days would otherwise see stock "move" purely because cash changed sign.
    const flat = stackSpans([90, 10])
    const margin = stackSpans([110, -10])
    expect(flat[0]?.lo).toBe(0)
    expect(margin[0]?.lo).toBe(0)
  })

  it('collapses every band to zero thickness on a zero-NAV day', () => {
    expect(stackSpans([0, 0])).toEqual([
      { lo: 0, hi: 0 },
      { lo: 0, hi: 0 },
    ])
  })

  it('lets a band that flips sign move across the baseline', () => {
    // Cash crossing into margin between two days is a real transition, not an error.
    expect(stackSpans([800, 200])[1]).toEqual({ lo: 800, hi: 1000 })
    expect(stackSpans([1200, -200])[1]).toEqual({ lo: -200, hi: 0 })
  })

  it('scales with the money rather than normalising it away', () => {
    // The behaviour DDR-0052 bought: two days at identical proportions but different NAV are
    // different heights. Under the 100%-stacked chart these were the same picture.
    expect(stackSpans([60, 40])[1]!.hi).toBe(100)
    expect(stackSpans([600, 400])[1]!.hi).toBe(1000)
  })
})

describe('valueDomain', () => {
  it('spans zero up to a round top that covers the tallest stack', () => {
    const domain = valueDomain([point(100, [60, 40]), point(200, [50, 150])])
    expect(domain.bottom).toBe(0)
    expect(domain.top).toBeGreaterThanOrEqual(200)
    expect(domain.ticks).toContain(0)
  })

  it('gives the tallest stack headroom instead of clipping it on the top gridline', () => {
    const domain = valueDomain([point(43_718.02, [43_718.02])])
    expect(domain.top).toBeGreaterThan(43_718.02)
  })

  it('drops below zero to fit a negative band rather than cropping it', () => {
    const domain = valueDomain([point(40_000, [45_000, -5000])])
    expect(domain.bottom).toBeLessThanOrEqual(-5000)
    expect(domain.top).toBeGreaterThanOrEqual(45_000)
  })

  it('follows the money, so a window in which NAV doubled is drawn taller', () => {
    // The deliberate opposite of the old share domain, which was anchored to [0, 1] precisely so
    // that it would *not* move. Here it should move: that is the information (DDR-0052).
    const small = valueDomain([point(20_000, [20_000])])
    const large = valueDomain([point(45_000, [45_000])])
    expect(large.top).toBeGreaterThan(small.top)
  })

  it('lands its ticks on round, evenly spaced numbers a reader can scan', () => {
    const { ticks } = valueDomain([point(43_718.02, [43_718.02])])
    expect(ticks.length).toBeGreaterThan(1)
    const step = ticks[1]! - ticks[0]!
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]! - ticks[i - 1]!).toBeCloseTo(step, 6)
    }
    expect(ticks).toContain(0)
  })

  it('is unaffected by zero-NAV days', () => {
    const withGap = valueDomain([point(0, [0, 0]), point(100, [60, 40])])
    expect(withGap).toEqual(valueDomain([point(100, [60, 40])]))
  })

  it('collapses to a single zero tick for an empty series', () => {
    expect(valueDomain([])).toEqual({ top: 0, bottom: 0, ticks: [0] })
  })
})

describe('stackGeometry', () => {
  const series = [point(100, [60, 40], 10), point(100, [50, 50], 20), point(100, [80, 20], 30)]

  it('emits one closed ribbon per band', () => {
    const { paths } = stackGeometry(series, 2, BOX)
    expect(paths).toHaveLength(2)
    for (const path of paths) {
      expect(path.startsWith('M ')).toBe(true)
      expect(path.endsWith(' Z')).toBe(true)
      expect(path).not.toMatch(/NaN|Infinity|undefined/)
    }
  })

  it('spans the plot box horizontally, respecting the padding', () => {
    const { xs } = stackGeometry(series, 2, BOX)
    expect(xs).toHaveLength(3)
    expect(xs[0]).toBe(BOX.pad.left)
    expect(xs[2]).toBe(BOX.width - BOX.pad.right)
  })

  it('rests the bottom band on the zero baseline', () => {
    const { paths } = stackGeometry([point(100, [100, 0]), point(100, [100, 0])], 2, BOX)
    expect(paths[0]).toContain(`,${BOX.height - BOX.pad.bottom}`)
  })

  it('leaves the top of the stack short of the top pad, because the axis rounds outward', () => {
    // The normalised chart's top band sat exactly on `pad.top` — its domain ended at 1 by
    // definition. A currency axis rounds up to a round tick instead, so a real NAV (which is
    // never a round number) has headroom and the stack does not touch the top gridline.
    const nav = 43_718.02
    const { paths, domain } = stackGeometry([point(nav, [nav], 10), point(nav, [nav], 20)], 1, BOX)
    expect(domain.top).toBeGreaterThan(nav)
    expect(paths[0]).not.toContain(`,${BOX.pad.top}`)
  })

  it('draws the same proportions at different heights when NAV differs', () => {
    // Two series, each 60/40 every day, one at ten times the NAV. Under the old chart these were
    // pixel-identical; the point of the cumulative version is that they are not.
    const small = stackGeometry([point(100, [60, 40], 10), point(100, [60, 40], 20)], 2, BOX)
    const large = stackGeometry([point(1000, [600, 400], 10), point(1000, [600, 400], 20)], 2, BOX)
    expect(large.domain.top).toBeGreaterThan(small.domain.top)
  })

  it('produces finite geometry for a zero-NAV day mid-series', () => {
    const withGap = [point(100, [60, 40], 10), point(0, [0, 0], 20), point(100, [80, 20], 30)]
    const { paths } = stackGeometry(withGap, 2, BOX)
    for (const path of paths) expect(path).not.toMatch(/NaN|Infinity/)
  })

  it('produces finite geometry when a band is negative', () => {
    const margin = [point(40_000, [45_000, -5000], 10), point(40_000, [44_000, -4000], 20)]
    const { paths, domain } = stackGeometry(margin, 2, BOX)
    expect(domain.bottom).toBeLessThan(0)
    for (const path of paths) expect(path).not.toMatch(/NaN|Infinity/)
  })

  it('handles a band that only appears partway through the range', () => {
    // An asset class first bought mid-window: zero-thickness until it opens, then a real band.
    const appearing = [
      point(100, [100, 0], 10),
      point(100, [100, 0], 20),
      point(100, [70, 30], 30),
    ]
    const { paths } = stackGeometry(appearing, 2, BOX)
    expect(paths).toHaveLength(2)
    for (const path of paths) expect(path).not.toMatch(/NaN|Infinity/)
    // The new band is a real ribbon, not a degenerate empty string.
    expect(paths[1]?.length).toBeGreaterThan(10)
  })

  it('draws nothing for a series too short to form a ribbon', () => {
    expect(stackGeometry([point(100, [100])], 1, BOX).paths).toEqual([])
    expect(stackGeometry([], 1, BOX).paths).toEqual([])
  })

  it('draws nothing when there are no bands', () => {
    expect(stackGeometry(series, 0, BOX).paths).toEqual([])
  })
})

describe('sliceComposition', () => {
  const series = [point(100, [100], 10), point(100, [100], 20), point(100, [100], 30)]

  it('keeps the days inside the window, inclusive of both edges', () => {
    expect(sliceComposition(series, { from: 20, to: 30 }).map((p) => p.date)).toEqual([20, 30])
    expect(sliceComposition(series, { from: 10, to: 30 })).toHaveLength(3)
  })

  it('invents no point at the window edge', () => {
    // A carried-forward point would draw a portfolio shape on a day it was never measured.
    expect(sliceComposition(series, { from: 15, to: 25 }).map((p) => p.date)).toEqual([20])
  })

  it('is empty when the window contains no measured day', () => {
    expect(sliceComposition(series, { from: 40, to: 50 })).toEqual([])
  })
})

/**
 * The chart and its legend no longer share an element — the legend sits in the card header so the
 * four cards match in height (DDR-0052) — so they share this function instead. A key that
 * disagrees with the bands it keys is worse than no key.
 */
describe('compositionColors', () => {
  const band = (key: CompositionBand['key'], label: string): CompositionBand => ({ key, label })

  const bands: CompositionBand[] = [
    band('stock', 'Stock'),
    band('cash', 'Cash'),
    band('accruals', 'Accruals'),
  ]

  it('returns one class per band, in the bands’ own order', () => {
    const colors = compositionColors(bands)
    expect(colors).toHaveLength(3)
    for (const c of colors) expect(c).toMatch(/^pie-series-/)
  })

  it('gives each named asset class its own hue', () => {
    expect(new Set(compositionColors(bands)).size).toBe(3)
  })

  it('takes the palette from slot 1, because asset class is not sector', () => {
    // SECTOR_SLOT_OFFSET reserves the blue for the Allocation map's weight donut and applies to
    // sectors only (DDR-0030). Reserving it here would spend a hue for nothing.
    expect(compositionColors(bands)[0]).toBe('pie-series-1')
  })

  it('gives the residual band the neutral swatch rather than a category hue', () => {
    const withOther = [...bands, band('other', 'Other')]
    expect(compositionColors(withOther)[3]).toBe('pie-series-neutral')
  })

  it('keeps a band’s hue when a later band appears, so a colour means one thing over time', () => {
    const colors = compositionColors(bands)
    const grown = compositionColors([...bands, band('other', 'Other')])
    expect(grown.slice(0, 3)).toEqual(colors)
  })

  it('has nothing to colour for an empty stack', () => {
    expect(compositionColors([])).toEqual([])
  })
})

/**
 * The stacking order, and the split between it and the palette (Story #222, DDR-0073).
 *
 * The order is asserted as the whole list rather than as "accruals is first", because the point of
 * the story is that a later change to the band list cannot silently reshuffle the picture: a rule
 * about one end would let the middle move. `STACK_SLOT` is a `Record` keyed by the domain union,
 * so a *new* band key fails to type-check rather than failing here — this covers the other half,
 * which is an existing key quietly moving.
 */
describe('stackOrder', () => {
  const band = (key: CompositionBand['key'], label: string): CompositionBand => ({ key, label })

  /** Every band the report can emit, in the palette order the service declares them in. */
  const all: CompositionBand[] = [
    band('stock', 'Stocks'),
    band('options', 'Options'),
    band('cash', 'Cash'),
    band('accruals', 'Accruals'),
    band('other', 'Other'),
  ]

  it('stacks least-invested first, so Stocks is drawn on top and Accruals on the baseline', () => {
    expect(stackOrder(all).map((s) => s.band.key)).toEqual([
      'accruals',
      'cash',
      'other',
      'options',
      'stock',
    ])
  })

  it('places the two bands the request did not name deliberately, not by reversal', () => {
    // A reversed report array would put the residual on the baseline, under Accruals. `other` is
    // above the cash it is not and below the named invested bands it cannot be identified with.
    const keys = stackOrder(all).map((s) => s.band.key)
    expect(keys.indexOf('other')).toBeGreaterThan(keys.indexOf('cash'))
    expect(keys.indexOf('other')).toBeLessThan(keys.indexOf('options'))
    expect(keys.indexOf('options')).toBeLessThan(keys.indexOf('stock'))
  })

  it('holds the constraint the story states, whichever bands are actually drawn', () => {
    // The owner's account: no options, and the components account for all of NAV.
    const held = [band('stock', 'Stocks'), band('cash', 'Cash'), band('accruals', 'Accruals')]
    expect(stackOrder(held).map((s) => s.band.key)).toEqual(['accruals', 'cash', 'stock'])
  })

  it('keeps each band’s hue on the report’s order, so inverting the stack repaints nothing', () => {
    // Stocks had slot 1 when it was the base of the stack and keeps it at the top of it.
    const byKey = new Map(stackOrder(all).map((s) => [s.band.key, s.color]))
    expect(byKey.get('stock')).toBe('pie-series-1')
    expect(byKey.get('options')).toBe('pie-series-2')
    expect(byKey.get('cash')).toBe('pie-series-3')
    expect(byKey.get('accruals')).toBe('pie-series-4')
    expect(byKey.get('other')).toBe('pie-series-neutral')
  })

  it('carries each band’s index in the report, which the stack order no longer matches', () => {
    expect(stackOrder(all).map((s) => s.index)).toEqual([3, 2, 4, 1, 0])
  })

  it('has nothing to stack for an empty band list', () => {
    expect(stackOrder([])).toEqual([])
  })
})

describe('orderComposition', () => {
  const bands: CompositionBand[] = [
    { key: 'stock', label: 'Stocks' },
    { key: 'cash', label: 'Cash' },
    { key: 'accruals', label: 'Accruals' },
  ]

  it('re-reads each point’s values in stacking order', () => {
    const stack = stackOrder(bands)
    const ordered = orderComposition([point(1005, [900, 100, 5])], stack)
    expect(ordered[0]?.values).toEqual([5, 100, 900])
  })

  it('leaves the day’s NAV alone, so the stack still closes on `total`', () => {
    const stack = stackOrder(bands)
    const ordered = orderComposition([point(1005, [900, 100, 5], 42)], stack)
    expect(ordered[0]?.total).toBe(1005)
    expect(ordered[0]?.date).toBe(42)
    expect(sum(ordered[0]!.values)).toBe(1005)
    expect(stackSpans(ordered[0]!.values).at(-1)?.hi).toBe(1005)
  })

  it('keeps a negative band signed rather than losing it in the shuffle', () => {
    const stack = stackOrder([bands[0]!, bands[1]!])
    expect(orderComposition([point(40_000, [45_000, -5000])], stack)[0]?.values).toEqual([
      -5000, 45_000,
    ])
  })
})

describe('bandPaint', () => {
  const stack = stackOrder([
    { key: 'stock', label: 'Stocks' },
    { key: 'cash', label: 'Cash' },
    { key: 'accruals', label: 'Accruals' },
  ])

  it('fills the top band from the gradient and every other from its own class', () => {
    const paint = bandPaint(stack, 'grad')
    expect(paint.map((p) => p.fill)).toEqual([undefined, undefined, 'url(#grad)'])
    expect(paint[0]?.className).toBe('stack-band pie-series-3')
    expect(paint.at(-1)?.className).toBe('stack-band stack-band-top')
  })

  it('publishes every band’s hue on its group, the top band’s included', () => {
    // The top ribbon cannot carry the palette class — a CSS `fill` would out-rank the gradient
    // reference — so its stroke and its gradient stops read the hue off the group instead.
    expect(bandPaint(stack, 'grad').map((p) => p.hue)).toEqual([
      'pie-series-3',
      'pie-series-2',
      'pie-series-1',
    ])
  })

  it('treats whichever band reaches the top as the top, not `stock` by name', () => {
    const noEquity = stackOrder([
      { key: 'cash', label: 'Cash' },
      { key: 'accruals', label: 'Accruals' },
    ])
    expect(bandPaint(noEquity, 'grad').at(-1)?.className).toContain('stack-band-top')
  })

  it('paints nothing for an empty stack', () => {
    expect(bandPaint([], 'grad')).toEqual([])
  })
})

/**
 * The half of the treatment that lives in the stylesheet (Story #222, DDR-0073). Comments are
 * stripped first: the rules quote their own values in prose, which is the trap DDR-0042 records
 * and which has now bitten six times.
 */
describe('the stack’s fills, in app.css', () => {
  const CSS = readFileSync(new URL('../app.css', import.meta.url), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  )

  /** One rule's body. Anchored to a line start, or `.pie-series-1` would find the hover card's
      `.chart-tooltip-value.pie-series-1` first and measure the ink ramp instead. */
  const rule = (selector: string): string =>
    CSS.match(new RegExp(`^${selector.replace(/[.*]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm'))?.[1] ?? ''

  it('runs the top band’s ramp from 0.8 to the 0.5 every other band wears', () => {
    expect(rule('.stack-top-from')).toContain('stop-opacity: 0.8')
    expect(rule('.stack-top-to')).toContain('stop-opacity: 0.5')
    expect(rule('.stack-band')).toContain('fill-opacity: 0.5')
    // The ramp carries the alpha, so the flat softening is given back on the top band.
    expect(rule('.stack-band-top')).toContain('fill-opacity: 1')
  })

  it('takes both the stops and the stroke from the band’s own hue, not a second palette', () => {
    for (const selector of ['.stack-top-from', '.stack-top-to']) {
      expect(rule(selector)).toContain('stop-color: var(--series-hue)')
    }
    expect(rule('.stack-band')).toContain('stroke: var(--series-hue)')
    // …which every palette slot has to publish, or a band would stroke itself with nothing.
    for (const slot of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(rule(`.pie-series-${slot}`)).toContain(`--series-hue: var(--series-${slot})`)
    }
    expect(rule('.pie-series-neutral')).toContain('--series-hue: var(--series-neutral)')
  })

  it('strokes the band rather than separating it, which is the stroke DDR-0052 removed', () => {
    // `none` was the whole point of that rule; an own-colour hairline is the opposite decision.
    expect(rule('.stack-band')).not.toContain('stroke: none')
    expect(rule('.stack-band')).toContain('vector-effect: non-scaling-stroke')
  })

  it('shrinks the key’s swatch and stops softening it', () => {
    const swatch = rule('.composition-legend .legend-swatch')
    expect(swatch).toContain('width: 8px')
    expect(swatch).toContain('border-radius: 2px')
    expect(swatch).not.toContain('opacity')
  })
})

describe('nearestIndex', () => {
  it('finds the closest point by x', () => {
    expect(nearestIndex([0, 50, 100], 60)).toBe(1)
    expect(nearestIndex([0, 50, 100], 90)).toBe(2)
    expect(nearestIndex([0, 50, 100], -20)).toBe(0)
  })

  it('has no target in an empty series', () => {
    expect(nearestIndex([], 10)).toBeNull()
  })
})
