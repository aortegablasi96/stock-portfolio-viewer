/**
 * The contrast guard (Story #163), used only by tests.
 *
 * Two axe-core audits on 2026-08-10 found that `--neg` failed WCAG AA everywhere it was text
 * (3.62:1 on `--card`, 3.93:1 on `--bg`) while `--pos` passed comfortably (5.19:1 / 5.63:1). The
 * consequence was not abstract: **every negative money figure in the app was less legible than
 * every positive one** — in `StatTile`, in twelve `DataTable`s and in the realized-gains
 * highlight. `.btn-primary` failed the same way, white on `--accent` at 3.20:1.
 *
 * Nothing in the suite noticed, because contrast had never been measured — the two tones were
 * picked to *mean* opposite things, not to match a threshold.
 *
 * So this module is the guard, and it lives in Node rather than in `e2e/` deliberately. CI runs
 * `lint`, `typecheck`, `test`, `build`; the Playwright suite is excluded because it needs a
 * display server, so an axe assertion placed there would run only when someone remembered.
 * Contrast is arithmetic over values declared in `app.css`, so it can be computed here and
 * enforced on every push — the same instinct as `designTokens.test.ts` and `tokenAdoption.ts`,
 * which also take the stylesheet as their subject.
 *
 * {@link PAIRINGS} is **enumerated by hand and must stay that way.** A CSS-wide "resolve every
 * colour against its inherited background" pass is not possible without a layout engine — which
 * is exactly what Vitest's Node environment does not have. The list is the honest alternative:
 * each entry names a pairing that really occurs, and says why it matters.
 */
import { stripComments } from './cssDeclarations'

/** A colour token's name and its declared hex value. */
export interface ColorToken {
  readonly name: string
  readonly hex: string
}

/**
 * The `:root` colour tokens, by name.
 *
 * Only `#rrggbb` literals: every colour token in `app.css` is written that way, and a token
 * defined through `color-mix()` (the map popup's tint, DDR-0041) is a *fill* whose contrast is
 * governed by the text sitting on it, not by the token itself.
 */
export function readColorTokens(css: string): Map<string, string> {
  const clean = stripComments(css)
  const start = clean.indexOf(':root {')
  const root = clean.slice(start, clean.indexOf('}', start))
  const tokens = new Map<string, string>()
  for (const [, name, hex] of root.matchAll(/^\s*(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/gm)) {
    if (name !== undefined && hex !== undefined) tokens.set(name, hex.toLowerCase())
  }
  return tokens
}

/** One sRGB channel, linearised — the WCAG 2.x transfer function. */
function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** WCAG relative luminance of a `#rrggbb` colour. */
export function relativeLuminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  )
}

/** WCAG contrast ratio between two `#rrggbb` colours, from 1 to 21. Order does not matter. */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)]
  const [hi, lo] = x > y ? [x, y] : [y, x]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * `filter: brightness(k)` applied to a colour, so a hover state can be measured.
 *
 * `.btn-primary:hover` lightens its own fill, which *lowers* contrast against a white label — so
 * the hover is the binding measurement, not the resting state. The first audit missed this
 * entirely: axe tests resting state only.
 */
export function brightness(hex: string, factor: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const scale = (c: number): string =>
    Math.round(Math.min(255, c * factor))
      .toString(16)
      .padStart(2, '0')
  return `#${scale((n >> 16) & 255)}${scale((n >> 8) & 255)}${scale(n & 255)}`
}

/** AA thresholds. Large is ≥24px normal or ≥18.66px bold — nothing in the list qualifies today. */
export const AA_NORMAL = 4.5
export const AA_LARGE = 3

/**
 * The threshold for a graphic that carries meaning (WCAG 1.4.11 Non-text Contrast).
 *
 * Numerically the same 3:1 as large text and deliberately a separate name: a mark held to this
 * bar is one whose *shape* is the information, and reading `AA_LARGE` beside a dot that contains
 * no text would invite someone to "fix" it by making the dot bigger.
 */
export const NON_TEXT = 3

/**
 * The floor for a **surface boundary** — the rule or border that says where one surface ends and
 * the next begins (Story #219, DDR-0069).
 *
 * Explicitly **not** a WCAG threshold, and named separately so nobody reads it as one. 1.4.11
 * governs a control's boundary where the boundary is what identifies the control; the gateway
 * chip is not interactive and its box carries no state — the wording inside it does. What the
 * edge has to do is weaker than that and still real: mark a box on the rail rather than dissolve
 * into it.
 *
 * The number is the app's own, not a round one picked for comfort. `--card` on `--bg` is 1.059 —
 * two surfaces separated by fill alone, which is exactly the separation the app never relies on,
 * because every card draws a border as well. `--border` on `--card` is 1.251 — the edge every
 * card, every table rule and every input already ships. 1.2 sits between the two, so the guard
 * fails the day `--border` is dimmed toward the surfaces it separates and passes for the edges
 * the app draws today.
 *
 * A border's *inner* edge — the rule against the fill it encloses — is deliberately not measured
 * against this or anything else. It is a boundary between a box and its own outline, which
 * separates nothing a reader has to tell apart.
 */
