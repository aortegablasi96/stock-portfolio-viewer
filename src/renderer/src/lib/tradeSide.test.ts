import { describe, expect, it } from 'vitest'
import { SIDE_VARIANTS, sideVariant, type TradeSide } from './tradeSide'
import { BADGE_VARIANTS, TONED_BADGE_VARIANTS, badgeClassName } from './badgeVariants'

/**
 * The side tone (Story #257, DDR-0086).
 *
 * A real test rather than a text scan, which is most of why the mapping is a module at all: the
 * decision DDR-0065 made and DDR-0086 reverses is two entries wide, and `tradesLayout.test.ts` can
 * only ever assert that the view *reaches* them. What has to hold about the entries themselves —
 * that they are the toned pair and not a new variant, that they are distinct, that the mapping
 * covers every side the service can emit — is arithmetic over exported values and belongs here.
 */
describe('the trade side names a badge tone', () => {
  const SIDES: TradeSide[] = ['Buy', 'Sell']

  /** The reversal itself, stated in the one place it is written (DDR-0086). */
  it('gives Buy the gain tone and Sell the loss tone', () => {
    expect(sideVariant('Buy')).toBe('positive')
    expect(sideVariant('Sell')).toBe('negative')
  })

  /**
   * The acceptance criterion `BADGE_VARIANTS` cannot state for itself: this column spends the pair
   * Story #192 already added (DDR-0064) and invents nothing. If a later story reached for a
   * `buy` / `sell` variant, the badge's axes would have grown for a call site rather than for a
   * meaning, which is the thing DDR-0037 refuses.
   */
  it('spends the existing toned pair rather than a variant of its own', () => {
    for (const side of SIDES) {
      expect(TONED_BADGE_VARIANTS).toContain(sideVariant(side))
    }
    expect(BADGE_VARIANTS).toHaveLength(5)
  })

  /**
   * Two sides, two tones, and the tones differ — a mapping that answered the same variant for both
   * would type-check, render, and leave the column exactly as it was while every guard passed.
   */
  it('tones the two sides differently', () => {
    expect(sideVariant('Buy')).not.toBe(sideVariant('Sell'))
  })

  /**
   * Totality. The `Record` makes a missing side a compile error, which no test can observe — what
   * a test *can* observe is that nothing extra crept in, so the mapping cannot grow a third key
   * that no side reaches and no rule renders.
   */
  it('covers exactly the sides the service derives, and no others', () => {
    expect(Object.keys(SIDE_VARIANTS).sort()).toEqual([...SIDES].sort())
  })

  /**
   * The tone reaches the class list the primitive composes, which is what the call site actually
   * ships. Asserted through `badgeClassName` rather than by string-building here, so this test
   * fails if the badge's composition changes under it (DDR-0037).
   */
  it('composes into the badge class the cell renders', () => {
    expect(badgeClassName(sideVariant('Buy'), 'sm', 'badge-cell')).toBe(
      'badge badge-positive badge-sm badge-cell',
    )
    expect(badgeClassName(sideVariant('Sell'), 'sm', 'badge-cell')).toBe(
      'badge badge-negative badge-sm badge-cell',
    )
  })
})
