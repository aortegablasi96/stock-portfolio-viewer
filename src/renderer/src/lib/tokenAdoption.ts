/**
 * The token-adoption ratchet (Story #151), used only by tests.
 *
 * DDR-0031 declared a spacing, radius and type scale, and Epic #125's nine Round 1 stories each
 * converted the rules they extracted — which reached the primitives and stopped. Measured across
 * `app.css`: **zero** raw values remain inside a primitive selector, and 110 remain outside one.
 * Nothing in the suite fails when a new rule adds the 111th, which is the mechanism the Epic's own
 * audit described: nine button families arrived one defensible decision at a time.
 *
 * So this module is the guard, and it is a *ratchet* rather than a check: today's violations are
 * frozen in {@link BASELINE}, new ones fail, and — the part that makes it a ratchet rather than a
 * suppression file — a baseline entry that stops matching also fails. Without that, dead entries
 * accumulate and #152's progress is invisible.
 *
 * {@link EXEMPTIONS} is the separate, permanent list: values DDR-0031 puts off the scale on
 * purpose. It is **enumerated by hand and must stay that way.** Two mechanical rules were tried
 * while planning this story and both leaked. A selector prefix (`.chart-`, `.pie-`, `.country-`)
 * wrongly exempted 30 — `.chart-legend { gap: 1.25rem }` is flex layout beside a chart, and
 * `.country-map-unavailable { padding: 1rem }` is a state panel. A sub-6px radius rule wrongly
 * exempted `.app-tab-active::after { border-radius: 1px }`, which is the tab bar's underline
 * (DDR-0029), not chart geometry. Both would have silently exempted exactly what #152 exists to
 * convert.
 *
 * The hand review settled it at **8 exemptions and 102 baseline entries**, and it moved the line
 * the other way from either heuristic: the exemption is far smaller than "the chart and map
 * styling" sounds. Element type decided it, not selector name — `.chart-axis-label`,
 * `.chart-tooltip-date` and `.chart-tooltip-value` render as SVG `<text>`, while `.chart-legend`
 * is a `<figcaption>`, `.pie-legend-item` an `<li>`, `.map-scale` a `<span>` and
 * `.country-map-sector` a `<ul>`. Those four are page-scale HTML that happens to sit beside a
 * chart, and they convert like anything else.
 *
 * **Story #152 converted all 102 and emptied the baseline**, adding three sub-4px hairlines to the
 * exemptions — the spacing counterpart of the sub-6px radii, since `--space-1` is 4px and snapping
 * a 1.6px gap up to it is a 2.5× change inside a popup DDR-0041 had already tuned. The guard is
 * absolute for everything else.
 *
 * **Story #160 removed two of the eleven**, the diverging legend's end caps, when the map's
 * gain/loss colour mode was withdrawn and its rules left the stylesheet. Worth noting as the
 * ratchet's second half doing its job unprompted: nothing in that story went looking for this
 * list, and "an exemption that stopped matching also fails" is what sent someone to it.
 *
 * **Story #182 removed a third**, the same way and for a better reason. The active tab's marker
 * rotated with the tablist — a 2px bar under a label became a 3px bar down a row's leading edge
 * (DDR-0055) — and a vertical bar rounds to a stadium, so `--radius-pill` says what `1px` was
 * approximating. The note above, that a "sub-6px radius" rule would have wrongly exempted this
 * very declaration, now reads as the argument it always was: the only radius in this file that a
 * mechanical rule would have hidden turned out to be one the scale could express. **Eight.**
 *
 * **Story #222 added the ninth**, and it is the first entry that could not be widened into an
 * existing one: the composition key's swatch shrinks to the proposal's 8px square while the shared
 * `.legend-swatch` keeps its 12px, and a corner drawn as a fixed *fraction* of the square is two
 * values, not one rule with two members. Same family as the entry above it — chart geometry below
 * `--radius-sm` — and it is listed separately because it is a second measurement.
 *
 * **Story #188 widened one rather than adding a ninth.** The hover card grew a second muted SVG
 * label — a row's series name beside its figure — wanting exactly the size and tone the card's
 * date already had, so it joined that rule instead of copying it and the exemption's key moved
 * with the selector list. Still eight, and the count stays a fact about the list rather than a
 * target: a key carries the whole selector context, so a rule that quietly gains a member fails
 * here until someone comes and looks at it.
 */
