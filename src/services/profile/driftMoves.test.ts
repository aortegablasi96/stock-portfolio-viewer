import { describe, expect, it } from 'vitest'
import { driftMove, MAX_MOVE_CONTRIBUTORS, type BandPosition } from './driftMoves'

/**
 * Sizing a drift-closing move (Story #287, DDR-0103).
 *
 * **This file is DDR-0095's guarantee extended one step.** `balanceDriftService.test.ts` asserts
 * that no model measures the drift; these assert that no model closes one. Everything a proposal
 * later says — how many points move, which positions carry them, what is left over — is a number
 * computed here, so a wrong number here is a wrong suggestion that reads exactly like a right one.
 *
 * Four properties carry the weight of the story, and each has its own block: the split expresses no
 * opinion, capacity is a hard stop, the owner's ceiling binds, and what cannot be carried is
 * *stated* rather than pushed onto whatever had room.
 */

const position = (symbol: string, weight: number): BandPosition => ({ symbol, name: null, weight })

describe('driftMove', () => {
  it('has nothing to propose for a band already inside its range', () => {
    expect(driftMove('inside', 0, [position('AAA', 40)], null)).toBeNull()
  })

  describe('the split expresses no opinion', () => {
    it('spreads a trim in proportion to what each position already holds', () => {
      const move = driftMove('above', 10, [position('AAA', 40), position('BBB', 15)], null)

      // 40 : 15 of ten points. Proportional keeps the band's internal shape — a largest-first
      // sweep would take all ten out of AAA, which is a ranking of the owner's holdings the app
      // has no basis to produce.
      expect(move?.direction).toBe('trim')
      expect(move?.points).toBe(10)
      expect(move?.contributors.map((c) => c.symbol)).toEqual(['AAA', 'BBB'])
      expect(move?.contributors[0]?.points).toBeCloseTo((40 / 55) * 10, 9)
      expect(move?.contributors[1]?.points).toBeCloseTo((15 / 55) * 10, 9)
      expect(move?.uncovered).toBe(0)
    })

    it('reports where each position lands, which is the end state nothing has to verify', () => {
      const move = driftMove('above', 10, [position('AAA', 40), position('BBB', 15)], null)

      for (const contributor of move?.contributors ?? []) {
        expect(contributor.resultingWeight).toBeCloseTo(contributor.weight - contributor.points, 9)
      }
      // The whole move is carried, so the band lands exactly on the edge it was measured against.
      const carried = (move?.contributors ?? []).reduce((sum, c) => sum + c.points, 0)
      expect(carried).toBeCloseTo(10, 9)
    })

    it('adds in the same proportion, in the other direction', () => {
      const move = driftMove('below', -6, [position('AAA', 20), position('BBB', 10)], null)

      expect(move?.direction).toBe('add')
      expect(move?.contributors[0]?.points).toBeCloseTo(4, 9)
      expect(move?.contributors[0]?.resultingWeight).toBeCloseTo(24, 9)
      expect(move?.contributors[1]?.resultingWeight).toBeCloseTo(12, 9)
      expect(move?.ceilingLimited).toBe(false)
    })
  })

  describe("the owner's concentration ceiling binds", () => {
    it('never takes a position above the ceiling while closing another dimension', () => {
      // One position at 10%, a ceiling of 15%: three points of room against fifteen to place.
      const move = driftMove('below', -15, [position('AAA', 10)], 13)

      expect(move?.contributors[0]?.points).toBeCloseTo(3, 9)
      expect(move?.contributors[0]?.resultingWeight).toBeCloseTo(13, 9)
      expect(move?.uncovered).toBeCloseTo(12, 9)
      expect(move?.ceilingLimited).toBe(true)
    })

    it('gives the room that exists to the positions that still have it before calling it uncovered', () => {
      // AAA is nearly at the ceiling and BBB is far below it. A single proportional pass would
      // leave AAA's overflow unplaced even though BBB could take all of it.
      const move = driftMove('below', -10, [position('AAA', 19), position('BBB', 6)], 20)

      expect(move?.uncovered).toBeCloseTo(0, 9)
      expect(move?.contributors[0]?.points).toBeCloseTo(1, 9)
      expect(move?.contributors[1]?.points).toBeCloseTo(9, 9)
      expect(move?.contributors[1]?.resultingWeight).toBeCloseTo(15, 9)
      expect(move?.ceilingLimited).toBe(false)
    })

    it('does not claim the ceiling bound a move where the owner set none', () => {
      const move = driftMove('below', -50, [position('AAA', 1)], null)

      expect(move?.uncovered).toBe(0)
      expect(move?.ceilingLimited).toBe(false)
    })
  })

  describe('what nothing can carry is stated, never spread', () => {
    it('carries no points at all where the owner holds nothing in the band', () => {
      // "I want 10% in utilities and hold none" — the answer is not a smaller move, it is a
      // different action, and only the owner can take it.
      const move = driftMove('below', -10, [], 20)

      expect(move?.contributors).toEqual([])
      expect(move?.candidates).toBe(0)
      expect(move?.uncovered).toBe(10)
      // Nothing was stopped by the ceiling: there was nothing to stop.
      expect(move?.ceilingLimited).toBe(false)
    })

    it('cannot trim more out of a position than the position holds', () => {
      const move = driftMove('above', 12, [position('AAA', 4), position('BBB', 3)], null)

      expect(move?.contributors[0]?.points).toBeCloseTo(4, 9)
      expect(move?.contributors[1]?.points).toBeCloseTo(3, 9)
      expect(move?.contributors[0]?.resultingWeight).toBeCloseTo(0, 9)
      expect(move?.uncovered).toBeCloseTo(5, 9)
    })

    it('ignores a position with no weight rather than dividing by it', () => {
      const move = driftMove('above', 5, [position('AAA', 0), position('BBB', 0)], null)

      expect(move?.contributors).toEqual([])
      expect(move?.uncovered).toBe(5)
    })
  })

  describe('the cap states itself', () => {
    it('names the largest few and reports how many are held in the band', () => {
      const positions = [
        position('AAA', 30),
        position('BBB', 20),
        position('CCC', 10),
        position('DDD', 5),
        position('EEE', 1),
      ]

      const move = driftMove('above', 6, positions, null)

      expect(move?.contributors).toHaveLength(MAX_MOVE_CONTRIBUTORS)
      expect(move?.contributors.map((c) => c.symbol)).toEqual(['AAA', 'BBB', 'CCC'])
      expect(move?.candidates).toBe(positions.length)
      // The named few carry the whole move; a proposal that hands most of its own size back as
      // unallocated is not a proposal.
      expect(move?.uncovered).toBe(0)
    })

    it('takes the largest positions whatever order they arrive in', () => {
      const move = driftMove(
        'above',
        4,
        [position('CCC', 10), position('AAA', 30), position('BBB', 20), position('DDD', 5)],
        null,
      )

      expect(move?.contributors.map((c) => c.symbol)).toEqual(['AAA', 'BBB', 'CCC'])
    })
  })

  it('carries no amount of money anywhere in what it produces', () => {
    // The `profile` category is declared as percentages only, so a figure in another unit here
    // would exceed what that category may carry (DDR-0098).
    const move = driftMove('above', 10, [position('AAA', 40), position('BBB', 15)], 25)

    expect(JSON.stringify(move)).not.toMatch(/€|\$|£/)
  })
})
