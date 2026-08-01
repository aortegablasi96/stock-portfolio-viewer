import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BADGE_SIZES,
  BADGE_VARIANTS,
  badgeClassName,
  DEFAULT_BADGE_SIZE,
  DEFAULT_BADGE_VARIANT,
} from './badgeVariants'

/**
 * The `Badge` contract (Story #132, DDR-0037).
 *
 * Same two halves as the button's, card's, tile's, field's and toggle group's tests
 * (DDR-0032 – DDR-0036), and the second half is again the one worth having: a variant with no
 * rule behind it renders as bare text and nothing else in the toolchain notices. So this reads
 * `app.css`, and also asserts that the rules the primitive replaced are gone rather than left
 * orphaned beside it, which is Epic #125's standing risk.
 */

const CSS = readFileSync(new URL('../app.css', import.meta.url), 'utf8')

/**
 * The stylesheet with its comments removed. The "gone" assertions below have to read this
 * rather than `CSS`: the primitive's own comment block names the rules it replaced, which is
 * exactly the documentation worth keeping and would otherwise fail the test.
 */
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * Whether the stylesheet declares a rule carrying this exact class. The class may appear
 * anywhere in the selector rather than only at its start, because `plain` is declared doubled
 * (`.badge.badge-plain`) to beat the size's padding without depending on source order.
 */
function declaresRule(selector: string): boolean {
  return new RegExp(`^[^{\\n]*\\${selector}[\\s,:.{]`, 'm').test(CSS)
}

/** The body of the first rule whose selector is exactly this one. */
function ruleBody(selector: string): string {
  return new RegExp(`^\\${selector} \\{([^}]*)\\}`, 'm').exec(CSS)?.[1] ?? ''
}

describe('badgeClassName', () => {
  it('composes base, variant and size', () => {
    expect(badgeClassName('neutral', 'sm')).toBe('badge badge-neutral badge-sm')
    expect(badgeClassName('accent', 'md')).toBe('badge badge-accent badge-md')
    expect(badgeClassName('plain', 'md')).toBe('badge badge-plain badge-md')
  })

  it('defaults to the bordered standalone label — the form three call sites use', () => {
    expect(DEFAULT_BADGE_VARIANT).toBe('neutral')
    expect(DEFAULT_BADGE_SIZE).toBe('md')
    expect(badgeClassName()).toBe(
      `badge badge-${DEFAULT_BADGE_VARIANT} badge-${DEFAULT_BADGE_SIZE}`,
    )
  })

  it('appends a caller’s className last, so a call site extends rather than forks', () => {
    expect(badgeClassName('plain', 'md', 'wide')).toBe('badge badge-plain badge-md wide')
  })

  it('omits an absent or empty className rather than emitting a stray space', () => {
    expect(badgeClassName('neutral', 'sm', undefined)).toBe('badge badge-neutral badge-sm')
    expect(badgeClassName('neutral', 'sm', '')).toBe('badge badge-neutral badge-sm')
  })
})

describe('the stylesheet backs every declared variant and size', () => {
  it.each(BADGE_VARIANTS)('declares a rule for variant "%s"', (variant) => {
    expect(declaresRule(`.badge-${variant}`)).toBe(true)
  })

  it.each(BADGE_SIZES)('declares a rule for size "%s"', (size) => {
    expect(declaresRule(`.badge-${size}`)).toBe(true)
  })

  it('declares the shared base rule', () => {
    expect(CSS).toMatch(/^\.badge \{/m)
  })

  it('takes its corner and type from the scale, never a raw length', () => {
    expect(ruleBody('.badge')).toContain('border-radius: var(--radius-sm)')
    expect(ruleBody('.badge-sm')).toContain('font-size: var(--text-2xs)')
    expect(ruleBody('.badge-md')).toContain('font-size: var(--text-xs)')
  })

  /**
   * DDR-0036 spent the pill corner on a meaning — a multi-select toggle item, "any number of
   * these can be pressed". A static label wearing it invites a click that does nothing, which
   * is why `.flex-import-badge`'s 999px is the one visual correction this story makes.
   */
  it('is never a pill, at any size or variant', () => {
    const bodies = [...CSS.matchAll(/^\.badge[\w-.]*[^{]*\{([^}]*)\}/gm)].map((m) => m[1] ?? '')
    expect(bodies.length).toBeGreaterThan(0)
    for (const body of bodies) {
      expect(body).not.toContain('--radius-pill')
      expect(body).not.toContain('999px')
    }
  })

  /**
   * The structural half of the size axis, and the reason `sm` is not merely "the smaller one":
   * an inline-block with vertical padding grows the line box it sits in, so a padded chip beside
   * a market value would push every row of the holdings table apart.
   */
  it('gives the inline size no vertical padding', () => {
    expect(ruleBody('.badge-sm')).toContain('padding: 0 var(--space-2)')
    expect(ruleBody('.badge-md')).toContain('padding: var(--space-1) var(--space-3)')
  })

  /**
   * "New" versus "already imported" is a meaning, and a meaning may not be carried by colour
   * alone. The two labels differ in wording as well, but that is the call site's doing — the
   * primitive carries a second channel of its own.
   */
  it('marks the accent variant by more than colour alone', () => {
    expect(ruleBody('.badge-accent')).toContain('font-weight: 600')
  })

  /**
   * `plain` is the badge without a boundary, so it takes no box padding either — otherwise the
   * row count moves in its toolbar and the "+3 dup" qualifier moves in its cell. Asserted with
   * the doubled class, because equal specificity would make it a question of source order.
   */
  it('strips the box padding from the boundary-free variant, order-independently', () => {
    expect(CSS).toMatch(/^\.badge\.badge-plain \{/m)
    expect(/^\.badge\.badge-plain \{([^}]*)\}/m.exec(CSS)?.[1] ?? '').toContain('padding: 0')
  })

  /** A badge is a `<span>`, never focusable: a ring here would be a ring on nothing. */
  it('declares no focus ring of its own', () => {
    const bodies = [...CSS.matchAll(/^\.badge[\w-.]*[^{]*\{([^}]*)\}/gm)].map((m) => m[1] ?? '')
    expect(bodies.filter((body) => body.includes('outline'))).toEqual([])
  })

  /**
   * Both boxed call sites sit on `--card`, where the fill `.native-chip` declared was drawing
   * the surface it already stood on. A badge that carries its own fill starts reading as a
   * button the first time one lands on a nested surface.
   */
  it('carries no background — the boundary is the border', () => {
    const bodies = [...CSS.matchAll(/^\.badge[\w-.]*[^{]*\{([^}]*)\}/gm)].map((m) => m[1] ?? '')
    expect(bodies.filter((body) => body.includes('background'))).toEqual([])
  })
})

/**
 * The rules the primitive replaced. Epic #125's stated risk is a consolidation that stalls
 * half-done, leaving a primitive beside the rules it was meant to retire — worse than either
 * end state.
 */
describe('the superseded badge rules are gone', () => {
  it.each([
    '.native-chip',
    '.flex-import-badge',
    '.flex-import-badge-new',
    '.card-count',
    '.flex-import-dup',
  ])('%s no longer appears in the stylesheet', (selector) => {
    expect(RULES).not.toContain(selector)
  })

  /** `.flex-import-dim` stays: it colours a table cell standing in for a count, not a label. */
  it('leaves the dimmed cell rule alone', () => {
    expect(declaresRule('.flex-import-dim')).toBe(true)
  })
})
