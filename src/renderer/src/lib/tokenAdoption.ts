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
    key: '.app-tab-active::after | border-radius',
    value: '1px',
    reason: 'The 2px active-tab bar’s own rounding (DDR-0029); 1px is below --radius-sm.',
  },
  {
    key: '.chart-axis-label | font-size',
    value: '11px',
    reason: 'An SVG <text> label, sized by the chart viewBox (DDR-0018).',
  },
  {
    key: '.chart-tooltip-date | font-size',
    value: '10px',
    reason: 'An SVG <text> label, sized by the chart viewBox.',
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
    key: '.map-scale-swatches .legend-swatch:first-child | border-radius',
    value: '3px 0 0 3px',
    reason: 'Chart geometry: the diverging scale’s end cap, below --radius-sm.',
  },
  {
    key: '.map-scale-swatches .legend-swatch:last-child | border-radius',
    value: '0 3px 3px 0',
    reason: 'Chart geometry: the diverging scale’s end cap, below --radius-sm.',
  },
]

/**
 * Everything still to convert. #152 empties this list; it may only shrink.
 *
 * Generated by running the scanner over `app.css` and then reviewed by eye — which is not
 * ceremony: the first generated exemption list already contained a wrong entry.
 */
export const BASELINE: readonly GuardEntry[] = [
  { key: '::-webkit-scrollbar-thumb | border-radius', value: '999px' },
  { key: '.eyebrow | margin', value: '0 0 0.35rem' },
  { key: '.eyebrow | font-size', value: '0.8rem' },
  { key: '.dashboard | gap', value: '1.5rem' },
  { key: '.dashboard-header | gap', value: '1rem' },
  { key: '.dashboard-header h1 | font-size', value: '1.9rem' },
  { key: '.source-note | font-size', value: '0.85rem' },
  { key: '.dashboard-actions | gap', value: '0.5rem' },
  { key: '.table-notice | margin', value: '0 0 0.75rem' },
  { key: '.table-notice | font-size', value: '0.8rem' },
  { key: '.converting-note | padding', value: '0.6rem 0.9rem' },
  { key: '.converting-note | font-size', value: '0.85rem' },
  { key: '.capture-status | padding', value: '0.6rem 0.9rem' },
  { key: '.capture-status | font-size', value: '0.85rem' },
  { key: '.capture-status | border-radius', value: '8px' },
  { key: '.confirm-action | gap', value: '0.6rem' },
  { key: '.confirm-warning | font-size', value: '0.82rem' },
  { key: '.confirm-buttons | gap', value: '0.5rem' },
  { key: '.dashboard-columns | gap', value: '1.5rem' },
  { key: '.allocation-list | gap', value: '0.85rem' },
  { key: '.allocation-head | font-size', value: '0.85rem' },
  { key: '.allocation-head | margin-bottom', value: '0.35rem' },
  { key: '.allocation-track | border-radius', value: '999px' },
  { key: '.allocation-bar | border-radius', value: '999px' },
  { key: '.snapshot-item | gap', value: '1rem' },
  { key: '.snapshot-item | padding', value: '0.7rem 0' },
  { key: '.snapshot-time | font-size', value: '0.9rem' },
  { key: '.snapshot-count | font-size', value: '0.85rem' },
  { key: '.flex-import-actions | gap', value: '0.6rem' },
  { key: '.flex-import-intro | margin', value: '0.35rem 0 0' },
  { key: '.flex-import-intro | font-size', value: '0.9rem' },
  { key: '.flex-import-summary | gap', value: '1rem' },
  { key: '.flex-import-file | margin-top', value: '0.15rem' },
  { key: '.flex-import-file | font-size', value: '0.78rem' },
  { key: '.flex-store-coverage | margin', value: '0 0 1rem' },
  { key: '.flex-store-coverage | font-size', value: '0.9rem' },
  { key: '.titlebar-drag | padding-left', value: '1rem' },
  { key: '.titlebar-title | font-size', value: '0.78rem' },
  { key: '.app-nav | gap', value: '1.5rem' },
  { key: '.app-nav | padding', value: '0.75rem var(--content-pad)' },
  { key: '.app-tabs | gap', value: '0.25rem' },
  { key: '.app-tab | padding', value: '0.4rem 0.9rem' },
  { key: '.app-tab | font-size', value: '0.9rem' },
  { key: '.app-tab | border-radius', value: '8px' },
  { key: '.analytics-view | gap', value: '1.5rem' },
  { key: '.view-toolbar | gap', value: '0.75rem' },
  { key: '.view-toolbar | margin-bottom', value: '-0.75rem' },
  { key: '.view-updated | font-size', value: '0.8rem' },
  { key: '.realized-split | gap', value: '1.5rem' },
  { key: '.highlights | gap', value: '1rem' },
  { key: '.breakdown-grid | gap', value: '1.5rem' },
  { key: '.breakdown-split | gap', value: '1.5rem' },
  { key: '.range-bar | gap', value: '1rem 1.5rem' },
  { key: '.range-custom | gap', value: '0.75rem 1rem' },
  { key: '.chart-legend | gap', value: '1.25rem' },
  { key: '.chart-legend | margin-top', value: '0.75rem' },
  { key: '.chart-legend | font-size', value: '0.82rem' },
  { key: '.legend-item | gap', value: '0.4rem' },
  { key: '.pie-figure | gap', value: '0.25rem' },
  { key: '.pie-legend | margin-top', value: '0.5rem' },
  { key: '.pie-legend-list | gap', value: '0.4rem' },
  { key: '.pie-legend-item | gap', value: '0.5rem' },
  { key: '.pie-legend-item | font-size', value: '0.82rem' },
  { key: '.country-map-figure | gap', value: '0.5rem' },
  { key: '.country-map | border-radius', value: '6px' },
  { key: '.country-map-unavailable | gap', value: '0.35rem' },
  { key: '.country-map-unavailable | padding', value: '1rem' },
  { key: '.country-map-unavailable | border-radius', value: '6px' },
  { key: '.country-map-controls | gap', value: '0.25rem' },
  { key: '.mapboxgl-popup-content | padding', value: 'var(--popup-pad-y) 0.7rem' },
  { key: '.mapboxgl-popup-content | border-radius', value: '6px' },
  { key: '.map-popup-title | font-size', value: '0.9rem' },
  { key: '.map-popup-name | margin', value: '0.1rem 0 0' },
  { key: '.map-popup-name | font-size', value: '0.78rem' },
  { key: '.map-popup-meta | gap', value: '0.4rem' },
  { key: '.map-popup-meta | margin', value: '0.35rem 0 0' },
  { key: '.map-popup-meta | font-size', value: '0.78rem' },
  { key: '.map-popup-rows | gap', value: '0.15rem' },
  { key: '.map-popup-rows | margin', value: '0.5rem 0 0' },
  { key: '.map-popup-rows | padding-top', value: '0.5rem' },
  { key: '.map-popup-rows | font-size', value: '0.82rem' },
  { key: '.map-popup-row | gap', value: '1rem' },
  { key: '.country-map-legend | gap', value: '0.4rem 1.25rem' },
  { key: '.country-map-sectors | gap', value: '0.35rem 0.9rem' },
  { key: '.country-map-sector | gap', value: '0.4rem' },
  { key: '.country-map-sector | font-size', value: '0.85rem' },
  { key: '.map-scale | gap', value: '0.5rem' },
  { key: '.map-scale | font-size', value: '0.85rem' },
  { key: '.country-map-pan-hint | font-size', value: '0.82rem' },
  { key: '.classify-prompt | margin-top', value: '1rem' },
  { key: '.classify-prompt | padding-top', value: '1rem' },
  { key: '.classify-note | margin', value: '0 0 0.75rem' },
  { key: '.classify-note | font-size', value: '0.82rem' },
  { key: '.classify-progress | margin', value: '0.6rem 0 0' },
  { key: '.classify-progress | border-radius', value: '999px' },
  { key: '.bar-list | gap', value: '0.85rem' },
  { key: '.bar-list-head | gap', value: '1rem' },
  { key: '.bar-list-head | font-size', value: '0.85rem' },
  { key: '.bar-list-head | margin-bottom', value: '0.35rem' },
  { key: '.bar-list-pct | margin-left', value: '0.5rem' },
  { key: '.bar-track | border-radius', value: '999px' },
  { key: '.bar-fill | border-radius', value: '999px' },
]
