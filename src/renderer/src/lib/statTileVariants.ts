/**
 * The `StatTile` primitive's contract (Story #129, DDR-0034).
 *
 * Same reason for existing as the button's and the card's (DDR-0032, DDR-0033): Vitest runs
 * Node-only, so nothing inside a component is testable (DDR-0029). The unions and the class
 * composition live here so the test can assert both halves — that a call composes the class
 * list a caller expects, and that `app.css` actually declares a rule behind every member.
 *
 * The tile's axis is **`tone`**, not `variant`/`size`. Its surface is the card's and is fixed
 * (`default` at `md`): a headline figure is always a panel-level tile, and an axis with one
 * value is a speculative abstraction. What genuinely varies is the polarity of the number.
 */

/**
 * The polarity of a signed figure. `neutral` is deliberately **the absence of a tone**, not a
 * third colour — see `toneClassName`. `positive`/`negative` are `--pos`/`--neg`, which is the
 * case DDR-0021 explicitly carves out: on a tile, in a table cell and in the map's popup a
 * figure sits beside the colour, so the colour is a second cue rather than the only channel.
 */
export const STAT_TONES = ['neutral', 'positive', 'negative'] as const

/** The tones that carry a colour, and so need a rule in the stylesheet. */
export const TONED_STAT_TONES = ['positive', 'negative'] as const

/** The tile's three lines. Each is a single class with no axis of its own. */
export const STAT_PARTS = ['label', 'value', 'hint'] as const

export type StatTone = (typeof STAT_TONES)[number]
export type StatPart = (typeof STAT_PARTS)[number]

export const DEFAULT_STAT_TONE = 'neutral' satisfies StatTone

/** Append a call site's `className` for placement, never for restyling (ADR-0008). */
function compose(parts: string[], className?: string): string {
  return className ? [...parts, className].join(' ') : parts.join(' ')
}

/** Polarity tone for a signed figure: positive, negative, or neutral at zero. */
export function toneOf(value: number): StatTone {
  if (value > 0) return 'positive'
  if (value < 0) return 'negative'
  return DEFAULT_STAT_TONE
}

/**
 * The tone class for a figure, composed with whatever else the element carries.
 *
 * A neutral figure gets **no class**, so it keeps the ink colour it inherits — a table cell's,
 * a tile's, a popup row's. That is what lets one helper serve all three: the map popup already
 * had to emit an empty string for a flat return, and a `.stat-neutral` rule would have had to
 * guess which ink each of those three contexts wanted.
 */
export function toneClassName(tone: StatTone, className?: string): string {
  const toned = tone === 'neutral' ? [] : [`stat-${tone}`]
  return compose(toned, className)
}

/** Compose the class list for the row of tiles. */
export function statRowClassName(className?: string): string {
  return compose(['stat-row'], className)
}

/** Compose the class list for one of the tile's lines (`label`, `value`, `hint`). */
export function statPartClassName(part: StatPart, className?: string): string {
  return compose([`stat-${part}`], className)
}
