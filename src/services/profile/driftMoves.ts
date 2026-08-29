import type { DriftMove, DriftStatus, MoveContributor } from '@shared/domain/balanceDrift'

/**
 * Sizing the move that closes a band's gap (Story #287, DDR-0103).
 *
 * **This module exists for the same reason `balanceDriftService` does, one step further on.**
 * DDR-0095 kept the model out of measuring the drift; this keeps it out of closing one. Asked to
 * rebalance, a model will happily spread percentage points across positions and phrase the spread
 * as advice — and spreading points is arithmetic, which ADR-0009 forbids it. So the spread is
 * computed here, deterministically, and what the model receives is a move it can only narrate.
 *
 * It is kept **DB-free and dependency-free** for the reason `repositories/flex/fifoSummary.ts` is:
 * the service and its tests then share the real function rather than agreeing about one.
 *
 * ## Three decisions are worth reading before changing anything
 *
 * **The allocation is proportional, not greedy.** Points are spread across the band's positions in
 * proportion to what each already holds, so the band's internal shape survives the move. A
 * largest-first sweep would empty the biggest holding into the gap and call it a proposal — a
 * ranking of the owner's positions that the app has no basis whatsoever to produce. Proportional is
 * the one split that expresses no opinion, which is the only split this app is entitled to.
 *
 * **Capacity is a hard stop, and what does not fit is `uncovered`.** A trim cannot take more out of
 * a position than it holds; an add cannot push one past the owner's own concentration ceiling. When
 * either binds, the leftover is *reported* rather than pushed onto whatever still had room beyond
 * its share — the same rule that keeps a residual out of the weights it would otherwise flatter
 * (DDR-0052). One redistribution pass runs first, so capacity that genuinely exists is used before
 * anything is called uncovered.
 *
 * **A band with nothing held in it is the interesting case, not the degenerate one.** "I want 10%
 * in utilities and hold none" has no contributor to carry a single point, and the whole move comes
 * back uncovered with `candidates` at zero. That is the answer: closing it means buying something
 * the owner does not hold, which is a different sentence from trimming something they do.
 */

/** One held position as this module sees it: an identity and a weight, and no money. */
export interface BandPosition {
  symbol: string
  name: string | null
  /** Share of the placed portfolio, in percent. */
  weight: number
}

/**
 * How many positions one move names.
 *
 * A ceiling for `MAX_LISTED_POSITIONS`' reason — the prompt has one, and a context truncated by the
 * gateway is truncated arbitrarily — cut at a place that can be *stated*: the move says how many of
 * how many held positions it names. Three rather than a longer list because a proposal naming a
 * dozen positions is not a proposal; an owner acting on it would rather move three holdings than
 * twenty.
 *
 * The move is carried **entirely by the ones it names**, not spread over the whole band and then
 * truncated. Both readings are defensible and this one is the actionable half: a proposal that
 * hands back most of its own size as unallocated is not one. What the named few genuinely cannot
 * carry — because a trim would empty them, or the ceiling stops an add — is still `uncovered`,
 * which is the case the cap actually needs to be honest about.
 */
export const MAX_MOVE_CONTRIBUTORS = 3

/** Below this many percentage points a remainder is float noise, not a shortfall. */
const EPSILON = 0.000_001

/**
 * The move that closes one band, or `null` because the band is already inside its range.
 *
 * `distance` is the band's own signed distance to the nearer edge (negative below, positive above),
 * so the direction and the size are read off one number that `balanceDriftService` already computed
 * — there is no second opinion about how far out the band is.
 *
 * `ceiling` is the owner's single-position limit, or `null` where they set none. It only ever
 * *reduces* what a move proposes: no computed add takes a position past the ceiling while closing
 * some other dimension, which is the one interaction between two targets this app models.
 */
export function driftMove(
  status: DriftStatus,
  distance: number,
  positions: readonly BandPosition[],
  ceiling: number | null,
): DriftMove | null {
  if (status === 'inside') return null

  const direction = status === 'above' ? 'trim' : 'add'
  const points = Math.abs(distance)
  const ranked = [...positions].sort((a, b) => b.weight - a.weight)
  const listed = ranked.slice(0, MAX_MOVE_CONTRIBUTORS)

  // A trim can only give back what a position holds; an add can only fill the room the owner's own
  // ceiling leaves above it. With no ceiling stated there is no room to run out of.
  const capacityOf = (position: BandPosition): number =>
    direction === 'trim'
      ? Math.max(0, position.weight)
      : ceiling === null
        ? Number.POSITIVE_INFINITY
        : Math.max(0, ceiling - position.weight)

  const allocated = spread(points, listed, capacityOf)
  const carried = allocated.reduce((sum, value) => sum + value, 0)
  const uncovered = Math.max(0, points - carried)

  const contributors: MoveContributor[] = []
  listed.forEach((position, index) => {
    const share = allocated[index] ?? 0
    if (share <= EPSILON) return
    contributors.push({
      symbol: position.symbol,
      name: position.name,
      weight: position.weight,
      points: share,
      resultingWeight: direction === 'trim' ? position.weight - share : position.weight + share,
    })
  })

  return {
    direction,
    points,
    contributors,
    uncovered,
    // For an `add`, capacity is bounded by nothing *but* the ceiling — so a stated ceiling, a
    // position to add to, and points left over is exactly the ceiling having bound. Nothing else
    // can produce that combination, which is why this reads as a fact rather than a guess.
    ceilingLimited:
      direction === 'add' && ceiling !== null && listed.length > 0 && uncovered > EPSILON,
    candidates: positions.length,
  }
}

/**
 * Spread `points` across `positions` in proportion to their weights, capped by capacity.
 *
 * Runs until nothing is left to give or nobody is left with room, at most one pass per position
 * plus one: each pass either fills someone to capacity — which removes them — or finishes. The
 * bound is written rather than inferred, because a loop whose termination depends on floating-point
 * arithmetic is a loop that will one day not terminate.
 */
function spread(
  points: number,
  positions: readonly BandPosition[],
  capacityOf: (position: BandPosition) => number,
): number[] {
  const allocated = positions.map(() => 0)
  let pool = positions.map((_, index) => index).filter((index) => capacityOf(positions[index]!) > 0)
  let remaining = points

  for (let pass = 0; pass <= positions.length && remaining > EPSILON && pool.length > 0; pass++) {
    const totalWeight = pool.reduce((sum, index) => sum + positions[index]!.weight, 0)
    // Every remaining position weighs nothing, so there is no proportion to divide by. A zero-weight
    // position holds nothing to trim and is nothing to add *to* — the points stay uncovered.
    if (totalWeight <= 0) break

    let given = 0
    const next: number[] = []
    for (const index of pool) {
      const position = positions[index]!
      const room = capacityOf(position) - allocated[index]!
      const share = Math.min(remaining * (position.weight / totalWeight), room)
      allocated[index] = allocated[index]! + share
      given += share
      if (room - share > EPSILON) next.push(index)
    }

    remaining -= given
    if (given <= EPSILON) break
    pool = next
  }

  return allocated
}
