import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CARD_HEADER_ALIGNMENTS,
  CARD_PARTS,
  CARD_SIZES,
  CARD_VARIANTS,
  DEFAULT_CARD_SIZE,
  DEFAULT_CARD_VARIANT,
  cardClassName,
  cardHeaderClassName,
  cardPartClassName,
} from './cardVariants'

/**
 * The `Card` primitive's contract (Story #128, DDR-0033).
 *
 * Same two halves as the button's test (DDR-0032), and the second is again the one worth
 * having: a union member with no rule behind it renders as an unstyled surface — a panel with
 * no background, no border and no padding — and nothing else in the toolchain notices. So this
 * reads `app.css`, and also asserts that the five surfaces the primitive replaced are gone
 * rather than left orphaned beside it, which is Epic #125's standing risk.
 */

const CSS = readFileSync(new URL('../app.css', import.meta.url), 'utf8')

/**
 * The stylesheet with its comments removed. The "gone" assertions below have to read this
 * rather than `CSS`: the primitive's own comment block names the five surfaces it replaced,
 * which is exactly the documentation worth keeping and would otherwise fail the test.
 */
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

/** Whether the stylesheet declares a rule whose selector starts with this exact class. */
function declaresRule(selector: string): boolean {
  return new RegExp(`^\\s*\\${selector}[\\s,:{]`, 'm').test(CSS)
}

describe('cardClassName', () => {
  it('composes base, variant and size', () => {
    expect(cardClassName('nested', 'sm')).toBe('card card-nested card-sm')
  })

  it('defaults to the default variant at the medium size', () => {
    expect(cardClassName()).toBe(`card card-${DEFAULT_CARD_VARIANT} card-${DEFAULT_CARD_SIZE}`)
    expect(cardClassName()).toBe('card card-default card-md')
  })

  it('appends a caller’s className last, so a call site extends rather than forks', () => {
    expect(cardClassName('default', 'lg', 'state-panel state-error')).toBe(
      'card card-default card-lg state-panel state-error',
    )
  })

  it('omits an absent or empty className rather than emitting a stray space', () => {
    expect(cardClassName('default', 'md', undefined)).toBe('card card-default card-md')
    expect(cardClassName('default', 'md', '')).toBe('card card-default card-md')
  })
})

describe('cardHeaderClassName and cardPartClassName', () => {
  it('composes the header’s alignment as a modifier, defaulting to centred', () => {
    expect(cardHeaderClassName()).toBe('card-header card-header-center')
    expect(cardHeaderClassName('start')).toBe('card-header card-header-start')
  })

  it('composes a single-class part', () => {
    expect(cardPartClassName('title')).toBe('card-title')
    expect(cardPartClassName('content', 'realized-split')).toBe('card-content realized-split')
  })
})

