/**
 * The Allocation map's gain/loss colour scale (Milestone M3, Story #95).
 *
 * The map can colour its circles two ways: by sector (the default, sharing the Sector donut's
 * palette) or by **unrealized return**. This module owns the second.
 *
 * Three decisions are baked in here rather than left to the component:
 *
 * 1. **Return as a percentage of cost basis, not absolute P&L.** Size already encodes market
 *    value — the mark's area, and each wedge's angle within it; colouring by absolute P&L would
 *    spend the colour channel re-encoding size, so a large holding barely up would outrank a small
 *    holding sharply down.
 * 2. **A fixed ±25% bound, clamped.** The same colour therefore means the same return in every
 *    session, and a single outsized winner can't wash the rest of the map pale. A data-driven
 *    range was rejected for exactly that instability.
 * 3. **Seven steps, three per arm around a neutral middle.** Discrete buckets read better than a
 *    continuous gradient on a mark a few dozen pixels across, and give the legend something to
 *    label.
 *
 * The palette is **red ↔ gray ↔ blue**, not the app's green/red `--pos` / `--neg` tokens. Measured
 * against the light basemap, green/red scores ΔE 4.1 under deuteranopia — below the 6.0 floor — and
 * on the map, fill colour is the *only* channel: no number sits beside a circle to fall back on.
 * Blue/red scores ΔE 23.8 and every step clears 3:1 on the basemap. `--pos` / `--neg` keep their
 * role wherever a figure accompanies them, including this map's own popup.
 *
 * Emits colour **classes**, never values, for the same reason `lib/countrySunbursts` does: resolving
 * one needs `getComputedStyle`, which does not exist in Vitest's Node environment.
 */

/** The scale's outer bound, as a percentage. Returns beyond ±this saturate at the pole. */
export const RETURN_BOUND = 25

/** Steps per arm, either side of the neutral middle. */
const STEPS_PER_ARM = 3

/** The neutral middle class — also what an uncomputable return wears. */
export const NEUTRAL_STEP = STEPS_PER_ARM + 1

/**
 * Unrealized return as a percentage of what was put in, or `null` when it cannot be computed.
 *
 * Divides by the **absolute** cost basis so the sign means the same thing for a short as for a
 * long: a short position carries a negative cost basis, and a gain on it is still a gain.
 *
 * A zero cost basis has no return to express — that is `null`, not 0%. Rendering it as flat would
 * paint a holding neutral and quietly assert something untrue about it.
 */
export function returnPercent(costBasisBase: number, unrealizedPnlBase: number): number | null {
  if (costBasisBase === 0) return null
  return (unrealizedPnlBase / Math.abs(costBasisBase)) * 100
}

/**
 * The 1–7 scale step for a return: 1 is the deepest loss, 4 neutral, 7 the strongest gain.
 *
 * An uncomputable return (`null`) takes the neutral step, which is why the popup states the return
 * in text — the colour alone cannot distinguish "flat" from "unknown", and shouldn't be asked to.
 */
export function divergingStep(pct: number | null): number {
  if (pct === null || pct === 0) return NEUTRAL_STEP
  const clamped = Math.max(-RETURN_BOUND, Math.min(RETURN_BOUND, pct))
  const arm = Math.min(STEPS_PER_ARM, Math.ceil((Math.abs(clamped) / RETURN_BOUND) * STEPS_PER_ARM))
  return pct > 0 ? NEUTRAL_STEP + arm : NEUTRAL_STEP - arm
}

/** CSS class for a scale step — resolved to a value by the component (see the module docblock). */
export function divergingClass(pct: number | null): string {
  return `map-diverge-${divergingStep(pct)}`
}

/** Every class on the scale, deepest loss first — the legend renders these in order. */
export const DIVERGING_CLASSES: string[] = Array.from(
  { length: STEPS_PER_ARM * 2 + 1 },
  (_, i) => `map-diverge-${i + 1}`,
)
