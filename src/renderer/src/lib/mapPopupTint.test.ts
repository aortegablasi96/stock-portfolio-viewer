import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MAP_POPUP_TINTS, mapPopupTintClassName, type MapPopupTint } from './mapPopupTint'

/**
 * The Allocation map popup's return tint (Story #122, strengthened in Story #149).
 *
 * Two halves, as elsewhere in `lib/`: the class choice, and the stylesheet that has to back it.
 * The second half is unusual and is the point of the file — it does not check that a declaration
 * *exists*, it resolves the `color-mix()` the way the browser will and recomputes the contrast of
 * the popup's own text against the result.
 *
 * That is worth the arithmetic because this shipped wrong once in the quiet direction. The tint
 * was mixed to 12% to protect the muted text, which worked so well the tint was invisible: it
 * moved `--card` by 16 points on a single channel, and the feature read as unimplemented. Both
 * failure modes are one number, and neither is visible in a diff — a class-name assertion would
 * have passed at 12%, and would pass again at 60% with the labels unreadable on top.
 */

const CSS = readFileSync(new URL('../app.css', import.meta.url), 'utf8')

/** The `:root` block, which declares every token and contains no nested braces. */
function rootBlock(): string {
  const start = CSS.indexOf(':root {')
  expect(start).toBeGreaterThanOrEqual(0)
  return CSS.slice(start, CSS.indexOf('}', start))
}

/** The declared value of a custom property, with any trailing comment stripped. */
function token(name: string): string {
  const value = new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(rootBlock())?.[1]
  expect(value, `${name} is not declared in :root`).toBeDefined()
  return value!.trim()
}

type Rgb = [number, number, number]

