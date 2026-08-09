/**
 * The motion contract (Story #154, DDR-0044), used only by tests.
 *
 * DDR-0031 gave `app.css` a scale for spacing, radius, type and focus, and #151 gave that scale a
 * ratchet. Motion was in neither. Six declarations carried four hand-picked values — `120ms ease`,
 * `90ms ease-out`, `120ms ease-out`, `120ms linear` — and exactly one of them was inside the
 * stylesheet's single `prefers-reduced-motion` block, so a reader who had asked the operating
 * system for less motion still got three of the app's five animations.
 *
 * The fix makes those two problems one problem. The reduced-motion rule redefines
 * `--duration-*` to `0ms` on `:root` rather than naming the selectors that move, so **drawing a
 * duration from the scale is what puts a rule inside the rule's reach**, and hard-coding one is
 * the only way out. That is why this module guards a single thing and gets both criteria:
 * {@link findViolations} fails a raw duration or easing, and a raw duration is precisely an
 * animation that would keep running under reduced motion.
 *
 * It is the same shape as `tokenAdoption.ts` minus the ratchet: there is no `BASELINE` here,
 * because the whole stylesheet was converted in this story rather than over two. {@link EXEMPTIONS}
 * is the permanent list, and it has one entry — see its own note.
 */
import { scanDeclarations, type CssDeclaration } from './cssDeclarations'

/**
 * The properties that can carry a duration or an easing.
 *
 * The longhands are listed even though `app.css` currently uses none of them, for the reason
 * #151 learned the hard way: its first estimate omitted `margin-top` and friends and undercounted
 * by 13. A guard that only knows the shorthand invites the longhand as the way around it.
 */
const MOTION_PROPERTIES = [
  'transition',
  'transition-duration',
  'transition-delay',
  'transition-timing-function',
  'animation',
  'animation-duration',
  'animation-delay',
  'animation-timing-function',
] as const

export function isMotionProperty(property: string): boolean {
  return (MOTION_PROPERTIES as readonly string[]).includes(property)
}

/** A `s` or `ms` time anywhere in a value. */
const TIME = /(-?\d*\.?\d+)(ms|s)\b/g

/**
 * The easing keywords and functions CSS accepts.
 *
 * `linear` is the one that needs care: it is also the head of `linear-gradient`, and `app.css`
 * masks the capped table with one. Scanning only motion properties is what keeps them apart —
 * the mask is a `mask-image`, which is not in {@link MOTION_PROPERTIES}.
 */
const EASING =
  /(?:cubic-bezier|steps|linear)\([^)]*\)|\b(?:ease(?:-in)?(?:-out)?|linear|step-start|step-end)\b/g

/** Everything outside a `var()`, which is the only part of a value that can be hand-picked. */
function outsideVars(value: string): string {
  return value.replace(/var\([^)]*\)/g, ' ')
}

/** The raw times in a value. `0s` is included: a zeroed duration is still a duration decided here. */
export function rawDurations(value: string): string[] {
  return [...outsideVars(value).matchAll(TIME)].map(([match]) => match)
}

/** The raw easing keywords and functions in a value. */
export function rawEasings(value: string): string[] {
  return [...outsideVars(value).matchAll(EASING)].map(([match]) => match)
}

/**
 * Whether a motion declaration names its duration.
 *
 * A `transition` or `animation` shorthand with no time at all is not clean by omission: it falls
 * back to `0s`, which reads as "no motion" but is a value nobody chose. The one real exception is
 * a scroll-driven animation, whose progress is the scroll range and which therefore *cannot*
 * carry a time — that is what {@link EXEMPTIONS} is for.
 */
export function namesADuration(declaration: CssDeclaration): boolean {
  if (declaration.property === 'transition-timing-function') return true
  if (declaration.property === 'animation-timing-function') return true
  return /var\(--duration-[a-z]+\)/.test(declaration.value)
}

export function isViolation(declaration: CssDeclaration): boolean {
  if (!isMotionProperty(declaration.property)) return false
  if (rawDurations(declaration.value).length > 0) return true
  if (rawEasings(declaration.value).length > 0) return true
  return !namesADuration(declaration)
}

/** Every motion declaration in the stylesheet, exemptions included. */
export function findMotionDeclarations(css: string): CssDeclaration[] {
  return scanDeclarations(css).filter((declaration) => isMotionProperty(declaration.property))
}

/**
 * The motion declarations that neither draw from the scale nor appear in {@link EXEMPTIONS}.
 *
 * An exemption matches on its **value** as well as its key, exactly as `tokenAdoption.ts` freezes
 * one: the scroll-driven fade is exempt because it carries no duration, so the moment it grows one
 * the exemption stops applying and the rule fails like any other.
 */
export function findViolations(css: string): CssDeclaration[] {
  const exempt = new Set(EXEMPTIONS.map((entry) => `${entry.key} = ${entry.value}`))
  return findMotionDeclarations(css).filter(
    (declaration) =>
      isViolation(declaration) && !exempt.has(`${declaration.key} = ${declaration.value}`),
  )
}

/** A permanent exemption, which — as in `tokenAdoption.ts` — has to say why. */
export interface ExemptEntry {
  readonly key: string
  readonly value: string
  readonly reason: string
}

/**
 * The one animation the scale cannot express, and the one this story decided to leave running.
 *
 * The capped table's bottom fade (Story #67) is driven by `animation-timeline: scroll(self block)`.
 * Its progress is the reader's own scroll position, so it has no duration to draw from the scale
 * and no duration for the reduced-motion rule to zero. The acceptance criteria asked for a
 * decision rather than an answer, and the decision is to leave it, on three grounds:
 *
 * - **It cannot play by itself.** Every frame it draws is one the reader asked for by scrolling,
 *   which is the property `prefers-reduced-motion` exists to restore.
 * - **It moves nothing.** It is an alpha mask on the container's bottom edge; nothing translates,
 *   scales or parallaxes, and WCAG 2.3.3's concern is motion animation specifically.
 * - **It is information, not decoration.** The fade is the "more rows below" affordance on a
 *   scroller with no visible bottom border. Removing it under reduced motion would take a cue
 *   away from the reader who asked for less motion, which inverts the point of asking.
 *
 * There is a fourth, narrower reason to prefer this over the blanket `animation-duration: 0.01ms
 * !important` reset: what a time duration means on a progress-based timeline is thinly specified
 * and engine-dependent, so overriding it would be changing a working scroll affordance on a guess.
 */
export const EXEMPTIONS: readonly ExemptEntry[] = [
  {
    key: '.data-table-scroll-capped | animation',
    value: 'table-rows-fade var(--ease-linear) both',
    reason:
      'Scroll-driven (Story #67): its progress is the scroll range, so it has no duration to draw from the scale or for the reduced-motion rule to zero. It cannot play by itself, it translates nothing, and it is the "more rows below" affordance.',
  },
]
