import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { scanDeclarations, stripComments } from './cssDeclarations'
import { EXEMPTIONS, findMotionDeclarations, findViolations } from './motionTokens'

/**
 * The design-token contract (Story #126, DDR-0031).
 *
 * There is no module under test here: the tokens are CSS custom properties, and the
 * thing worth pinning is the stylesheet itself. Epic #125 has eight more stories that
 * each rewrite a slab of `app.css`, so this guards the foundation they build on — a
 * step quietly deleted, a scale that stops ascending, a focus ring that goes its own
 * way again, or a validated palette colour nudged — against a diff that looks routine.
 */

const CSS = readFileSync(new URL('../app.css', import.meta.url), 'utf8')

/** The `:root` block, which declares every token and contains no nested braces. */
function rootBlock(): string {
  const start = CSS.indexOf(':root {')
  expect(start).toBeGreaterThanOrEqual(0)
  const end = CSS.indexOf('}', start)
  return CSS.slice(start, end)
}

/** The declared value of a custom property, with its trailing comment stripped. */
function token(name: string): string {
  const value = new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(rootBlock())?.[1]
  expect(value, `${name} is not declared in :root`).toBeDefined()
  return value!.trim()
}

/** A token's value in px, for scale comparisons. `rem` is 16px at the app's root size. */
function px(name: string): number {
  const value = token(name)
  const match = /^([\d.]+)(rem|px)$/.exec(value)
  expect(match, `${name} is "${value}", not a plain rem/px length`).not.toBeNull()
  return match![2] === 'rem' ? Number(match![1]) * 16 : Number(match![1])
}

/** Each scale ascends, so `sm < md < lg` is true of the values and not only the names. */
function expectAscending(names: string[]): void {
  const sizes = names.map(px)
  expect(sizes, names.join(' < ')).toEqual([...sizes].sort((a, b) => a - b))
  expect(new Set(sizes).size, `${names.join(', ')} contains a duplicate value`).toBe(sizes.length)
}

describe('spacing scale', () => {
  it('declares eight ascending steps', () => {
    expectAscending([
      '--space-1',
      '--space-2',
      '--space-3',
      '--space-4',
      '--space-5',
      '--space-6',
      '--space-7',
      '--space-8',
    ])
  })

  it('lands on the 4px grid, apart from the one declared 6px half-step', () => {
    const offGrid = ['--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-7', '--space-8']
      .filter((name) => px(name) % 4 !== 0)
      .map((name) => `${name} = ${px(name)}px`)
    expect(offGrid).toEqual(['--space-2 = 6px'])
  })

  it('builds the composite control and surface paddings out of the scale', () => {
    for (const name of ['--control-pad-sm', '--control-pad-md', '--control-pad-lg']) {
      expect(token(name), name).toMatch(/^var\(--space-\d\) var\(--space-\d\)$/)
    }
    for (const name of ['--surface-pad-sm', '--surface-pad-md', '--surface-pad-lg']) {
      expect(token(name), name).toMatch(/^var\(--space-\d\)$/)
    }
  })
})

describe('radius scale', () => {
  it('declares three ascending steps plus a pill', () => {
    expectAscending(['--radius-sm', '--radius-md', '--radius-lg'])
    expect(px('--radius-pill')).toBeGreaterThan(px('--radius-lg'))
  })

  it('is expressed in px, so a corner does not grow with the type scale', () => {
    for (const name of ['--radius-sm', '--radius-md', '--radius-lg', '--radius-pill']) {
      expect(token(name), name).toMatch(/px$/)
    }
  })
})