/** A `#rrggbb` token as channel values. */
function rgb(name: string): Rgb {
  const hex = token(name)
  expect(hex, `${name} is "${hex}", not a plain hex colour`).toMatch(/^#[0-9a-f]{6}$/i)
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb
}

/** `color-mix(in srgb, tone p%, base)` — the browser's arithmetic, in the same space. */
function mixSrgb(tone: Rgb, base: Rgb, percent: number): Rgb {
  const p = percent / 100
  return tone.map((v, i) => Math.round(v * p + base[i]! * (1 - p))) as Rgb
}

/** WCAG relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const channel = (v: number): number => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio, 1–21. */
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** The two mix strengths a tone's rule declares, read straight out of the stylesheet. */
function tintMix(tint: MapPopupTint): { surface: number; border: number; tone: string } {
  const body = new RegExp(`\\.map-popup-shell\\.${tint} \\{([^}]*)\\}`).exec(CSS)?.[1]
  expect(body, `${tint} declares no rule`).toBeDefined()
  const read = (property: string): { percent: number; tone: string } => {
    const m = new RegExp(
      `--popup-${property}: color-mix\\(in srgb, var\\((--[\\w-]+)\\) ([\\d.]+)%, var\\(--[\\w-]+\\)\\);`,
    ).exec(body!)
    expect(m, `${tint} does not mix --popup-${property} from a token`).not.toBeNull()
    return { tone: m![1]!, percent: Number(m![2]) }
  }
  const surface = read('surface')
  return { surface: surface.percent, border: read('border').percent, tone: surface.tone }
}

/**
 * The smallest tint that is still a tint. Not a derived figure — it is the lesson from 12%, which
 * cleared every contrast bar and was reported as no tint at all.
 */
const MIN_TINT_PERCENT = 20

/** WCAG AA for normal text. The popup's labels are 0.78rem — 12.5px — so this is the bar. */
const MIN_CONTRAST = 4.5

describe('mapPopupTintClassName', () => {
  it('tints by direction', () => {
    expect(mapPopupTintClassName(12.5)).toBe('map-popup-pos')
    expect(mapPopupTintClassName(-0.4)).toBe('map-popup-neg')
  })

  /**
   * Flat and unknown share the untinted surface because colour cannot separate them. The popup
   * prints the figure — `—` for the second — rather than asking the tint to say something it has
   * no way to say.
   */
  it('leaves a flat or uncomputable return untinted', () => {
    expect(mapPopupTintClassName(0)).toBeNull()
    expect(mapPopupTintClassName(null)).toBeNull()
  })

  it('only ever returns a class the popup knows how to shed', () => {
    for (const pct of [-100, -1, 1, 1000]) {
      expect(MAP_POPUP_TINTS).toContain(mapPopupTintClassName(pct))
    }
  })
})

describe('the stylesheet backs the tint', () => {
  it('mixes both tones from the app’s own tone tokens', () => {
    expect(tintMix('map-popup-pos').tone).toBe('--pos')
    expect(tintMix('map-popup-neg').tone).toBe('--neg')
  })

  /**
   * The regression this story exists for. A tint below this is arithmetically present and
   * practically absent.
   */
  it.each(MAP_POPUP_TINTS)('%s is strong enough to be seen', (tint) => {
    expect(tintMix(tint).surface).toBeGreaterThanOrEqual(MIN_TINT_PERCENT)
  })

  /**
   * The other end of the same number. `--muted` is the binding constraint, not `--text`: the
   * company name and every row label are muted, and they are what a stronger tint erodes first.
   */
  it.each(MAP_POPUP_TINTS)('%s keeps the popup’s text legible on it', (tint) => {
    const { surface, tone } = tintMix(tint)
    const tinted = mixSrgb(rgb(tone), rgb('--card'), surface)
    expect(contrast(rgb('--muted'), tinted), `${tint} vs --muted`).toBeGreaterThanOrEqual(
      MIN_CONTRAST,
    )
    expect(contrast(rgb('--text'), tinted), `${tint} vs --text`).toBeGreaterThanOrEqual(
      MIN_CONTRAST,
    )
  })

  /**
   * Up and down are opposite in sign, not in degree. The two tones do not read as equally loud at
   * the same percentage — `--pos` is the darker and more saturated — but pulling them apart to
   * even that out would encode a difference in magnitude that isn't there.
   */
  it('gives both directions the same strength', () => {
    const [pos, neg] = MAP_POPUP_TINTS.map(tintMix)
    expect(pos!.surface).toBe(neg!.surface)
    expect(pos!.border).toBe(neg!.border)
  })

  /** The border reinforces the surface, so it stays the louder of the two. */
  it.each(MAP_POPUP_TINTS)('%s draws a border at least as strong as its surface', (tint) => {
    const { surface, border } = tintMix(tint)
    expect(border).toBeGreaterThan(surface)
  })

  /**
   * One indirection, not eight anchor-specific rules: the body and all four tip edges read
   * `--popup-surface`, so a tone override is a single pair of declarations and the popup can never
   * end up a tinted box with a `--card` arrow.
   */
  it('routes the body and every tip edge through --popup-surface', () => {
    expect(CSS).toMatch(/^\.mapboxgl-popup-content \{[^}]*background: var\(--popup-surface,/m)
    const tips = [...CSS.matchAll(/\.mapboxgl-popup-anchor-\w+ \.mapboxgl-popup-tip \{([^}]*)\}/g)]
    expect(tips.length).toBeGreaterThanOrEqual(4)
    for (const [, body] of tips) {
      expect(body).toContain('var(--popup-surface,')
    }
  })

  /** The marks keep the diverging scale: this story is the popup only (DDR-0021, DDR-0030). */
  it('leaves the map’s own return scale alone', () => {
    for (const tint of MAP_POPUP_TINTS) {
      const body = new RegExp(`\\.map-popup-shell\\.${tint} \\{([^}]*)\\}`).exec(CSS)?.[1] ?? ''
      expect(body).not.toContain('fill')
    }
    expect(CSS).toMatch(/^\.map-diverge-1 \{/m)
  })
})
