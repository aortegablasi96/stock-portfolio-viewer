import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TOGGLE_MODE,
  TOGGLE_MODES,
  toggleGroupClassName,
  toggleItemClassName,
} from './toggleGroupVariants'

/**
 * The `ToggleGroup` contract (Story #131, DDR-0036).
 *
 * Same two halves as the button's, card's and field's tests (DDR-0032, DDR-0033, DDR-0035),
 * and the second half is again the one worth having: a mode with no rule behind it renders as
 * an unstyled row of buttons and nothing else in the toolchain notices. So this reads
 * `app.css`, and also asserts that the five rules the primitive replaced are gone rather than
 * left orphaned beside it, which is Epic #125's standing risk.
 */

const CSS = readFileSync(new URL('../app.css', import.meta.url), 'utf8')

/**
 * The stylesheet with its comments removed. The "gone" assertions below have to read this
 * rather than `CSS`: the primitive's own comment block names the rules it replaced, which is
 * exactly the documentation worth keeping and would otherwise fail the test.
 */
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

/** Whether the stylesheet declares a rule whose selector starts with this exact class. */
function declaresRule(selector: string): boolean {
  return new RegExp(`^\\s*\\${selector}[\\s,:{]`, 'm').test(CSS)
}

describe('toggleGroupClassName', () => {
  /**
   * The wrapper carries no mode class on purpose — the group is the same flex row either way.
   * Pinned because the tempting symmetry is to emit one and then declare an empty rule for it.
   */
  it('is the mode-free wrapper', () => {
    expect(toggleGroupClassName()).toBe('toggle-group')
  })

  it('appends a caller’s className last, so a call site extends rather than forks', () => {
    expect(toggleGroupClassName('range-presets')).toBe('toggle-group range-presets')
  })

  it('omits an absent or empty className rather than emitting a stray space', () => {
    expect(toggleGroupClassName(undefined)).toBe('toggle-group')
    expect(toggleGroupClassName('')).toBe('toggle-group')
  })
})

describe('toggleItemClassName', () => {
  it('composes base and mode, and adds the active class only when selected', () => {
    expect(toggleItemClassName('single', false)).toBe('toggle-item toggle-item-single')
    expect(toggleItemClassName('single', true)).toBe(
      'toggle-item toggle-item-single toggle-item-active',
    )
    expect(toggleItemClassName('multiple', true)).toBe(
      'toggle-item toggle-item-multiple toggle-item-active',
    )
  })

  it('defaults to single select unselected — the mode four of the five groups use', () => {
    expect(DEFAULT_TOGGLE_MODE).toBe('single')
    expect(toggleItemClassName()).toBe(`toggle-item toggle-item-${DEFAULT_TOGGLE_MODE}`)
  })

  it('appends a caller’s className last', () => {
    expect(toggleItemClassName('multiple', false, 'wide')).toBe(
      'toggle-item toggle-item-multiple wide',
    )
  })
})

describe('the stylesheet backs every declared mode', () => {
  it.each(TOGGLE_MODES)('declares an item rule for mode "%s"', (mode) => {
    expect(declaresRule(`.toggle-item-${mode}`)).toBe(true)
  })

  it('declares the shared base rules', () => {
    expect(CSS).toMatch(/^\.toggle-group \{/m)
    expect(CSS).toMatch(/^\.toggle-item \{/m)
    expect(CSS).toMatch(/^\.toggle-item-active \{/m)
  })

  it('takes the item’s padding and type from the scale, never a raw length', () => {
    const rule = /^\.toggle-item \{([^}]*)\}/m.exec(CSS)?.[1] ?? ''
    expect(rule).toContain('padding: var(--control-pad-sm)')
    expect(rule).toContain('font-size: var(--text-xs)')
  })

  /**
   * The mode's whole visual job, and the reason the base rule declares no corner: neither mode
   * is the silent default of the other, so a mode that stops declaring one is a bug the test
   * sees rather than a shape that quietly falls back.
   */
  it('makes the corner the mode’s own declaration, from the radius scale', () => {
    const base = /^\.toggle-item \{([^}]*)\}/m.exec(CSS)?.[1] ?? ''
    expect(base).not.toContain('border-radius')
    expect(/^\.toggle-item-single \{([^}]*)\}/m.exec(CSS)?.[1] ?? '').toContain(
      'border-radius: var(--radius-md)',
    )
    expect(/^\.toggle-item-multiple \{([^}]*)\}/m.exec(CSS)?.[1] ?? '').toContain(
      'border-radius: var(--radius-pill)',
    )
  })

  /**
   * DDR-0029's rule, applied here: the tab shell's active tab carries a bar as well as the
   * accent because "accent text on an accent-bordered box" is two cues that are both colour.
   * The doubled stroke is this control's equivalent — presence or absence of a thickening,
   * which survives any palette.
   */
  it('marks the active item by more than colour alone', () => {
    const rule = /^\.toggle-item-active \{([^}]*)\}/m.exec(CSS)?.[1] ?? ''
    expect(rule).toContain('box-shadow: inset 0 0 0 1px var(--accent)')
  })

  it('leaves the focus ring to the base rule, so no group can ring differently', () => {
    const ruleBodies = [...CSS.matchAll(/^\.toggle-(?:group|item)[\w-]*[^{]*\{([^}]*)\}/gm)].map(
      (m) => m[1] ?? '',
    )
    expect(ruleBodies.length).toBeGreaterThan(0)
    expect(ruleBodies.filter((body) => body.includes('outline'))).toEqual([])
  })
})

/**
 * The rules the primitive replaced. Epic #125's stated risk is a consolidation that stalls
 * half-done, leaving a primitive beside the rules it was meant to retire — worse than either
 * end state.
 *
 * `.chart-tab` is the one worth naming: it is the class the audit called "a control invented
 * twice", and it was in fact invented five times. A grep for it has to come back empty, or the
 * next view will borrow it a sixth.
 */
describe('the superseded toggle rules are gone', () => {
  it.each(['.chart-tabs', '.chart-tab', '.chart-tab-active', '.type-filter'])(
    '%s no longer appears in the stylesheet',
    (selector) => {
      expect(RULES).not.toContain(selector)
    },
  )

  /** `.app-tab` is deliberately *not* folded in: it is a real tablist (DDR-0029). */
  it('leaves the app tab bar alone', () => {
    expect(declaresRule('.app-tab')).toBe(true)
  })
})