export const SURFACE_EDGE = 1.2

/** A colour used directly, or a token name resolved from `:root`. */
/**
 * A colour named three ways: a `:root` token, a literal, or a token mixed into a surface.
 *
 * The third exists because Story #181 made `color-mix()` the way a rule tints something — five
 * rules that had hard-coded a colour now mix it from a token, so the next re-key is a `:root`
 * edit (DDR-0054) — and Story #182's sidebar puts accent text on exactly such a tint. Nothing
 * measured those mixes before, which is the same blind spot this module's own header describes:
 * a guard that lists only what has failed cannot see what has not failed *yet*.
 *
 * It models one arithmetic, which `app.css` writes two ways. `color-mix(in srgb, X p%,
 * transparent)` composited over an opaque surface is a per-channel lerp between X and that
 * surface; `color-mix(in srgb, X p%, Y)` with both opaque is the same lerp with `Y` named
 * outright, which is the form Story #220's `--series-ink-*` ramp takes (`over` is `--text`
 * there, a colour rather than a ground). A mix in `oklab`, or over a translucent backdrop,
 * would need more than this and should get it when a rule needs one.
 */
type Colour =
  | { readonly token: string }
  | { readonly literal: string }
  | { readonly mix: { readonly token: string; readonly percent: number; readonly over: string } }

/** One enumerated pairing that really occurs in the UI. */
export interface Pairing {
  /** What renders this pairing, for the failure message. */
  readonly where: string
  readonly foreground: Colour
  readonly background: Colour
  /** Applied to the background, for hover states that filter their own fill. */
  readonly backgroundBrightness?: number
  readonly minimum: number
  /**
   * A ceiling, for the pairings that fail by being too **loud** (Story #235, DDR-0076).
   *
   * Every entry above this one is a floor, because every failure this module was built for was a
   * thing too faint to read. The composition stack's failure is the other one: eight saturated
   * slabs covering most of a card, shouting down the three charts beside it. A guard that only
   * knows floors cannot see that, and the softening it needed would otherwise be a number picked
   * on screen — which is what DDR-0052 did, and what left it unmeasured for two stories.
   *
   * A ceiling is only meaningful where something *else* carries the meaning: a band's fill may sit
   * under 1.4.11's bar because the band's own stroke is held above it, five rules below.
   */
  readonly maximum?: number
  readonly reason: string
}

function lookUp(name: string, tokens: Map<string, string>): string {
  const hex = tokens.get(name)
  if (hex === undefined) throw new Error(`${name} is not declared in :root`)
  return hex
}

/** `color-mix(in srgb, top p%, transparent)` laid over an opaque `under`: a per-channel lerp. */
export function mixOver(top: string, percent: number, under: string): string {
  const a = Number.parseInt(top.slice(1), 16)
  const b = Number.parseInt(under.slice(1), 16)
  const f = percent / 100
  const channels = [16, 8, 0].map((shift) =>
    Math.round(f * ((a >> shift) & 255) + (1 - f) * ((b >> shift) & 255)),
  )
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

function resolve(colour: Colour, tokens: Map<string, string>): string {
  if ('literal' in colour) return colour.literal
  if ('mix' in colour) {
    return mixOver(
      lookUp(colour.mix.token, tokens),
      colour.mix.percent,
      lookUp(colour.mix.over, tokens),
    )
  }
  return lookUp(colour.token, tokens)
}

/**
 * The categorical slots that have an ink counterpart, in the order `app.css` declares them.
 *
 * `'neutral'` is the residual's, and it is in the list for the reason it is in the palette: an
 * `other` band is a band, and its row is inked like any other (DDR-0030).
 */
export const SERIES_INK_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 'neutral'] as const

/**
 * How much of the slot survives in its ink — the `75%` in `app.css`'s `color-mix()`.
 *
 * Mirrored here rather than parsed out of the stylesheet, and pinned back against it by
 * `contrast.test.ts`: a number restated in two files is a number that will disagree, so the
 * disagreement is what fails.
 */
export const SERIES_INK_PERCENT = 75

