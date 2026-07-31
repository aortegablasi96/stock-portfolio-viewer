import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BUTTON_SIZES,
  BUTTON_VARIANTS,
  DEFAULT_BUTTON_SIZE,
  DEFAULT_BUTTON_VARIANT,
  buttonClassName,
} from './buttonVariants'

/**
 * The `Button` primitive's contract (Story #127, DDR-0032).
 *
 * Two halves, and the second is the one worth having. Composition is easy to get right;
 * what is easy to get wrong is a union and a stylesheet drifting apart — a variant added
 * in TypeScript with no rule behind it renders as an unstyled button, and nothing else in
 * the toolchain notices. So this reads `app.css` the way `designTokens.test.ts` does, and
 * also asserts that the eight families the primitive replaced are gone rather than left
 * orphaned beside it (Epic #125's standing risk).
 */

const CSS = readFileSync(new URL('../app.css', import.meta.url), 'utf8')

/** Whether the stylesheet declares a rule whose selector starts with this exact class. */
function declaresRule(selector: string): boolean {
  return new RegExp(`^\\s*\\${selector}[\\s,:{]`, 'm').test(CSS)
}

describe('buttonClassName', () => {
  it('composes base, variant and size', () => {
    expect(buttonClassName('danger', 'sm')).toBe('btn btn-danger btn-sm')
  })

  it('defaults to the outline variant at the medium size', () => {
    expect(buttonClassName()).toBe(`btn btn-${DEFAULT_BUTTON_VARIANT} btn-${DEFAULT_BUTTON_SIZE}`)
    expect(buttonClassName()).toBe('btn btn-outline btn-md')
  })

  it('appends a caller’s className last, so a call site extends rather than forks', () => {
    expect(buttonClassName('ghost', 'icon', 'titlebar-close')).toBe(
      'btn btn-ghost btn-icon titlebar-close',
    )
  })

  it('omits an absent or empty className rather than emitting a stray space', () => {
    expect(buttonClassName('link', 'sm', undefined)).toBe('btn btn-link btn-sm')
    expect(buttonClassName('link', 'sm', '')).toBe('btn btn-link btn-sm')
  })
})

describe('the stylesheet backs every declared variant and size', () => {
  it.each(BUTTON_VARIANTS)('declares a rule for variant "%s"', (variant) => {
    expect(declaresRule(`.btn-${variant}`)).toBe(true)
  })

  it.each(BUTTON_SIZES)('declares a rule for size "%s"', (size) => {
    expect(declaresRule(`.btn-${size}`)).toBe(true)
  })

  it('declares the shared base rule and one disabled treatment for all variants', () => {
    expect(declaresRule('.btn')).toBe(true)
    expect(CSS).toMatch(/^\.btn:disabled \{/m)
    // A per-variant disabled rule would be the inconsistency the story removed.
    expect(CSS).not.toMatch(/^\.btn-[a-z]+:disabled \{/m)
  })

  it('leaves the focus ring to the base rule, so no variant can ring differently', () => {
    const buttonRules = [...CSS.matchAll(/^\.btn[\w-]*[^{]*\{([^}]*)\}/gm)].map((m) => m[1] ?? '')
    expect(buttonRules.length).toBeGreaterThan(0)
    expect(buttonRules.filter((body) => body.includes('outline'))).toEqual([])
  })
})

/**
 * The eight families the primitive replaced. Epic #125's stated risk is a consolidation
 * that stalls half-done, leaving a primitive beside the rules it was meant to retire —
 * worse than either end state. This is that risk, pinned.
 */
describe('the superseded button families are gone', () => {
  it.each([
    '.capture-button',
    '.danger-button',
    '.ghost-button',
    '.retry-button',
    '.view-refresh',
    '.type-filter-clear',
    '.titlebar-button',
    '.map-zoom-btn',
  ])('%s no longer appears in the stylesheet', (selector) => {
    expect(CSS).not.toContain(selector)
  })
})