describe('the stylesheet backs every declared variant, size, alignment and part', () => {
  it.each(CARD_VARIANTS)('declares a rule for variant "%s"', (variant) => {
    expect(declaresRule(`.card-${variant}`)).toBe(true)
  })

  it.each(CARD_SIZES)('declares a rule for size "%s"', (size) => {
    expect(declaresRule(`.card-${size}`)).toBe(true)
  })

  it.each(CARD_HEADER_ALIGNMENTS)('declares a rule for header alignment "%s"', (align) => {
    expect(declaresRule(`.card-header-${align}`)).toBe(true)
  })

  it.each(CARD_PARTS)('declares a rule for part "%s"', (part) => {
    expect(declaresRule(`.card-${part}`)).toBe(true)
  })

  it('declares the shared base rule that carries the border and radius', () => {
    expect(CSS).toMatch(/^\.card \{/m)
  })

  it('gives every size its padding from the surface scale, never a raw length', () => {
    for (const size of CARD_SIZES) {
      const rule = new RegExp(`^\\.card-${size} \\{([^}]*)\\}`, 'm').exec(CSS)?.[1] ?? ''
      expect(rule).toContain(`padding: var(--surface-pad-${size})`)
    }
  })

  /**
   * Every size also names its padding as `--card-pad` (Story #186, DDR-0059). The header strip
   * cancels the card's inline padding and re-applies it as its own, so the rule that bleeds it out
   * to the card's edges has to know a length that only the *size* rules carry — and a shorthand
   * cannot be read back off the box. Stated in all three rather than defaulted on `.card`, so a
   * size is one place to read; a size that grows a padding and forgets the variable would draw its
   * strip at the wrong width, which is the failure this catches.
   */
  it('names each size’s padding again as --card-pad, for the strip to bleed against', () => {
    for (const size of CARD_SIZES) {
      const rule = new RegExp(`^\\.card-${size} \\{([^}]*)\\}`, 'm').exec(CSS)?.[1] ?? ''
      expect(rule, size).toContain(`--card-pad: var(--surface-pad-${size})`)
    }
  })

  /**
   * The ruled header strip (Story #186, DDR-0059), and the property that makes it one treatment
   * rather than two: a card states its title either as a `CardHeader` or as a bare `CardTitle`,
   * and the reader must not be able to tell which. Both selectors carry the same three
   * declarations, in one rule, for the same reason the figure role is one rule (DDR-0053).
   */
  it('draws one strip, for a header and for a bare title alike', () => {
    const strip =
      /^\.card-header,\n\.card > \.card-title:not\(:last-child\) \{([^}]*)\}/m.exec(CSS)?.[1] ?? ''
    expect(strip).not.toBe('')
    expect(strip).toContain('border-bottom: 1px solid var(--border)')
    // Out to both edges and back again: the negative margin is the card's own padding.
    expect(strip).toContain('margin: calc(-1 * var(--card-pad)) calc(-1 * var(--card-pad))')
    expect(strip).toContain('padding: var(--space-5) var(--card-pad)')
  })

  /**
   * A header that is the whole card — the import panel before anything has been imported — is not
   * a strip: there is no body for it to be divided from, so it gives all three back. Without this
   * the panel would carry a rule across its bottom edge with nothing beneath it.
   */
  it('un-draws the strip where the header is the whole card', () => {
    const rule = /^\.card-header:last-child \{([^}]*)\}/m.exec(CSS)?.[1] ?? ''
    expect(rule).toContain('margin: 0')
    expect(rule).toContain('padding: 0')
    expect(rule).toContain('border-bottom: none')
  })

  /** The title sits *on* the strip now, so it carries the page's ink rather than the muted tone. */
  it('gives the title full ink at the semibold weight', () => {
    const rule = /^\.card-title \{([^}]*)\}/m.exec(CSS)?.[1] ?? ''
    expect(rule).toContain('color: var(--text)')
    expect(rule).toContain('font-weight: 600')
    expect(rule).toContain('font-size: var(--text-sm)')
  })

  it('leaves the focus ring to the base rule, so no card can ring differently', () => {
    const cardRules = [...CSS.matchAll(/^\.card[\w-]*[^{]*\{([^}]*)\}/gm)].map((m) => m[1] ?? '')
    expect(cardRules.length).toBeGreaterThan(0)
    expect(cardRules.filter((body) => body.includes('outline'))).toEqual([])
  })
})

/**
 * The five surfaces the primitive replaced, plus the two heading and header rules that went
 * with them. Epic #125's stated risk is a consolidation that stalls half-done, leaving a
 * primitive beside the rules it was meant to retire — worse than either end state.
 *
 * `.state-panel` is the one survivor and is deliberately not listed: the *surface* half of it
 * is gone, and what remains (muted prose, the notice and error variants) belongs to the
 * `StatePanel` story, #133.
 */
describe('the superseded card surfaces are gone', () => {
  it.each([
    '.panel',
    '.allocation {',
    '.snapshot-history',
    '.highlight-card',
    '.flex-import {',
  ])('%s no longer appears in the stylesheet', (selector) => {
    expect(RULES).not.toContain(selector)
  })

  it('leaves .state-panel carrying no surface declarations of its own', () => {
    const rule = /^\.state-panel \{([^}]*)\}/m.exec(CSS)?.[1] ?? ''
    expect(rule).not.toBe('')
    for (const declaration of ['padding', 'background', 'border']) {
      expect(rule).not.toContain(declaration)
    }
  })
})
