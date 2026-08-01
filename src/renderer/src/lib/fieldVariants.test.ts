import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CONTROL_KINDS,
  controlClassName,
  fieldClassName,
  fieldLabelClassName,
} from './fieldVariants'

/**
 * The `Field` / `Select` / `DateInput` contract (Story #130, DDR-0035).
 *
 * Same two halves as the button's and the card's tests (DDR-0032, DDR-0033), and the second is
 * again the one worth having: a kind with no rule behind it renders as an unstyled input and
 * nothing else in the toolchain notices. So this reads `app.css`, and also asserts that the
 * three rules the primitives replaced are gone rather than left orphaned beside them, which is
 * Epic #125's standing risk.
 */

const CSS = readFileSync(new URL('../app.css', import.meta.url), 'utf8')

/**
 * The stylesheet with its comments removed. The "gone" assertions below have to read this
 * rather than `CSS`: the primitive's own comment block names the three rules it replaced,
 * which is exactly the documentation worth keeping and would otherwise fail the test.
 */
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

/** Whether the stylesheet declares a rule whose selector starts with this exact class. */
function declaresRule(selector: string): boolean {
  return new RegExp(`^\\s*\\${selector}[\\s,:{]`, 'm').test(CSS)
}

describe('fieldClassName and fieldLabelClassName', () => {
  it('composes the field and its label', () => {
    expect(fieldClassName()).toBe('field')
    expect(fieldLabelClassName()).toBe('field-label')
  })

  it('appends a caller’s className last, so a call site extends rather than forks', () => {
    expect(fieldClassName('range-edge')).toBe('field range-edge')
  })

  it('omits an absent or empty className rather than emitting a stray space', () => {
    expect(fieldClassName(undefined)).toBe('field')
    expect(fieldClassName('')).toBe('field')
  })
})

describe('controlClassName', () => {
  it('composes base and kind', () => {
    expect(controlClassName('select')).toBe('control control-select')
    expect(controlClassName('date')).toBe('control control-date')
  })

  it('appends a caller’s className last', () => {
    expect(controlClassName('date', 'range-edge')).toBe('control control-date range-edge')
  })

  it('omits an absent or empty className', () => {
    expect(controlClassName('select', undefined)).toBe('control control-select')
    expect(controlClassName('select', '')).toBe('control control-select')
  })
})

describe('the stylesheet backs every declared kind', () => {
  it.each(CONTROL_KINDS)('declares a rule for kind "%s"', (kind) => {
    expect(declaresRule(`.control-${kind}`)).toBe(true)
  })

  it('declares the shared base rules', () => {
    expect(CSS).toMatch(/^\.control \{/m)
    expect(CSS).toMatch(/^\.field \{/m)
    expect(CSS).toMatch(/^\.field-label \{/m)
  })

  it('takes the control’s padding from the control scale, never a raw length', () => {
    const rule = /^\.control \{([^}]*)\}/m.exec(CSS)?.[1] ?? ''
    expect(rule).toContain('padding: var(--control-pad-sm)')
    expect(rule).toContain('border-radius: var(--radius-md)')
  })

  it('leaves the focus ring to the base rule, so no control can ring differently', () => {
    const ruleBodies = [...CSS.matchAll(/^\.(?:control|field)[\w-]*[^{]*\{([^}]*)\}/gm)].map(
      (m) => m[1] ?? '',
    )
    expect(ruleBodies.length).toBeGreaterThan(0)
    expect(ruleBodies.filter((body) => body.includes('outline'))).toEqual([])
  })

  it('gives the control the button’s disabled treatment rather than its own', () => {
    const control = /^\.control:disabled \{([^}]*)\}/m.exec(CSS)?.[1] ?? ''
    const button = /^\.btn:disabled \{([^}]*)\}/m.exec(CSS)?.[1] ?? ''
    expect(control.trim()).not.toBe('')
    expect(control.trim()).toBe(button.trim())
  })

  it('gives the control the outline button’s hover, so a control and a button agree', () => {
    const control = /^\.control:hover:not\(:disabled\) \{([^}]*)\}/m.exec(CSS)?.[1] ?? ''
    const button = /^\.btn-outline:hover:not\(:disabled\) \{([^}]*)\}/m.exec(CSS)?.[1] ?? ''
    expect(control.trim()).not.toBe('')
    expect(control.trim()).toBe(button.trim())
  })
})

/**
 * The three rules the primitives replaced. Epic #125's stated risk is a consolidation that
 * stalls half-done, leaving a primitive beside the rules it was meant to retire — worse than
 * either end state.
 *
 * `.range-custom .field-inline span` is the one worth naming: it existed *only* because the two
 * call sites labelled the same control shape two different ways, so a single technique deletes
 * it outright rather than renaming it.
 */
describe('the superseded control rules are gone', () => {
  it.each(['.select-control', '.field-inline', ".range-custom input[type='date']"])(
    '%s no longer appears in the stylesheet',
    (selector) => {
      expect(RULES).not.toContain(selector)
    },
  )
})