/**
 * How much of a band's own hue survives in the composition stack's tint — the `62.5%` in
 * `app.css`'s `--band-tint` (Story #235, DDR-0076).
 *
 * Mirrored here for {@link SERIES_INK_PERCENT}'s reason, and pinned back against the stylesheet by
 * `contrast.test.ts`: a number restated in two files is a number that will disagree, so the
 * disagreement is what fails.
 *
 * It is derived rather than chosen. The proposal's numbers are alpha — 0.7 for a flat band, 0.8
 * down to 0.5 for the ramp on the band at the stack's edge — and adopting them literally makes
 * these bands *louder* than the 0.5 DDR-0052 measured. So the alpha stays the proposal's and the
 * softening moves into the hue, at the one mix that puts the loudest tint the chart renders where
 * its quietest band already was: `0.8 × 62.5% = 50%`, the flat opacity every band wore before.
 */
export const BAND_TINT_PERCENT = 62.5

/**
 * Every alpha the stack lays that tint down at, and what renders each.
 *
 * All three are listed rather than just the extremes. The ratios are monotone in the composite, so
 * bounding the loudest and the quietest would bound the middle by arithmetic — but the middle is
 * the alpha most of the bands actually wear, and "bounded by construction" is how a value stops
 * being looked at.
 */
export const BAND_TINT_ALPHAS: readonly { readonly where: string; readonly alpha: number }[] = [
  { where: '.stack-top-from — the ramp’s NAV edge, the loudest tint the chart renders', alpha: 0.8 },
  { where: '.stack-band — the flat bands, every one below the top', alpha: 0.7 },
  { where: '.stack-top-to — the ramp’s foot, the quietest tint the chart renders', alpha: 0.5 },
]

/**
 * Every text-on-surface pairing the app actually renders.
 *
 * Hover states are listed alongside resting ones, because `.btn-primary`'s hover is the *worse*
 * of its two and went unmeasured through the first audit. `.stat-positive` is listed although it
 * passes: the point of the guard is that the two tones stay balanced, and a guard that only lists
 * what once failed would not have caught this story's finding either.
 */