import { scanDeclarations, type CssDeclaration } from './cssDeclarations'

/**
 * The properties the scale can express, longhands included.
 *
 * Longhands matter more than they look: `margin-top`, `margin-bottom`, `padding-top`,
 * `padding-left` and `margin-left` account for 11 of the 102 baseline entries, and the first
 * estimate of this story's size missed them and undercounted by 13.
 */
const GUARDED = [
  /^(padding|margin)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$/,
  /^(row-|column-)?gap$/,
  /^font-size$/,
  /^border-(radius|(top|bottom)-(left|right)-radius)$/,
] as const

/** Which of DDR-0031's scales a property draws from, for the suggestion in a failure message. */
export type Scale = 'space' | 'text' | 'radius'

export function isGuardedProperty(property: string): boolean {
  return GUARDED.some((pattern) => pattern.test(property))
}

export function scaleFor(property: string): Scale {
  if (property === 'font-size') return 'text'
  if (property.endsWith('radius')) return 'radius'
  return 'space'
}

/** A `rem` or `px` length anywhere in a value. Percentages and `auto` are not on any scale. */
const LENGTH = /(-?\d*\.?\d+)(rem|px)\b/g

/** `rem` is 16px at the app's root size — the same assumption `designTokens.test.ts` makes. */
function toPx(amount: string, unit: string): number {
  return unit === 'rem' ? Number(amount) * 16 : Number(amount)
}

/**
 * The raw non-zero lengths in a value, ignoring anything already inside a `var()`.
 *
 * Zero is never a violation — `padding: 0` needs no token, and `margin: 0 0 0.35rem` is a
 * violation for the `0.35rem` alone. `calc(var(--space-4) * 2)` is clean; `calc(100% - 1rem)` is
 * not, because the `1rem` half is a hand-picked step. `padding: var(--popup-pad-y) 0.7rem` is the
 * real mixed case, at `app.css` line 1934.
 */
export function rawLengths(value: string): number[] {
  const outsideVars = value.replace(/var\([^)]*\)/g, ' ')
  const lengths: number[] = []
  for (const [, amount, unit] of outsideVars.matchAll(LENGTH)) {
    if (amount === undefined || unit === undefined) continue
    const px = toPx(amount, unit)
    if (px !== 0) lengths.push(px)
  }
  return lengths
}

export function isViolation(declaration: CssDeclaration): boolean {
  return isGuardedProperty(declaration.property) && rawLengths(declaration.value).length > 0
}

export function findViolations(css: string): CssDeclaration[] {
  return scanDeclarations(css).filter(isViolation)
}

/** A token's name and its resolved px value, for the nearest-step suggestion. */
export interface Token {
  readonly name: string
  readonly px: number
}

const SCALE_PREFIX: Record<Scale, RegExp> = {
  space: /^--space-\d+$/,
  text: /^--text-[a-z0-9]+$/,
  radius: /^--radius-(sm|md|lg)$/,
}

/**
 * The single-length tokens declared in `:root`, by scale.
 *
 * The composite `--control-pad-*` / `--surface-pad-*` steps are deliberately skipped: they carry
 * two lengths, so they cannot be "nearest" to one. `--radius-pill` is skipped for the same reason
 * it exists — 999px is a shape, not a step, and suggesting it for a 6px corner would be wrong.
 */
export function readTokens(css: string, scale: Scale): Token[] {
  const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')))
  const tokens: Token[] = []
  for (const [, name, amount, unit] of root.matchAll(/^\s*(--[a-z0-9-]+):\s*([\d.]+)(rem|px);/gm)) {
    if (name === undefined || amount === undefined || unit === undefined) continue
    if (SCALE_PREFIX[scale].test(name)) tokens.push({ name, px: toPx(amount, unit) })
  }
  return tokens
}

