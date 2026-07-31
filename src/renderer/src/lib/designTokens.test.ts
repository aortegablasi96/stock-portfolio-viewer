import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

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
 * The colour tokens are out of scope for this story and the two chart palettes carry
 * recorded CVD and contrast validation (DDR-0021, DDR-0030) — a colour moved here is a
 * validation invalidated, not a tweak. Pinned so that only a deliberate edit can do it.
 */
describe('colour tokens (unchanged by Epic #125)', () => {
  it.each([
    ['--bg', '#0f1115'],
    ['--card', '#171a21'],
    ['--border', '#262b36'],
    ['--text', '#e6e9ef'],
    ['--muted', '#9aa4b2'],
    ['--accent', '#4c8dff'],
    ['--pos', '#0ca30c'],
    ['--neg', '#d03b3b'],
  ])('%s is %s', (name, value) => {
    expect(token(name)).toBe(value)
  })

  it('keeps the eight-slot categorical palette and its neutral residual', () => {
    expect(
      [1, 2, 3, 4, 5, 6, 7, 8].map((slot) => token(`--series-${slot}`)),
    ).toEqual(['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'])
    expect(token('--series-neutral')).toBe('#898781')
  })

  it('keeps the seven-step diverging scale, neutral at the midpoint', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((step) => token(`--diverge-${step}`))).toEqual([
      '#d03b3b',
      '#bc5d55',
      '#a5746b',
      '#898781',
      '#6f849f',
      '#5180bb',
      '#2a78d6',
    ])
    expect(token('--diverge-4')).toBe(token('--series-neutral'))
  })

  it('keeps the shared content measure (DDR-0018)', () => {
    expect(token('--content-max')).toBe('110rem')
    expect(token('--content-pad')).toBe('2rem')
  })
})
