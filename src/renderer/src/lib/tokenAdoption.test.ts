import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CssDeclaration } from './cssDeclarations'
import {
  BASELINE,
  EXEMPTIONS,
  findViolations,
  isGuardedProperty,
  isViolation,
  rawLengths,
  readTokens,
  scaleFor,
  suggestToken,
} from './tokenAdoption'

/**
 * The token-adoption ratchet (Story #151).
 *
 * Like `designTokens.test.ts`, the subject here is the stylesheet rather than a module — but
 * where that one pins the *shape* of the scales, this pins their *use*. Together they are what
 * stops Epic #125 from being undone the way the styling was built up: one defensible decision at
 * a time.
 *
 * The three contract assertions below are the whole point, and the second and third are what make
 * this a ratchet rather than a suppression file.
 */

const CSS = readFileSync(new URL('../app.css', import.meta.url), 'utf8')

/** A synthetic declaration, for the unit tests that should not depend on the real stylesheet. */
function decl(context: string, property: string, value: string): CssDeclaration {
  return { context, property, value, line: 1, key: `${context} | ${property}` }
}

describe('guarded properties', () => {
  it.each([
    'padding',
    'padding-top',
    'padding-inline',
    'padding-inline-start',
    'margin',
    'margin-bottom',
    'gap',
    'row-gap',
    'column-gap',
    'font-size',
    'border-radius',
    'border-top-left-radius',
  ])('guards %s', (property) => {
    expect(isGuardedProperty(property)).toBe(true)
  })

  it.each(['color', 'width', 'stroke-width', 'line-height', 'border-width', 'inset'])(
    'does not guard %s',
    (property) => {
      expect(isGuardedProperty(property)).toBe(false)
    },
  )

  it('routes each property to the scale it draws from', () => {
    expect(scaleFor('gap')).toBe('space')
    expect(scaleFor('margin-top')).toBe('space')
    expect(scaleFor('font-size')).toBe('text')
    expect(scaleFor('border-radius')).toBe('radius')
    expect(scaleFor('border-top-left-radius')).toBe('radius')
  })
})

describe('raw lengths', () => {
  it('ignores zero, which needs no token', () => {
    expect(rawLengths('0')).toEqual([])
    expect(rawLengths('0 0')).toEqual([])
    expect(rawLengths('0px')).toEqual([])
  })

  it('still catches the real value in a shorthand that starts with zero', () => {
    expect(rawLengths('0 0 0.35rem')).toEqual([5.6])
  })

  it('ignores lengths already inside a var()', () => {
    expect(rawLengths('var(--space-4)')).toEqual([])
    expect(rawLengths('var(--control-pad-sm)')).toEqual([])
  })

  it('catches the mixed case: a token beside a hand-picked value', () => {
    // `.mapboxgl-popup-content` really declares this.
    expect(rawLengths('var(--popup-pad-y) 0.7rem')).toEqual([11.2])
  })

  it('passes calc() built from a token, and fails calc() hiding a raw length', () => {
    expect(rawLengths('calc(var(--space-4) * 2)')).toEqual([])
    expect(rawLengths('calc(100% - 1rem)')).toEqual([16])
  })

  it('ignores units no token can express', () => {
    expect(rawLengths('50%')).toEqual([])
    expect(rawLengths('auto')).toEqual([])
    expect(rawLengths('1fr')).toEqual([])
  })

  it('treats a negative length as real, so an optical nudge is still caught', () => {
    expect(rawLengths('-0.5rem')).toEqual([-8])
  })
})

describe('violations', () => {
  it('is a violation only when a guarded property carries a raw length', () => {
    expect(isViolation(decl('.a', 'gap', '1rem'))).toBe(true)
    expect(isViolation(decl('.a', 'gap', 'var(--space-5)'))).toBe(false)
    expect(isViolation(decl('.a', 'color', '1rem'))).toBe(false)
    expect(isViolation(decl('.a', 'padding', '0'))).toBe(false)
  })
})