export const PAIRINGS: readonly Pairing[] = [
  {
    where: '.stat-negative — negative figures in tiles, table cells and the gains highlight',
    foreground: { token: '--neg-text' },
    background: { token: '--card' },
    minimum: AA_NORMAL,
    reason: 'The loss tone as text. --neg itself is 3.94:1 here, which is why --neg-text exists.',
  },
  {
    where: '.stat-negative on the page background (.highlight-value, 20px)',
    foreground: { token: '--neg-text' },
    background: { token: '--bg' },
    minimum: AA_NORMAL,
    reason: '20px normal is not AA "large" (needs 24px, or 18.66px bold), so 4.5:1 applies.',
  },
  {
    where: '.stat-positive — the tone --neg-text has to stay balanced against',
    foreground: { token: '--pos' },
    background: { token: '--card' },
    minimum: AA_NORMAL,
    reason: 'Passes today. Listed so the two tones cannot drift apart again unnoticed.',
  },
  {
    where: '.stat-positive on the page background',
    foreground: { token: '--pos' },
    background: { token: '--bg' },
    minimum: AA_NORMAL,
    reason: 'The positive counterpart of the .highlight-value pairing.',
  },
  {
    where: '.btn-danger — resting label',
    foreground: { token: '--neg-text' },
    background: { token: '--card' },
    minimum: AA_NORMAL,
    reason: 'Clear statements / Clear snapshots sit on a card surface.',
  },
  {
    where: '.btn-danger:hover — white label on the filled --neg background',
    foreground: { literal: '#ffffff' },
    background: { token: '--neg' },
    minimum: AA_NORMAL,
    reason:
      'The fill use of --neg, and the half the redesign got wrong: its single rose (#f43f5e) ' +
      'is 3.67:1 here. Story #181 kept the split and swapped which token carries which value.',
  },
  {
    where: '.btn-primary — white label on the filled accent',
    foreground: { literal: '#ffffff' },
    background: { token: '--accent-strong' },
    minimum: AA_NORMAL,
    reason: 'White on --accent is 4.47:1, which is why --accent-strong exists.',
  },
  {
    where: '.btn-primary:hover — the same label, on a fill lightened by brightness(1.08)',
    foreground: { literal: '#ffffff' },
    background: { token: '--accent-strong' },
    backgroundBrightness: 1.08,
    minimum: AA_NORMAL,
    reason:
      'The binding measurement for the primary button: the hover lightens its own fill, so it ' +
      'is always worse than the resting state. axe tests resting state only and missed it.',
  },
  {
    where: 'body text on a card',
    foreground: { token: '--text' },
    background: { token: '--card' },
    minimum: AA_NORMAL,
    reason: 'The app’s default ink. Guards against a future palette change quietly dimming it.',
  },
  {
    where: 'muted labels on a card',
    foreground: { token: '--muted' },
    background: { token: '--card' },
    minimum: AA_NORMAL,
    reason:
      'Stat labels, hints and the map popup’s rows. DDR-0041 already treats this as the binding ' +
      'constraint on how loud the popup tint may be. The redesign’s own #64748b is 3.89:1 here, ' +
      'which is why Story #181 raised it rather than pasting it.',
  },
  /**
   * The five pairings Story #181 added. Four of them were always rendered and never listed —
   * a guard that lists only what once failed has a blind spot exactly the size of what has not
   * failed yet, which is this module's own stated lesson. The accent one is the sharpest: it is
   * what forces `--accent` to the redesign's lighter indigo, and without it nothing would fail
   * if someone set the token to the proposal's headline #6366f1.
   */
  {
    where: 'body text on the page ground (headings, prose outside a card)',
    foreground: { token: '--text' },
    background: { token: '--bg' },
    minimum: AA_NORMAL,
    reason: 'The counterpart of the on-card pairing; the page ground is the darker of the two.',
  },
  {
    where: 'muted labels on the page ground — tab labels, the nav strip, page hints',
    foreground: { token: '--muted' },
    background: { token: '--bg' },
    minimum: AA_NORMAL,
    reason: 'An inactive tab label is --muted on the translucent nav over --bg.',
  },
  {
    where: '--accent as text — the active tab, a sorted header, an active toggle, an accent badge',
    foreground: { token: '--accent' },
    background: { token: '--card' },
    minimum: AA_NORMAL,
    reason:
      'Seven of --accent’s nine call sites are a `color`, so this token is text before it is ' +
      'anything else. The redesign’s #6366f1 is 4.14:1 here — enough for a ring, not for a label.',
  },
  {
    where: '--accent as text on the page ground (the active tab sits on the nav over --bg)',
    foreground: { token: '--accent' },
    background: { token: '--bg' },
    minimum: AA_NORMAL,
    reason: 'The active tab’s label is the most-read accent text in the app.',
  },
  /**
   * The two pairings Story #182 added, both on the sidebar (DDR-0055).
   *
   * The sidebar's ground is `--card`, so an inactive row's `--muted` label and an active row's
   * `--accent` label are already covered above. What is new is that the active row is *tinted*:
   * neither of those two entries measures accent text on an accent wash, and the wash is what
   * decides how loud the tint may be. 16% measures 4.95:1, and the ceiling is close enough to
   * matter: 20% is 4.60:1 and 22% is 4.41:1 — a failure. Tuning the wash by eye would cross that
   * line without anything noticing, which is the whole reason the mix is measured rather than
   * described.
   */
  {
    where: '.app-tab-active — the accent label on the sidebar row’s own accent tint',
    foreground: { token: '--accent' },
    background: { mix: { token: '--accent', percent: 16, over: '--card' } },
    minimum: AA_NORMAL,
    reason:
      'The active view’s label sits on a dilute wash of the same hue, which is the pairing a ' +
      'tinted "selected" row always creates and the one nothing measured before Story #182.',
  },
  {
    where: '.app-tab:hover — a hovered row’s label on its neutral lift',
    foreground: { token: '--text' },
    background: { mix: { token: '--text', percent: 7, over: '--card' } },
    minimum: AA_NORMAL,
    reason:
      'Listed although it passes wide: the hover lightens the surface under the ink, so it is ' +
      'the row’s worse state, and a later story raising the lift would otherwise go unmeasured.',
  },
  /**
   * The three pairings Story #183 added: the gateway dot, in each of its tones (DDR-0056).
   *
   * They are the first entries in this list that are **not text**, which is why they carry
   * {@link NON_TEXT} rather than an AA threshold. The dot is the badge's colour channel and never
   * its only one — every outcome has its own wording — but a mark that cannot be seen against the
   * surface behind it is not a second channel at all, and 3:1 is the bar that says it can be.
   *
   * The warn tone is the half of the loss split this list has the least coverage of: `--neg` as a
   * *fill* appears here and in `.btn-danger:hover` and nowhere else, and unlike that one it is not
   * measured against a label sitting on it — it is measured against the surface it sits on.
   *
   * **Story #219 re-pointed all three from `--card` to `--surface-raised`** rather than adding
   * three more beside them. The badge became a boxed chip with a fill of its own, so the dot no
   * longer touches the sidebar's ground at all — and a pairing that has stopped occurring is a
   * measurement of nothing, which is the failure mode this list's own header warns about from the
   * other direction. Every tone loses a little headroom on the lighter fill (the warn mark goes
   * 3.94:1 → 3.63:1, which is the tightest of the three), and that loss is the reason the entries
   * had to move rather than a reason to leave them.
   */
  {
    where: '.gateway-dot in .gateway-badge-live — the "answering" mark, on the chip’s own fill',
    foreground: { token: '--pos' },
    background: { token: '--surface-raised' },
    minimum: NON_TEXT,
    reason: 'A graphic that carries state has to be distinguishable from the surface behind it.',
  },
  {
    where: '.gateway-dot in .gateway-badge-warn — the stalled/unavailable mark',
    foreground: { token: '--neg' },
    background: { token: '--surface-raised' },
    minimum: NON_TEXT,
    reason:
      'The fill half of the loss split (DDR-0046), measured against its surface rather than ' +
      'against a label on it: 3.63:1 on the chip, which clears 1.4.11 and would not clear AA as ' +
      'text. The least headroom of anything in this list, and the first thing a lighter chip ' +
      'fill would break.',
  },
  {
    where: '.gateway-dot in .gateway-badge-idle — not running, or a reading that has aged out',
    foreground: { token: '--muted' },
    background: { token: '--surface-raised' },
    minimum: NON_TEXT,
    reason:
      'The quietest of the three, and the one a future dimming of --muted would break first. ' +
      'It is also the resting state of a fresh launch, so it is the mark most often on screen.',
  },
  /**
   * The four pairings Story #219 added: the gateway chip's own text, and its edge (DDR-0069).
   *
   * The badge's wording is the channel that carries the state (DDR-0056), so putting it on a new
   * surface moves the *only* channel that matters — which is why the three inks are listed here
   * even though two of them already appear on `--card` and on `--bg` above. `--surface-raised` is
   * neither of those surfaces, and the chip is the one place in the app that renders on it.
   *
   * The idle tone's detail line is not listed separately: it is `--muted` on the chip, which is
   * the label entry below, measured once.
   */
  {
    where: '.gateway-badge-label — the chip’s micro-label, and its idle detail line',
    foreground: { token: '--muted' },
    background: { token: '--surface-raised' },
    minimum: AA_NORMAL,
    reason:
      'The faintest ink the chip renders, at the smallest step the app has (--text-2xs). 5.35:1 ' +
      'against 5.80:1 on --card, so the chip costs the label real headroom and still clears AA.',
  },
  {
    where: '.gateway-badge-detail in .gateway-badge-live — "Live · 14:32" on the chip',
    foreground: { token: '--pos' },
    background: { token: '--surface-raised' },
    minimum: AA_NORMAL,
    reason: 'The gain tone as text, on the one surface in the app that is lighter than --card.',
  },
  {
    where: '.gateway-badge-detail in .gateway-badge-warn — "Stalled" / "Unavailable" on the chip',
    foreground: { token: '--neg-text' },
    background: { token: '--surface-raised' },
    minimum: AA_NORMAL,
    reason:
      'The text half of the loss split, which has to stay balanced against --pos on whatever ' +
      'surface renders it (DDR-0046): 6.34:1 against 6.73:1, inside the 0.5 the guard enforces.',
  },
  {
    where: '.gateway-badge’s border against the sidebar — and every card edge in the app',
    foreground: { token: '--border' },
    background: { token: '--card' },
    minimum: SURFACE_EDGE,
    reason:
      'The chip is a box because its border says so; the 1.085:1 fill step only seconds that. ' +
      'This pairing is not the chip’s alone — --border on --card is every card’s inner edge and ' +
      'every table rule — so it is the widest-reaching entry in this list and was, until now, ' +
      'unmeasured. See SURFACE_EDGE for why the threshold is not a WCAG one.',
  },
  /**
   * The two pairings Story #234 added: the display-currency field, boxed on the same raised
   * surface as the chip above it (DDR-0069, DDR-0070).
   *
   * The field is the raised surface's **third** adopter, and the toll is the one
   * `sidebarRail.test.ts` counts for: both of its inks had only ever been measured on `--card`,
   * which is not the surface either renders on any more. Its edge is not listed — `--border` on
   * `--card` is the entry above, and it is already the widest-reaching in this list.
   *
   * The control's hover ink is not listed either, for the reason the sidebar's hover entry
   * explains from the other direction: `--accent` on `--surface-raised` is a *lighter* ground
   * than the `--card` the accent is validated on, so the hover can only improve on a pairing
   * that already passes.
   */
  {
    where: '.app-currency .field-label — "Display currency" on the boxed field',
    foreground: { token: '--muted' },
    background: { token: '--surface-raised' },
    minimum: AA_NORMAL,
    reason:
      'The same ink and the same move as the chip’s micro-label at the head of this column, ' +
      'one step larger at --text-xs. Listed separately because it is a different rule: deleting ' +
      'the chip must not take the currency’s measurement with it.',
  },
  {
    where: '.app-currency .control — the selected code, on the field’s own fill',
    foreground: { token: '--text' },
    background: { token: '--surface-raised' },
    minimum: AA_NORMAL,
    reason:
      'The control keeps DDR-0035’s ink and gives up only its resting border, so the value now ' +
      'reads against the box rather than against the sidebar’s ground. Full ink on the app’s ' +
      'one surface step that goes up — the most headroom any pairing here has.',
  },
  /**
   * The three pairings Story #186 added: a table row's ink on the lift the row takes under the
   * pointer, and on the stronger lift the linked row takes (DDR-0059).
   *
   * The same form as the sidebar's hover, and listed for the same reason — a lift lightens the
   * surface *under* the ink, so a hovered row is always the row's worse state and a later story
   * raising the lift would otherwise go unmeasured. What the sidebar's entry has no counterpart
   * for is the muted half: a nav row's label is either --muted or --accent and never both, while
   * a table row carries --text figures and --muted secondary cells on the same tinted background.
   * That half is where the headroom actually is — --text is 13.81:1 on the hover lift, --muted is
   * 5.34:1, and on the linked row's 7% it is 4.97:1. 10% would measure 4.60:1, so the ceiling on
   * this family is close enough that the next story to reach for a louder row has to measure it.
   */
  {
    where: '.data-table tbody tr:hover — a cell’s figures on the row lift',
    foreground: { token: '--text' },
    background: { mix: { token: '--text', percent: 4, over: '--card' } },
    minimum: AA_NORMAL,
    reason: 'The hovered row is the row’s worse state, so it is the one worth pinning.',
  },
  {
    where: '.data-table tbody tr:hover — a muted secondary cell on the same lift',
    foreground: { token: '--muted' },
    background: { mix: { token: '--text', percent: 4, over: '--card' } },
    minimum: AA_NORMAL,
    reason:
      'The faintest ink a table renders — a description, a statement’s period — on the tint every ' +
      'table in the app now carries. The binding half of the hover.',
  },
  {
    where: '.data-table-row-active — a muted secondary cell on the linked row’s stronger lift',
    foreground: { token: '--muted' },
    background: { mix: { token: '--text', percent: 7, over: '--card' } },
    minimum: AA_NORMAL,
    reason:
      'The loudest lift in the family under the faintest ink in a table: the two together are ' +
      'what decides how far the linked row may be pushed (DDR-0040).',
  },
  /**
   * The two pairings Story #192 added: a toned badge's ink on the lift its row takes under the
   * pointer (DDR-0064).
   *
   * The two tones on `--card` are already listed twice over, and neither entry covers the surface
   * a *table* actually puts them on: the transactions table badges every row's type, so the gain
   * and loss inks are now rendered 200 rows at a time on a surface that lightens under the
   * pointer. Story #186's entries measured `--text` and `--muted` on that lift; these are the two
   * inks it has no counterpart for, and they are the ones with the least headroom — `--pos` and
   * `--neg-text` were tuned against `--card` and nothing has measured them one step lighter.
   */
  {
    where: '.badge-positive — the gain ink on a hovered transaction row',
    foreground: { token: '--pos' },
    background: { mix: { token: '--text', percent: 4, over: '--card' } },
    minimum: AA_NORMAL,
    reason:
      'A toned badge is text on the row lift, and the hovered row is the row’s worse state — the ' +
      'same argument Story #186 made for the two inks it did measure there.',
  },
  {
    where: '.badge-negative — the loss ink on a hovered transaction row',
    foreground: { token: '--neg-text' },
    background: { mix: { token: '--text', percent: 4, over: '--card' } },
    minimum: AA_NORMAL,
    reason:
      'The half of the split that has to stay balanced against --pos (DDR-0046), on the surface ' +
      'the Dividends transactions table renders it on hundreds of times.',
  },
  /**
   * The two pairings Story #229 added: the gain and loss tones as **marks** on a chart card
   * (DDR-0071).
   *
   * Both tones appear in this list several times over already, and every one of those entries
   * measures them as *text* on some surface. Neither has ever been measured as a graphic on
   * `--card` — which means the daily-return bars, which have filled with `--neg` since Story
   * #170, have gone unmeasured the whole time. The signed return curve adopts the same pair, so
   * the gap is closed here rather than left for the chart that happens to trip over it.
   *
   * {@link NON_TEXT} and not AA, because these are the shapes themselves: a curve, a bar, a dot.
   * The figures they describe are elsewhere in the card and in the hover row, held to AA there.
   * `--neg` at 3.94:1 is the tighter of the two, and it is the fill half of the split by
   * construction (DDR-0046) — the token that would *pass* AA here is `--neg-text`, and using it
   * would be picking the wrong half for a mark.
   */
  {
    where: '.chart-line-pos / .chart-bar-gain — the gain tone as a curve, bar or dot on a card',
    foreground: { token: '--pos' },
    background: { token: '--card' },
    minimum: NON_TEXT,
    reason:
      'A mark that cannot be told from the surface behind it is not a channel at all. Listed ' +
      'although it passes wide, so the pair cannot drift apart unnoticed on this surface either.',
  },
  {
    where: '.chart-line-neg / .chart-bar-loss — the loss tone as a curve, bar or dot on a card',
    foreground: { token: '--neg' },
    background: { token: '--card' },
    minimum: NON_TEXT,
    reason:
      'The fill half of the loss split as a graphic: 3.94:1, which clears 1.4.11 and would not ' +
      'clear AA as text. Unmeasured since the daily-return bars shipped in Story #170.',
  },
  {
    where: '.chart-axis-label — SVG <text> on a chart card',
    foreground: { token: '--chart-axis' },
    background: { token: '--card' },
    minimum: AA_NORMAL,
    reason:
      'An axis label is text, whatever it is drawn with, so it is held to AA like any other. ' +
      'Listed because --chart-axis is easy to read as chart furniture and dim on that basis.',
  },
  /**
   * The pairings Story #220 added: everything the hover card renders, on the card's new fill
   * (DDR-0070).
   *
   * Two things happened at once and each on its own would have needed measuring. The card's
   * ground moved from `--card` to `--surface-raised`, which re-points every ink it already
   * carried — the same argument Story #219 made for the gateway chip, and the same conclusion:
   * a pairing measured on a surface the thing no longer sits on measures nothing. And a row's
   * figure started taking a *colour*, which is a role the `--series-*` slots have never had.
   *
   * The series family is the sharp one. Full strength, three of the eight fail AA here
   * (4.39:1, 4.33:1, 3.45:1) and `--series-6` fails on `--card` too — so `app.css` derives the
   * `--series-ink-*` ramp and these entries measure the ramp, not the slots. They are **mapped
   * over a hand-written list of slots** rather than each spelled out, which is the one place in
   * this file that happens: it is a single pairing shape across one palette, and nine
   * near-identical objects would hide the only thing that varies. The list is still enumerated —
   * a tenth slot does not appear here by itself, and the module header's rule holds.
   */
  {
    where: '.chart-tooltip-value — a figure on the hover card’s raised fill',
    foreground: { token: '--text' },
    background: { token: '--surface-raised' },
    minimum: AA_NORMAL,
    reason: 'The card’s default ink, re-pointed from --card when the card gained its own ground.',
  },
  {
    where: '.chart-tooltip-date, .chart-tooltip-label — the date and a row’s series name',
    foreground: { token: '--muted' },
    background: { token: '--surface-raised' },
    minimum: AA_NORMAL,
    reason:
      'The faintest ink the card renders, at 10 viewBox units. 5.35:1 against 5.80:1 on --card, ' +
      'so the lift costs it real headroom and it still clears AA.',
  },
  {
    where: '.chart-tooltip-value-pos — an up day’s figure in the Daily return card',
    foreground: { token: '--pos' },
    background: { token: '--surface-raised' },
    minimum: AA_NORMAL,
    reason: 'The gain tone as text, restating a bar drawn above the zero line.',
  },
  {
    where: '.chart-tooltip-value-neg — a down day’s figure in the Daily return card',
    foreground: { token: '--neg-text' },
    background: { token: '--surface-raised' },
    minimum: AA_NORMAL,
    reason:
      'The text half of the loss split, which has to stay within 0.5 of --pos on whatever ' +
      'surface renders it (DDR-0046): 6.34:1 against 6.73:1.',
  },
  ...SERIES_INK_SLOTS.map((slot) => ({
    where: `.chart-tooltip-value.pie-series-${slot} — a composition row inked with its band’s hue`,
    foreground: { mix: { token: `--series-${slot}`, percent: SERIES_INK_PERCENT, over: '--text' } },
    background: { token: '--surface-raised' },
    minimum: AA_NORMAL,
    reason:
      'A fill token used as ink. The slot itself is not measured here because the slot is not ' +
      'what renders — --series-ink-' +
      slot +
      ' is, and the ramp exists precisely because three of these fail at full strength.',
  })),
  /**
   * The composition stack's two channels (Story #235, DDR-0076), and the first entries in this
   * list with a {@link Pairing.maximum}.
   *
   * The stack has worn the `--series-*` slots as area since Story #171 and as a hairline stroke
   * since Story #222, and neither has ever been measured — a `fill-opacity` resolves to no value
   * a Node test can read, so the softening DDR-0052 picked on screen stayed a number nobody could
   * check. Making it a `color-mix()` is what puts it in reach of this module, and that is most of
   * why the mix exists.
   *
   * The two families say one thing between them: **the edge carries the band and the fill only
   * decorates it.** The stroke is the hue at full strength and is held to {@link NON_TEXT},
   * because on this portfolio a 0.1% cash band is sub-pixel and the hairline is the entire mark.
   * The fill is held *under* that same bar — a ceiling, not a floor — so a band's identifying
   * channel is always the sharper of its two. The ranges do not even meet: the loudest tint is
   * 2.39:1 (`--series-7` at the ramp's edge) and the faintest edge is 3.74:1 (`--series-6`),
   * which `contrast.test.ts` asserts as a gap rather than as two separate bounds.
   *
   * The fills also carry a floor, and {@link SURFACE_EDGE} is the right one rather than a
   * borrowed name: a band's tint against the card is exactly what that threshold was cut for — a
   * fill that has to mark a shape rather than dissolve into the surface behind it, with no claim
   * on an accessibility bar. The quietest is 1.37:1 (`--series-6` at the ramp's foot), so both
   * ends bind and neither is far away.
   */
  ...BAND_TINT_ALPHAS.flatMap(({ where, alpha }) =>
    SERIES_INK_SLOTS.map((slot) => ({
      where: `${where} — a band tinted from --series-${slot}`,
      foreground: {
        mix: { token: `--series-${slot}`, percent: BAND_TINT_PERCENT * alpha, over: '--card' },
      },
      background: { token: '--card' },
      minimum: SURFACE_EDGE,
      maximum: NON_TEXT,
      reason:
        'A composition band is a tint of the card, not a slab on it: loud enough to mark the ' +
        'ribbon, quiet enough that the band’s own edge stays the channel that identifies it.',
    })),
  ),
  ...SERIES_INK_SLOTS.map((slot) => ({
    where: `.stack-band’s stroke — the hairline edge of a band drawn from --series-${slot}`,
    foreground: { token: `--series-${slot}` },
    background: { token: '--card' },
    minimum: NON_TEXT,
    reason:
      'The edge is the whole mark where a band is sub-pixel, so it is a graphic carrying ' +
      'meaning. It is also why the stroke is not diluted with the fills: --series-6 is 3.74:1 ' +
      'here, 85% of it measures 3.01:1 and 84% fails, so there is nothing to spend.',
  })),
]

