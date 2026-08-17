import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { figureRoleSelectors } from './figureRole'
import {
  DEFAULT_STAT_TONE,
  STAT_PARTS,
  STAT_TONES,
  TONED_STAT_TONES,
  statPartClassName,
  statRowClassName,
  toneClassName,
  toneOf,
} from './statTileVariants'

/**
 * The `StatTile` primitive's contract (Story #129, DDR-0034).
 *
 * Same two halves as the button's and the card's tests, plus one this primitive needs and they
 * did not: a tone is the *only* thing that colours a figure, so the stylesheet is asserted to
 * resolve it to `--pos` / `--neg` exactly (DDR-0021's carve-out), and `neutral` is asserted to
 * have no rule at all — a `.stat-neutral` colour would silently override the ink of every table
 * cell and popup row the helper also serves.
 */

const CSS = readFileSync(new URL('../app.css', import.meta.url), 'utf8')

/**
 * The stylesheet with its comments removed. The "gone" assertions below read this rather than
 * `CSS`: the primitive's own comment block names the rules it replaced, which is the
 * documentation worth keeping and would otherwise fail the test.
 */
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

/** Whether the stylesheet declares a rule whose selector starts with this exact class. */
function declaresRule(selector: string): boolean {
  return new RegExp(`^\\s*\\${selector}[\\s,:{]`, 'm').test(CSS)
}

/** The declarations inside a single-selector rule. */
function ruleBody(selector: string): string {
  return new RegExp(`^\\${selector} \\{([^}]*)\\}`, 'm').exec(CSS)?.[1] ?? ''
}

describe('toneOf', () => {
  it('reads the polarity of a signed figure', () => {
    expect(toneOf(1200.5)).toBe('positive')
    expect(toneOf(-0.01)).toBe('negative')
  })

  it('treats zero — and negative zero — as neutral rather than a loss', () => {
    expect(toneOf(0)).toBe('neutral')
    expect(toneOf(-0)).toBe('neutral')
    expect(toneOf(0)).toBe(DEFAULT_STAT_TONE)
  })
})

describe('toneClassName', () => {
  it('emits a class for a toned figure', () => {
    expect(toneClassName('positive')).toBe('stat-positive')
    expect(toneClassName('negative')).toBe('stat-negative')
  })

  it('emits nothing for a neutral figure, so it keeps the ink it inherits', () => {
    expect(toneClassName('neutral')).toBe('')
  })

  it('composes with the class the element already carries', () => {
    expect(toneClassName('positive', 'num')).toBe('stat-positive num')
    expect(toneClassName('negative', 'highlight-value')).toBe('stat-negative highlight-value')
  })

  it('leaves a neutral cell with only its own class — never a stray space', () => {
    expect(toneClassName('neutral', 'num')).toBe('num')
  })
})

describe('statRowClassName and statPartClassName', () => {
  it('composes the row', () => {
    expect(statRowClassName()).toBe('stat-row')
    expect(statRowClassName('balances-wide')).toBe('stat-row balances-wide')
  })

  it('composes a single-class part', () => {
    expect(statPartClassName('label')).toBe('stat-label')
    expect(statPartClassName('hint')).toBe('stat-hint')
  })

  it('carries the tone on the value, and nothing extra when it is neutral', () => {
    expect(statPartClassName('value', toneClassName('negative'))).toBe('stat-value stat-negative')
    expect(statPartClassName('value', toneClassName('neutral'))).toBe('stat-value')
  })
})

describe('the stylesheet backs every declared part and tone', () => {
  it.each(STAT_PARTS)('declares a rule for part "%s"', (part) => {
    expect(declaresRule(`.stat-${part}`)).toBe(true)
  })

  it.each(TONED_STAT_TONES)('declares a rule for tone "%s"', (tone) => {
    expect(declaresRule(`.stat-${tone}`)).toBe(true)
  })

  it('declares the row grid', () => {
    expect(ruleBody('.stat-row')).toContain('repeat(auto-fit, minmax(11rem, 1fr))')
  })

  it('leaves the neutral tone without a rule — it is the absence of a tone, not a colour', () => {
    expect(STAT_TONES).toContain('neutral')
    expect(declaresRule('.stat-neutral')).toBe(false)
  })

  it('colours the tones with --pos / --neg-text, the DDR-0021 carve-out', () => {
    // The negative tone reads `--neg-text`, not `--neg`, since Story #163. `--neg` measured
    // 3.62:1 on `--card` — below AA — while `--pos` passed at 5.19:1, so every loss was less
    // legible than every gain. It could not simply be lightened: `--neg` is also a fill under
    // white text (`.btn-danger:hover`), so the tone split instead. `--neg` keeps its
    // CVD-validated value and all five fill uses; `--neg-text` carries the two text uses.
    // The thresholds themselves live in `contrast.test.ts`.
    expect(ruleBody('.stat-positive')).toContain('color: var(--pos)')
    expect(ruleBody('.stat-negative')).toContain('color: var(--neg-text)')
  })

  it('keeps figures on tabular numerals, so a column of them lines up', () => {
    // The declaration moved out of this rule in Story #180: `tabular-nums` only does its job
    // beside the mono family and the negative tracking, so all three are applied together by the
    // figure role (DDR-0053). The guarantee is unchanged and the assertion follows it — a tile's
    // figure is still asserted to be a figure, now by membership rather than by declaration.
    // `figureRole.test.ts` pins what the role itself declares.
    expect(figureRoleSelectors(CSS)).toContain('.stat-value')
    expect(ruleBody('.stat-value')).not.toContain('font-variant-numeric')
  })

  it('sizes every line from the type scale, never a raw length', () => {
    expect(ruleBody('.stat-value')).toContain('font-size: var(--text-xl)')
    expect(ruleBody('.stat-label')).toContain('font-size: var(--text-xs)')
    expect(ruleBody('.stat-hint')).toContain('font-size: var(--text-xs)')
  })

  it('leaves the surface to the card: no stat rule redeclares one', () => {
    const statRules = [...CSS.matchAll(/^\.stat-[\w-]*[^{]*\{([^}]*)\}/gm)].map((m) => m[1] ?? '')
    expect(statRules.length).toBeGreaterThan(0)
    for (const declaration of ['background', 'border', 'padding', 'outline']) {
      expect(statRules.filter((body) => body.includes(declaration))).toEqual([])
    }
  })
})

/**
 * What the primitive replaced. Epic #125's standing risk is a consolidation that stalls
 * half-done, leaving a primitive beside the rules it was meant to retire.
 *
 * `.stat-tile` is on the list beside `.balance-tile`: the tile's surface is entirely the card's,
 * so the two collapse to *no* rule rather than to one.
 */
describe('the superseded tile rules are gone', () => {
  it.each([
    '.balances',
    '.balance-tile',
    '.balance-label',
    '.balance-value',
    '.stat-tile',
    '.highlight-label',
  ])('%s no longer appears in the stylesheet', (selector) => {
    expect(RULES).not.toContain(selector)
  })
})
