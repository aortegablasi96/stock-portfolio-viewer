import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BADGE_CELL_CLASS,
  BADGE_SIZES,
  BADGE_VARIANTS,
  badgeClassName,
  DEFAULT_BADGE_SIZE,
  DEFAULT_BADGE_VARIANT,
  TONED_BADGE_VARIANTS,
} from './badgeVariants'
import { STAT_TONES, toneOf } from './statTileVariants'

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

  it('composes the toned cell badge the Dividends transactions table renders', () => {
    expect(badgeClassName('negative', 'sm', BADGE_CELL_CLASS)).toBe(
      'badge badge-negative badge-sm badge-cell',
    )
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
 * The two toned variants (Story #192, DDR-0064). The prototype draws a dividend row's type as a
 * *tinted chip*; what ships is the primitive's own treatment — a boundary and an ink — in the
 * gain and loss tones, so DDR-0037's "never a background" survives the redesign rather than
 * being amended out of it.
 */
describe('the toned variants keep the primitive’s shape and the tone split', () => {
  it('carries the loss tone as --neg-text, never the fill token (DDR-0046)', () => {
    expect(ruleBody('.badge-negative')).toContain('color: var(--neg-text)')
    expect(ruleBody('.badge-negative')).not.toMatch(/color:\s*var\(--neg\)/)
  })

  it('carries the gain tone as --pos', () => {
    expect(ruleBody('.badge-positive')).toContain('color: var(--pos)')
  })

  /**
   * The boundary is the tone mixed halfway into `--border` — the idiom `.capture-status-error`
   * and `.state-panel-error` already use. Full-strength on a 200-row table would read as stripes,
   * and it is the *border* that takes the fill token, because a border is painted area.
   */
  it.each(TONED_BADGE_VARIANTS)('mixes variant "%s" into the shared border rather than replacing it', (variant) => {
    expect(ruleBody(`.badge-${variant}`)).toMatch(
      /border: 1px solid color-mix\(in srgb, var\(--(pos|neg)\) 50%, var\(--border\)\)/,
    )
  })

  /**
   * The badge's text names the transaction type, so the tone is a second channel and not the
   * only one — which is why these two do not take `.badge-accent`'s weight step. That variant
   * needs it because a call site could word "Imported" and "Already imported" identically; a
   * type label cannot stop naming its type.
   */
  it('leaves the weight step to the one variant whose meaning rides on colour alone', () => {
    expect(ruleBody('.badge-positive')).not.toContain('font-weight')
    expect(ruleBody('.badge-negative')).not.toContain('font-weight')
  })

  /**
   * The reason the badge's variant union is a superset of the tile's tone union rather than a
   * parallel vocabulary: `toneOf()` is handed straight to `variant`, and `neutral` is both the
   * default badge and the absence of a tone. Two unions agreeing on two names and disagreeing on
   * the third would type-check at every call site and render the wrong chip at one.
   */
  it('contains every stat tone, so toneOf() can name a variant directly', () => {
    for (const tone of STAT_TONES) {
      expect(BADGE_VARIANTS).toContain(tone)
    }
    expect(toneOf(-12.5)).toBe('negative')
    expect(toneOf(0)).toBe(DEFAULT_BADGE_VARIANT)
  })
})

/**
 * The cell placement. `sm` is the size, because `md`'s vertical padding is taller than the
 * `--text-sm` line every other cell in the row draws; the gap `sm` also carries is what this
 * undoes, and it has to beat the size by specificity rather than by source order.
 */
describe('a badge that opens its own table cell', () => {
  it('is named once, and the stylesheet declares it doubled', () => {
    expect(BADGE_CELL_CLASS).toBe('badge-cell')
    expect(CSS).toMatch(/^\.badge\.badge-cell \{/m)
    expect(/^\.badge\.badge-cell \{([^}]*)\}/m.exec(CSS)?.[1] ?? '').toContain('margin-left: 0')
  })

  /**
   * It undoes the gap and nothing else. A padding or a font-size here would be a third size
   * wearing a placement class, which is exactly the fork `className` is not for (ADR-0008).
   */
  it('undoes the inline gap and declares nothing else', () => {
    const body = /^\.badge\.badge-cell \{([^}]*)\}/m.exec(CSS)?.[1] ?? ''
    expect(body.match(/[\w-]+\s*:/g)).toHaveLength(1)
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
