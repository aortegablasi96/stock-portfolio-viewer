import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PERFORMANCE_PLOT } from './chartGeometry'
import { stripComments } from './cssDeclarations'
import { signedBands } from './signedCurve'

/**
 * The zero-line split (Story #229, DDR-0071).
 *
 * The interesting cases are the degenerate ones, and they are interesting because they are
 * invisible: a range entirely above or entirely below break-even puts the zero line outside the
 * plot, where an unclamped clip rectangle takes a negative height and SVG responds by rendering
 * nothing. The chart loses its fill *and* its line, and it does so only in the two ranges a
 * reviewer is least likely to scrub to by hand.
 *
 * The block at the bottom scans `app.css`, with comments stripped first — the stylesheet quotes
 * its own tokens in prose, and this story's notes name every one of them (DDR-0042).
 */

const CSS = stripComments(readFileSync(new URL('../app.css', import.meta.url), 'utf8'))
const PLOT = PERFORMANCE_PLOT
const TOP = PLOT.pad.top
const BOTTOM = PLOT.height - PLOT.pad.bottom

describe('signedBands', () => {
  it('meets at the zero line, covering the plot exactly once', () => {
    const mid = (TOP + BOTTOM) / 2
    const { above, below } = signedBands(mid, PLOT)
    expect(above.y + above.height).toBe(below.y)
    expect(above.height + below.height).toBe(BOTTOM - TOP)
    // Both bands span the full plot width: the split is vertical and nothing is cut off the ends.
    for (const band of [above, below]) {
      expect(band.x).toBe(PLOT.pad.left)
      expect(band.width).toBe(PLOT.width - PLOT.pad.left - PLOT.pad.right)
    }
  })

  it('gives the whole plot to one tone where the range never crosses zero', () => {
    // Every reading positive: break-even sits at or below the bottom edge, so nothing is red.
    const allPositive = signedBands(BOTTOM, PLOT)
    expect(allPositive.above.height).toBe(BOTTOM - TOP)
    expect(allPositive.below.height).toBe(0)

    // Every reading negative: break-even is above the top edge, so nothing is green.
    const allNegative = signedBands(TOP, PLOT)
    expect(allNegative.above.height).toBe(0)
    expect(allNegative.below.height).toBe(BOTTOM - TOP)
  })

  it('never returns a negative height, however far outside the plot zero falls', () => {
    // The failure this guards is not cosmetic: SVG treats a negative height as an error value and
    // skips the shape, so the band that should have covered everything renders as nothing.
    for (const zeroY of [-500, -1, TOP - 0.5, BOTTOM + 0.5, PLOT.height, 5000]) {
      const { above, below, zeroY: clamped } = signedBands(zeroY, PLOT)
      expect(above.height, `above at ${zeroY}`).toBeGreaterThanOrEqual(0)
      expect(below.height, `below at ${zeroY}`).toBeGreaterThanOrEqual(0)
      expect(clamped).toBeGreaterThanOrEqual(TOP)
      expect(clamped).toBeLessThanOrEqual(BOTTOM)
      // Still exactly one covering, whatever was asked for.
      expect(above.height + below.height).toBe(BOTTOM - TOP)
    }
  })

  it('clamps the rule to the plot, so it is never drawn off the chart', () => {
    expect(signedBands(-40, PLOT).zeroY).toBe(TOP)
    expect(signedBands(9999, PLOT).zeroY).toBe(BOTTOM)
    expect(signedBands(100, PLOT).zeroY).toBe(100)
  })
})

describe('the tones app.css draws', () => {
  it('takes the value curve to the indigo, and off the categorical slot', () => {
    // The proposal's own hue for this curve, at the value DDR-0054 measured (#818cf8, 6.21:1)
    // rather than the #6366f1 it quotes, which was declined as text at 4.14:1.
    expect(CSS).toMatch(/\.chart-line\s*\{[^}]*stroke:\s*var\(--accent\)/)
    expect(CSS).toMatch(/\.chart-area-from\s*\{[^}]*stop-color:\s*var\(--accent\)/)
    expect(CSS).toMatch(/\.chart-area-to\s*\{[^}]*stop-opacity:\s*0;/)
    // The line and its marks are one curve and must not end up two hues.
    expect(CSS).toMatch(/\.chart-dot\s*\{[^}]*fill:\s*var\(--accent\)/)
    expect(CSS).toMatch(/\.chart-hover-dot\s*\{[^}]*fill:\s*var\(--accent\)/)
    // --series-1 keeps its other jobs; the curve simply stopped being one of them (DDR-0030).
    expect(CSS).toMatch(/\.pie-series-1\s*\{\s*fill:\s*var\(--series-1\)/)
  })

  it('tones the split curve with the bars’ own pair, mark half and not text half', () => {
    // `--neg`, never `--neg-text`: a curve is a mark, and in SVG both roles are written the same
    // way, so picking the wrong half is silent (DDR-0046).
    expect(CSS).toMatch(/\.chart-line-pos\s*\{\s*stroke:\s*var\(--pos\)/)
    expect(CSS).toMatch(/\.chart-line-neg\s*\{\s*stroke:\s*var\(--neg\)/)
    expect(CSS).not.toMatch(/\.chart-line-neg\s*\{\s*stroke:\s*var\(--neg-text\)/)
    // The same pair the daily-return bars carry, which is what makes the two charts one statement.
    expect(CSS).toMatch(/\.chart-bar-loss\s*\{\s*fill:\s*var\(--neg\)/)
  })

  it('scopes a dot’s tone so the dot’s own fill cannot out-order it', () => {
    /* Found on screen, not in a test: `.chart-dot` sets `fill: var(--accent)` and is declared
       *below* the tone rules, so an unscoped `.chart-mark-pos` ties on specificity and loses on
       source order — indigo dots on a green curve, with nothing failing. Both selectors must stay
       doubled, and neither tone may appear as a bare single-class rule (DDR-0059's trap). */
    for (const tone of ['pos', 'neg']) {
      expect(CSS, `.chart-dot.chart-mark-${tone}`).toMatch(
        new RegExp(`\\.chart-dot\\.chart-mark-${tone}`),
      )
      expect(CSS, `.chart-hover-dot.chart-mark-${tone}`).toMatch(
        new RegExp(`\\.chart-hover-dot\\.chart-mark-${tone}`),
      )
      // A bare rule would be the regression: same declaration, silently overridden.
      expect(CSS, `bare .chart-mark-${tone}`).not.toMatch(
        new RegExp(`(^|[,}])\\s*\\.chart-mark-${tone}\\s*[,{]`, 'm'),
      )
    }
  })

  it('fades each band away from the zero line it is anchored to', () => {
    // Strongest at the extreme, nothing at break-even — so the wash reads as distance from zero
    // rather than as a second, paler series (DDR-0061's finding, applied to a signed curve).
    expect(CSS).toMatch(/\.chart-area-pos-from\s*\{[^}]*stop-color:\s*var\(--pos\)/)
    expect(CSS).toMatch(/\.chart-area-pos-to\s*\{[^}]*stop-opacity:\s*0;/)
    expect(CSS).toMatch(/\.chart-area-neg-from\s*\{[^}]*stop-opacity:\s*0;/)
    expect(CSS).toMatch(/\.chart-area-neg-to\s*\{[^}]*stop-color:\s*var\(--neg\)/)
  })
})
