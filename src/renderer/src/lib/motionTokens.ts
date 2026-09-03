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
 * is the permanent list, and it has **nine** entries in **three kinds** — see its own note.
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
  // `scroll-behavior: smooth` animates and carries **no time at all** — the user agent picks how
  // long the scroll takes (Story #344). It is therefore a motion declaration that can never draw
  // from the scale, which makes it a violation by construction and an {@link EXEMPTIONS} entry
  // with a reduced-motion partner the only way to ship one. Listing it is what stops a smooth
  // scroll being the way around a rule every other animation in this app obeys.
  'scroll-behavior',
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
 * The animations the scale cannot express, in the three kinds there are.
 *
 * **The first kind cannot draw from the scale.** The capped table's bottom fade (Story #67) is
 * driven by `animation-timeline: scroll(self block)`. Its note is below and it is the entry this
 * list was written for.
 *
 * **The third kind has no duration to draw.** `scroll-behavior: smooth` (Story #344) animates and
 * names no time anywhere — the user agent picks one — so it is outside the mechanism for a
 * different reason from a raw duration: not because someone chose a value off the scale, but
 * because there is no value to choose. It arrives as the same **pair**, and for the same reason.
 *
 * **The second kind deliberately does not.** Story #343 takes the Figma design's `0.22s` for the
 * Assistant's profile column, which is neither of the scale's two durations — and DDR-0044's one
 * documented way off the budget is a raw value declared with its reason rather than a third token
 * existing for one rule (DDR-0115 amendment 4). It arrives as a **pair**: the rule, and the
 * explicit reduced-motion rule that stops it, because a raw duration is by construction outside
 * the mechanism that zeroes `--duration-*`. Both are listed. An entry of this kind with no
 * reduced-motion partner is an animation that keeps running for a reader who asked it not to,
 * which is the exact failure the whole module exists to prevent — so a raw duration added here
 * without one is the thing to refuse in review.
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
  {
    key: '.assistant-profile-column | transition',
    value: 'width 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
    reason:
      'The Assistant profile column, at the Figma design’s own 0.22s and easing (Story #343, DDR-0115 amendment 4). Neither is on the scale, and DDR-0044’s one way off the budget is a raw value declared with its reason rather than a third token existing for one rule. Being raw puts it outside the mechanism that zeroes the tokens, so it is zeroed by name inside the same reduced-motion block — the entry below is that rule, and the two move together.',
  },
  {
    key: '@media (prefers-reduced-motion: reduce) >> .assistant-profile-column.assistant-profile-column | transition-duration',
    value: '0s',
    reason:
      'The explicit half of the entry above (Story #343, DDR-0115 amendment 4). A raw duration cannot be reached by redefining `--duration-*`, so the column is stopped by name; `0s` is a raw time and therefore a violation like any other, which is why it is listed rather than special-cased. The selector is doubled to out-specify the rule it overrides — the token redefinition beside it needs no such thing, because a custom property is re-read where it is used, but this is a property override 4,000 lines above the rule it fights. Delete this and the column keeps sliding for a reader who asked it not to.',
  },
  {
    key: '.assistant-transcript | scroll-behavior',
    value: 'smooth',
    reason:
      'The transcript scrolls a new turn into view (Story #344, DDR-0115 decision 7). `scroll-behavior` is the third kind of thing this list holds: motion with **no time in it at all** — the user agent decides how long a smooth scroll takes — so unlike a raw duration it could not draw from the scale even if someone wanted it to. That is exactly why it is exempted rather than special-cased: it is a real escape from the mechanism, and the escape is paid for by the entry below. The component calls `scrollIntoView` with no `behavior` option, so this declaration is the whole of the app’s answer and a branch in the component would put that answer out of the media query’s reach.',
  },
  {
    key: '@media (prefers-reduced-motion: reduce) >> .assistant-transcript.assistant-transcript | scroll-behavior',
    value: 'auto',
    reason:
      'The explicit half of the entry above (Story #344). Nothing about `scroll-behavior` responds to zeroing `--duration-*`, so the band is stopped by name and the scroll becomes a jump. Doubled to out-specify the rule it overrides, for the reason the column’s entry gives. `e2e/reduced-motion.spec.ts` proves the cascade actually resolves; a text scan can only see that both halves are written.',
  },
  {
    key: '.assistant-thinking-dot | animation',
    value: 'assistant-thinking-pulse 1.2s ease-in-out infinite',
    reason:
      'The waiting dots, at the Figma design’s own 1.2s and easing (Story #345, DDR-0115 amendment 4). Neither is on DDR-0044’s budget of two durations and two easings, and 1.2s is six times the slower step — a breathing rhythm rather than the feedback the scale is cut for, so widening the scale to hold it would loosen every transition in the app. The documented way out is a raw value declared with its reason, and the three entries below complete the set.',
  },
  {
    key: '.assistant-thinking-dot:nth-child(2) | animation-delay',
    value: '0.2s',
    reason:
      'The stagger that makes three dots read as a wave rather than a blink (Story #345). Listed separately from the entry below because the two values differ and an exemption matches on its value: changing one without the other fails here rather than drifting.',
  },
  {
    key: '.assistant-thinking-dot:nth-child(3) | animation-delay',
    value: '0.4s',
    reason:
      'The second half of the stagger (Story #345). See the entry above.',
  },
  {
    key: '@media (prefers-reduced-motion: reduce) >> .assistant-thinking-dot.assistant-thinking-dot | animation',
    value: 'none',
    reason:
      'The explicit half of the three entries above (Story #345). `animation: none` and **not** a zeroed duration, which is the difference between settled and frozen: a zero-duration animation holds the 0% keyframe, so the dots would rest at 0.3 opacity and 0.85 scale — three faint, shrunken circles a reader cannot tell from a rendering fault. With no animation the element’s own values apply. `none` names no duration and is therefore a violation like any other, which is why it is listed rather than special-cased.',
  },
]