/** One measured pairing, with the numbers, for the test’s failure message. */
export interface ContrastFailure {
  readonly where: string
  readonly foreground: string
  readonly background: string
  readonly ratio: number
  readonly minimum: number
  /** Present only where the pairing can also fail by being too loud (DDR-0076). */
  readonly maximum?: number
}

export function measure(pairing: Pairing, tokens: Map<string, string>): ContrastFailure {
  const foreground = resolve(pairing.foreground, tokens)
  const raw = resolve(pairing.background, tokens)
  const background =
    pairing.backgroundBrightness === undefined
      ? raw
      : brightness(raw, pairing.backgroundBrightness)
  return {
    where: pairing.where,
    foreground,
    background,
    ratio: contrastRatio(foreground, background),
    minimum: pairing.minimum,
    ...(pairing.maximum === undefined ? {} : { maximum: pairing.maximum }),
  }
}

/** Whether one measurement sits inside the range its pairing allows. */
export function withinRange(result: ContrastFailure): boolean {
  if (result.ratio < result.minimum) return false
  return result.maximum === undefined || result.ratio <= result.maximum
}

/** The range a pairing allows, for a failure message: `≥ 4.5:1`, or `1.2–3:1`. */
export function describeRange(result: ContrastFailure): string {
  return result.maximum === undefined
    ? `≥ ${result.minimum}:1`
    : `${result.minimum}–${result.maximum}:1`
}

/** Every enumerated pairing that falls outside its threshold — too faint, or too loud. */
export function findFailures(css: string): ContrastFailure[] {
  const tokens = readColorTokens(css)
  return PAIRINGS.map((pairing) => measure(pairing, tokens)).filter(
    (result) => !withinRange(result),
  )
}
