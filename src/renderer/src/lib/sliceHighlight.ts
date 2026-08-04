/**
 * The linked emphasis shared by an allocation breakdown's table and its donut (Story #147).
 *
 * The two halves are the same data twice — `groupTail` produces the slice set and
 * `sliceColorClasses` assigns the palette, so a slice wears the same hue in the table and the
 * chart. What was missing was the link between them: reconciling a wedge with its row meant
 * matching colours by eye against eight slots on a 200px donut.
 *
 * Kept out of the components because Vitest runs Node-only (DDR-0029). What is worth pinning is
 * not the pointer plumbing but the rule below: three states, keyed on identity rather than
 * position, so the link survives a re-sorted table (Story #134).
 */

/**
 * How one slice is drawn while the pair is linked.
 *
 * `resting` is the whole chart when nothing is hovered, and it is deliberately the *absence* of
 * emphasis rather than a third decoration — the same statement as `toneClassName('neutral')`
 * (DDR-0034). Muting the others is what makes the active one read: emphasising a wedge on its
 * own competes with seven neighbours at full strength.
 */
export const SLICE_EMPHASES = ['resting', 'active', 'muted'] as const

export type SliceEmphasis = (typeof SLICE_EMPHASES)[number]

/**
 * Which state `key` is in, given the slice the pointer or keyboard is on.
 *
 * Identity, never index. The table sorts by any column since Story #134, so its row order and
 * the donut's arc order have no reason to agree — a positional link would highlight the wrong
 * wedge the moment a reader sorted by value. `groupTail`'s aggregated tail needs no special
 * case: it is one slice with one key, so its row and its wedge light up together by
 * construction.
 */
export function sliceEmphasis(activeKey: string | null, key: string): SliceEmphasis {
  if (activeKey === null) return 'resting'
  return activeKey === key ? 'active' : 'muted'
}

/**
 * The class carrying the emphasis, or `''` at rest.
 *
 * Neither state changes the fill. A slice keeps its palette hue while highlighted, because hue
 * *is* identity here — one sector wears one colour everywhere, map included (DDR-0030), and the
 * scales are CVD-validated (DDR-0021). Emphasis is therefore carried by stroke and opacity,
 * which say "this one" without saying "a different one".
 */
export function sliceEmphasisClassName(emphasis: SliceEmphasis): string {
  return emphasis === 'resting' ? '' : `pie-slice-${emphasis}`
}

/** Compose a slice's class list: its palette slot, then its emphasis. */
export function sliceClassName(seriesClass: string, emphasis: SliceEmphasis): string {
  const parts = ['pie-slice']
  if (seriesClass) parts.push(seriesClass)
  const emphasisClass = sliceEmphasisClassName(emphasis)
  if (emphasisClass) parts.push(emphasisClass)
  return parts.join(' ')
}
