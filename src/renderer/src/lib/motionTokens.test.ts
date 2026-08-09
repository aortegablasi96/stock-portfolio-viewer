import { describe, expect, it } from 'vitest'

import { scanDeclarations } from './cssDeclarations'
import {
  findViolations,
  isMotionProperty,
  namesADuration,
  rawDurations,
  rawEasings,
} from './motionTokens'

/**
 * The scanner behind the motion contract (Story #154, DDR-0044).
 *
 * `designTokens.test.ts` points it at the real `app.css` and asserts the result is empty. This
 * file asserts it would not be empty if the stylesheet drifted — a guard nobody has watched fail
 * is a guard nobody knows works, and the failure modes here are all "a regex quietly matched
 * nothing".
 */

/** The single declaration in a one-rule stylesheet. */
function only(css: string) {
  const declarations = scanDeclarations(css)
  expect(declarations).toHaveLength(1)
  return declarations[0]!
}

describe('rawDurations', () => {
  it('finds a time in either unit, and ignores one inside a var()', () => {
    expect(rawDurations('opacity 120ms ease-out')).toEqual(['120ms'])
    expect(rawDurations('opacity 0.2s ease-out')).toEqual(['0.2s'])
    expect(rawDurations('opacity var(--duration-fast) var(--ease-out)')).toEqual([])
  })

  it('finds the time in a mixed value, which is the case a shorthand invites', () => {
    expect(rawDurations('opacity var(--duration-fast), stroke 120ms')).toEqual(['120ms'])
  })
})

describe('rawEasings', () => {
  it('finds keywords and functions, and ignores one inside a var()', () => {
    expect(rawEasings('opacity 120ms ease')).toEqual(['ease'])
    expect(rawEasings('opacity 120ms ease-in-out')).toEqual(['ease-in-out'])
    expect(rawEasings('opacity 120ms cubic-bezier(0, 0, 0.58, 1)')).toEqual([
      'cubic-bezier(0, 0, 0.58, 1)',
    ])
    expect(rawEasings('opacity var(--duration-fast) var(--ease-out)')).toEqual([])
  })

  it('does not mistake an animation name for an easing', () => {
    expect(rawEasings('map-popup-in var(--duration-base) var(--ease-out)')).toEqual([])
  })
})

describe('isMotionProperty', () => {
  it('covers the longhands as well as the shorthand', () => {
    for (const property of [
      'transition',
      'transition-duration',
      'transition-timing-function',
      'animation',
      'animation-duration',
    ]) {
      expect(isMotionProperty(property), property).toBe(true)
    }
  })

  it('leaves the scroll timeline and the mask alone', () => {
    // `animation-timeline: scroll(self block)` carries no time, and `mask-image` is where the one
    // `linear-gradient` in the stylesheet lives — scanning only motion properties is what keeps
    // that gradient from reading as an easing.
    expect(isMotionProperty('animation-timeline')).toBe(false)
    expect(isMotionProperty('mask-image')).toBe(false)
  })
})

describe('namesADuration', () => {
  it('accepts a duration token and rejects a shorthand with no time at all', () => {
    expect(namesADuration(only('.a { transition: opacity var(--duration-fast); }'))).toBe(true)
    // Falls back to 0s, which reads as "no motion" but is a value nobody chose — and, once the
    // reduced-motion rule works by zeroing tokens, a rule the reader's preference cannot reach.
    expect(namesADuration(only('.a { transition: opacity; }'))).toBe(false)
  })

  it('exempts the timing-function longhands, which carry no duration by definition', () => {
    expect(namesADuration(only('.a { transition-timing-function: var(--ease-out); }'))).toBe(true)
  })
})

describe('findViolations', () => {
  it.each([
    ['a raw duration', '.a { transition: opacity 120ms var(--ease-out); }'],
    ['a raw easing', '.a { transition: opacity var(--duration-fast) ease-out; }'],
    ['a raw longhand duration', '.a { animation-duration: 120ms; }'],
    ['a shorthand naming no duration', '.a { transition: opacity; }'],
  ])('fails %s', (_case, css) => {
    expect(findViolations(css)).toHaveLength(1)
  })

  it('passes a fully tokenised declaration', () => {
    expect(
      findViolations('.a { transition: opacity var(--duration-fast) var(--ease-out); }'),
    ).toEqual([])
  })

  it('passes the scroll-driven fade, which is the one exemption', () => {
    expect(
      findViolations(
        '.data-table-scroll-capped { animation: table-rows-fade var(--ease-linear) both; }',
      ),
    ).toEqual([])
  })

  it('still fails the exempt rule if it grows a duration', () => {
    // The exemption is keyed on the declaration *and* its value, so it covers the absent duration
    // it was granted for and nothing else.
    expect(
      findViolations(
        '.data-table-scroll-capped { animation: table-rows-fade 120ms linear both; }',
      ),
    ).toHaveLength(1)
  })
})