/**
 * The nearest step to a raw value, as a suggestion only.
 *
 * Advisory on purpose: `0.7rem` is nearest `--space-4` (0.75rem), but the author may have wanted
 * `--space-3`. The message says what to look at, and the person converting decides.
 */
export function suggestToken(declaration: CssDeclaration, css: string): string | null {
  const lengths = rawLengths(declaration.value)
  if (lengths.length === 0) return null

  const tokens = readTokens(css, scaleFor(declaration.property))
  if (tokens.length === 0) return null

  const suggestions = lengths.map((px) => {
    const nearest = tokens.reduce((best, token) =>
      Math.abs(token.px - px) < Math.abs(best.px - px) ? token : best,
    )
    return `${px}px → ${nearest.name}`
  })
  return [...new Set(suggestions)].join(', ')
}

/** One frozen entry. The value is part of the match, so editing a baselined rule also fails. */
export interface GuardEntry {
  readonly key: string
  readonly value: string
}

/** A permanent exemption, which unlike a baseline entry has to say why. */
export interface ExemptEntry extends GuardEntry {
  readonly reason: string
}

/**
 * Values DDR-0031 puts off the scale on purpose, plus one that is not spacing at all.
 *
 * Chart and map **SVG label sizes** scale from a `viewBox` rather than from the page (DDR-0018),
 * so a page-relative type step would resize them against their own geometry. The **sub-6px radii**
 * are chart geometry — a 3px swatch corner is drawn to match a 3px stroke, not chosen from a
 * scale.
 *
 * `.sr-only`'s `margin: -1px` is the third kind: the standard visually-hidden clip, where the
 * `-1px` pairs with a `1px` box and means nothing on its own. It is listed rather than special-
 * cased, because a negative margin *can* be real spacing — an optical `margin-top: -0.5rem` should
 * still fail.
 */
export const EXEMPTIONS: readonly ExemptEntry[] = [
  {
    key: '.sr-only | margin',
    value: '-1px',
    reason: 'The visually-hidden clip pattern: -1px pairs with the 1px box, and is not spacing.',
  },
  {
    key: '.chart-axis-label | font-size',
    value: '11px',
    reason: 'An SVG <text> label, sized by the chart viewBox (DDR-0018).',
  },
  {
    key: '.chart-tooltip-date, .chart-tooltip-label | font-size',
    value: '10px',
    reason: 'Two SVG <text> labels sharing one rule, sized by the chart viewBox (Story #188).',
  },
  {
    key: '.chart-tooltip-value | font-size',
    value: '12px',
    reason: 'An SVG <text> label, sized by the chart viewBox.',
  },
  {
    key: '.legend-swatch | border-radius',
    value: '3px',
    reason: 'Chart geometry: 3px is below --radius-sm (6px).',
  },
  {
    key: '.composition-legend .legend-swatch | border-radius',
    value: '2px',
    reason:
      'Chart geometry: the composition key’s 8px swatch keeps the 12px one’s 25% corner (Story #222).',
  },
  {
    key: '.map-popup-name | margin',
    value: '0.1rem 0 0',
    reason: '1.6px is below --space-1 (4px); snapping would 2.5× the gap under a popup title.',
  },
  {
    key: '.map-popup-rows | gap',
    value: '0.15rem',
    reason: '2.4px is below --space-1 (4px); snapping would 1.7× the gap between popup rows.',
  },
  {
    key: '.flex-import-file | margin-top',
    value: '0.15rem',
    reason: '2.4px is below --space-1 (4px); snapping would 1.7× the gap under a file name.',
  },
]

/**
 * Everything still to convert — **empty since Story #152**, and it may only grow shorter.
 *
 * It held 102 entries for the length of one story. Now that it is empty the first assertion in
 * `tokenAdoption.test.ts` is absolute: any guarded declaration carrying a raw length fails unless
 * someone adds it to {@link EXEMPTIONS} with a reason. Do not re-baseline to get a build green —
 * that is the suppression file this was built to avoid.
 */
export const BASELINE: readonly GuardEntry[] = []