describe('token suggestions', () => {
  it('reads each scale out of :root', () => {
    expect(readTokens(CSS, 'space').map((t) => t.px)).toEqual([4, 6, 8, 12, 16, 20, 24, 32])
    expect(readTokens(CSS, 'radius').map((t) => t.name)).toEqual([
      '--radius-sm',
      '--radius-md',
      '--radius-lg',
    ])
  })

  it('leaves out the composite and shape tokens, which are not steps', () => {
    const names = readTokens(CSS, 'space').map((t) => t.name)
    expect(names.some((n) => n.includes('control-pad'))).toBe(false)
    expect(readTokens(CSS, 'radius').map((t) => t.name)).not.toContain('--radius-pill')
  })

  it('names the nearest step for each distinct length', () => {
    expect(suggestToken(decl('.a', 'gap', '1rem'), CSS)).toBe('16px → --space-5')
    expect(suggestToken(decl('.a', 'padding', '0.6rem 0.9rem'), CSS)).toBe(
      '9.6px → --space-3, 14.4px → --space-5',
    )
  })

  it('says nothing when there is nothing to suggest', () => {
    expect(suggestToken(decl('.a', 'gap', 'var(--space-5)'), CSS)).toBeNull()
  })
})

/**
 * The contract. These three run against the real stylesheet.
 */
describe('app.css token adoption', () => {
  const violations = findViolations(CSS)
  const listed = new Map(
    [...BASELINE, ...EXEMPTIONS].map((entry) => [entry.key, entry.value] as const),
  )

  it('has every raw value either baselined or exempted', () => {
    const unlisted = violations.filter(
      (v) => !listed.has(v.key) || listed.get(v.key) !== v.value,
    )
    const report = unlisted.map(
      (v) =>
        `app.css:${v.line}  ${v.key} = ${v.value}` +
        `\n    use a token instead (${suggestToken(v, CSS) ?? 'no nearby step'}),` +
        `\n    or add it to EXEMPTIONS in tokenAdoption.ts with a reason.`,
    )
    expect(report, `\n${report.join('\n')}\n`).toEqual([])
  })

  it('has no baseline entry that stopped matching — the list may only shrink', () => {
    const current = new Map(violations.map((v) => [v.key, v.value] as const))
    const dead = BASELINE.filter(
      (entry) => current.get(entry.key) !== entry.value,
    ).map((entry) => `${entry.key} = ${entry.value}`)
    expect(
      dead,
      `\nThese baseline entries no longer match app.css. If you converted them, delete them:\n${dead.join('\n')}\n`,
    ).toEqual([])
  })

  it('has no exemption that stopped matching', () => {
    const current = new Map(violations.map((v) => [v.key, v.value] as const))
    const dead = EXEMPTIONS.filter(
      (entry) => current.get(entry.key) !== entry.value,
    ).map((entry) => `${entry.key} = ${entry.value}`)
    expect(dead, `\nThese exemptions no longer match app.css:\n${dead.join('\n')}\n`).toEqual([])
  })

  it('gives every exemption a reason, since it is permanent', () => {
    for (const entry of EXEMPTIONS) {
      expect(entry.reason.length, `${entry.key} has no reason`).toBeGreaterThan(20)
    }
  })

  it('holds the two lists at their reviewed size', () => {
    // Not a target to chase: it makes an unreviewed bulk change to either list visible in a diff.
    // #152 emptied BASELINE, so it stays at 0; EXEMPTIONS only moves with a recorded reason.
    expect({ baseline: BASELINE.length, exemptions: EXEMPTIONS.length }).toEqual({
      baseline: 0,
      exemptions: 11,
    })
  })

  it('keeps every primitive free of raw values, which Round 1 achieved', () => {
    const primitive =
      /^\.(btn|card|stat-|badge|field|control|toggle-|state-panel|data-table|table-scroll)/
    const inPrimitives = violations.filter((v) =>
      v.context.split(' >> ').some((part) => primitive.test(part.trim())),
    )
    expect(inPrimitives.map((v) => v.key)).toEqual([])
  })
})
