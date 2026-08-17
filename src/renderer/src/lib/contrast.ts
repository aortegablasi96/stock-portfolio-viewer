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

/** A colour used directly, or a token name resolved from `:root`. */
type Colour = { readonly token: string } | { readonly literal: string }

/** One enumerated pairing that really occurs in the UI. */
export interface Pairing {
  /** What renders this pairing, for the failure message. */
  readonly where: string
  readonly foreground: Colour
  readonly background: Colour
  /** Applied to the background, for hover states that filter their own fill. */
  readonly backgroundBrightness?: number
  readonly minimum: number
  readonly reason: string
}

function resolve(colour: Colour, tokens: Map<string, string>): string {
  if ('literal' in colour) return colour.literal
  const hex = tokens.get(colour.token)
  if (hex === undefined) throw new Error(`${colour.token} is not declared in :root`)
  return hex
}

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
    where: '--accent as text — .eyebrow, the active tab, a sorted header, an active toggle',
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
  {
    where: '.chart-axis-label — SVG <text> on a chart card',
    foreground: { token: '--chart-axis' },
    background: { token: '--card' },
    minimum: AA_NORMAL,
    reason:
      'An axis label is text, whatever it is drawn with, so it is held to AA like any other. ' +
      'Listed because --chart-axis is easy to read as chart furniture and dim on that basis.',
  },
]

/** One failing pairing, with the numbers, for the test’s failure message. */
export interface ContrastFailure {
  readonly where: string
  readonly foreground: string
  readonly background: string
  readonly ratio: number
  readonly minimum: number
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
  }
}

/** Every enumerated pairing that falls below its threshold. */
export function findFailures(css: string): ContrastFailure[] {
  const tokens = readColorTokens(css)
  return PAIRINGS.map((pairing) => measure(pairing, tokens)).filter(
    (result) => result.ratio < result.minimum,
  )
}