describe('type scale', () => {
  it('declares seven ascending steps', () => {
    expectAscending([
      '--text-2xs',
      '--text-xs',
      '--text-sm',
      '--text-md',
      '--text-lg',
      '--text-xl',
      '--text-2xl',
    ])
  })

  it('keeps every step at or above the app’s smallest readable size', () => {
    expect(px('--text-2xs')).toBeGreaterThanOrEqual(11)
  })

  it('declares the two line heights as unitless ratios', () => {
    expect(token('--leading-tight')).toMatch(/^\d+(\.\d+)?$/)
    expect(token('--leading-normal')).toMatch(/^\d+(\.\d+)?$/)
    expect(Number(token('--leading-normal'))).toBeGreaterThan(Number(token('--leading-tight')))
  })

  /**
   * The two families the scale gained in Story #180 (DDR-0053). Pinned here beside the steps
   * because they are part of the same contract — a step says how big a figure is, a family says
   * what shape its digits are — while `figureRole.test.ts` guards the harder half: that the three
   * properties making a figure comparable stay in one rule, and that neither face is ever fetched.
   */
  it('names a prose family and a figure family, both ahead of a generic fallback', () => {
    expect(token('--font-sans')).toBe(
      "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    )
    expect(token('--font-figure')).toBe(
      "'JetBrains Mono', ui-monospace, 'Cascadia Mono', 'Consolas', monospace",
    )
    expect(token('--tracking-figure')).toBe('-0.02em')
  })

  it('applies the prose family once, on body, so everything inherits it', () => {
    expect(CSS).toMatch(/body \{\n {2}font-family: var\(--font-sans\);/)
  })
})

describe('focus ring', () => {
  it('is one accent-coloured treatment with an outer and an inset offset', () => {
    expect(token('--focus-ring-color')).toBe('var(--accent)')
    expect(token('--focus-ring')).toBe('var(--focus-ring-width) solid var(--focus-ring-color)')
    expect(px('--focus-ring-offset')).toBeGreaterThan(0)
    expect(token('--focus-ring-offset-inset')).toBe('-2px')
  })

  it('is the only outline in the stylesheet, so no rule can ring differently', () => {
    const declared = [...CSS.matchAll(/^\s*outline:\s*([^;]+);/gm)].map((m) => (m[1] ?? '').trim())
    expect(declared.length).toBeGreaterThan(1)
    expect([...new Set(declared)]).toEqual(['var(--focus-ring)'])

    const offsets = [...CSS.matchAll(/^\s*outline-offset:\s*([^;]+);/gm)].map((m) =>
      (m[1] ?? '').trim(),
    )
    expect([...new Set(offsets)].sort()).toEqual([
      'var(--focus-ring-offset)',
      'var(--focus-ring-offset-inset)',
    ])
  })

  it('rings every interactive element by default, at zero specificity', () => {
    expect(CSS).toMatch(
      /:where\(a\[href], button, input, select, textarea, summary, \[tabindex]\):focus-visible/,
    )
  })
})

/**
 * Motion (Story #154, DDR-0044).
 *
 * The scale and the accessibility guarantee are one thing here, so they are tested together.
 * Reduced motion is honoured by redefining `--duration-*` to `0ms` rather than by listing the
 * selectors that move, which means a rule is inside the reduced-motion rule's reach exactly when
 * it draws its duration from the scale — and a hard-coded duration is the only way out.
 */
describe('motion scale', () => {
  /** A duration token's value in ms. */
  function ms(name: string): number {
    const value = token(name)
    const match = /^(\d*\.?\d+)(ms|s)$/.exec(value)
    expect(match, `${name} is "${value}", not a plain time`).not.toBeNull()
    return match![2] === 's' ? Number(match![1]) * 1000 : Number(match![1])
  }

  /** The `--duration-*` tokens declared in `:root`, in source order. */
  function durationTokens(): string[] {
    return [...rootBlock().matchAll(/^\s*(--duration-[a-z]+):/gm)].map((m) => m[1]!)
  }

  it('declares two ascending durations and the two easings', () => {
    expect(durationTokens()).toEqual(['--duration-fast', '--duration-base'])
    expect(ms('--duration-fast')).toBeLessThan(ms('--duration-base'))
    expect(ms('--duration-fast')).toBeGreaterThan(0)
    expect(token('--ease-out')).toBe('ease-out')
    expect(token('--ease-linear')).toBe('linear')
  })

  it('keeps every step short enough to read as feedback rather than as an event', () => {
    for (const name of durationTokens()) expect(ms(name), name).toBeLessThanOrEqual(200)
  })

  it('draws every transition and animation from the scale', () => {
    // Not a smoke test: this is also the reduced-motion guarantee. A raw duration here is a rule
    // that keeps animating for a reader who asked it not to.
    const violations = findViolations(CSS).map((d) => `${d.key} (line ${d.line}) — ${d.value}`)
    expect(violations).toEqual([])
    // And the guard is looking at something: the stylesheet really does declare motion.
    expect(findMotionDeclarations(CSS).length).toBeGreaterThan(4)
  })

  it('reaches every animation from one reduced-motion rule', () => {
    const blocks = stripComments(CSS).match(/@media \(prefers-reduced-motion: reduce\)/g) ?? []
    expect(blocks, 'reduced motion is one rule, not one per animation').toHaveLength(1)

    const inside = scanDeclarations(CSS).filter((d) =>
      d.context.startsWith('@media (prefers-reduced-motion: reduce)'),
    )
    expect([...new Set(inside.map((d) => d.context))]).toEqual([
      '@media (prefers-reduced-motion: reduce) >> :root',
    ])
    // Every duration the scale declares is zeroed, and nothing else is touched — an easing with
    // no time to run is already inert.
    expect(inside.map((d) => d.property)).toEqual(durationTokens())
    expect([...new Set(inside.map((d) => d.value))]).toEqual(['0ms'])
  })

  it('declares the override after the scale, which is the only reason it wins', () => {
    // Same specificity, no media-query bonus: source order is the whole mechanism.
    expect(CSS.indexOf('@media (prefers-reduced-motion: reduce)')).toBeGreaterThan(
      CSS.indexOf(':root {'),
    )
  })

  it('keeps the one exemption honest', () => {
    // The ratchet half of `tokenAdoption.ts`, applied to a list of one: an exemption that stopped
    // matching is a decision that has quietly expired.
    const declarations = new Map(findMotionDeclarations(CSS).map((d) => [d.key, d.value]))
    for (const exemption of EXEMPTIONS) {
      expect(declarations.get(exemption.key), exemption.key).toBe(exemption.value)
      expect(exemption.reason.length, `${exemption.key} has no reason`).toBeGreaterThan(40)
    }
  })
})

/**
 * The colour tokens carry recorded CVD and contrast validation (DDR-0021, DDR-0030, DDR-0046,
 * DDR-0054) — a colour moved here is a validation invalidated, not a tweak. Pinned so that only a
 * deliberate edit can do it.
 *
 * Re-keyed to the navy/indigo theme by Story #181, which is the one edit that ever should move
 * them wholesale: every value below was re-derived and measured rather than taken from the
 * proposal, and `contrast.test.ts` holds the thresholds this only pins.
 */
describe('colour tokens', () => {
  it.each([
    ['--bg', '#080b18'],
    ['--card', '#0f1320'],
    ['--border', '#1f2644'],
    ['--text', '#e2e8f0'],
    ['--muted', '#8690aa'],
    ['--accent', '#818cf8'],
    ['--pos', '#10b981'],
    ['--neg', '#e11d48'],
  ])('%s is %s', (name, value) => {
    expect(token(name)).toBe(value)
  })

  /**
   * The two tones added by Story #163. They exist because `--neg` and white-on-`--accent` failed
   * AA, and they are pinned here for the same reason the palette above is: the values are
   * measured, so moving one is a measurement invalidated. `contrast.test.ts` enforces the
   * thresholds; this pins that the split itself survives.
   */
  it('carries a text-safe loss tone and a filled-button accent, distinct from the originals', () => {
    expect(token('--neg-text')).toBe('#fb7185')
    expect(token('--accent-strong')).toBe('#4f46e5')
    expect(token('--neg-text')).not.toBe(token('--neg'))
    expect(token('--accent-strong')).not.toBe(token('--accent'))
  })

  /**
   * The eight slots are the one part of the palette Story #181 did **not** move, and that is a
   * result rather than an oversight (DDR-0054). Re-validated against the new surface on
   * 2026-08-18 with the data-viz validator: every check still passes, because CVD separation and
   * the normal-vision floor are measured mark-against-mark and do not move when the ground does,
   * while the contrast check only improves on a darker one.
   */
  it('keeps the eight-slot categorical palette, which the re-key did not touch', () => {
    expect(
      [1, 2, 3, 4, 5, 6, 7, 8].map((slot) => token(`--series-${slot}`)),
    ).toEqual(['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'])
  })

  /**
   * The residual and the chart furniture *did* move, and for a reason no ratio reports: they are
   * achromatic, and the old values are warm greys. A warm grey on a blue-black ground stops
   * reading as "no hue" and starts reading as brown, which is exactly what the residual slot
   * must not do — hue has to keep meaning "a real category" (DDR-0030).
   */
  it('keeps the neutral residual and the chart furniture cool, to match the ground', () => {
    expect(token('--series-neutral')).toBe('#8189a3')
    expect(token('--chart-axis')).toBe('#8189a3')
    expect(token('--chart-grid')).toBe('#252c4e')
    for (const name of ['--series-neutral', '--chart-axis', '--chart-grid']) {
      const [r, , b] = [1, 3, 5].map((i) => Number.parseInt(token(name).slice(i, i + 2), 16))
      expect(b, `${name} is warmer than the ground it sits on`).toBeGreaterThan(r!)
    }
  })

  /**
   * The diverging scale is gone (Story #160): it existed for the Allocation map's gain/loss
   * colour mode and had no other consumer, so withdrawing the mode retired the scale. Pinned as
   * an absence, because a palette that reappears without the CVD validation DDR-0021 recorded
   * would look like a restoration and be a new, unvalidated decision.
   */
  it('declares no diverging scale, which left with the map’s gain/loss mode', () => {
    expect(rootBlock()).not.toMatch(/--diverge-/)
    expect(CSS).not.toMatch(/\.map-diverge-/)
  })

  it('keeps the shared content measure (DDR-0018)', () => {
    expect(token('--content-max')).toBe('110rem')
    expect(token('--content-pad')).toBe('2rem')
  })
})
