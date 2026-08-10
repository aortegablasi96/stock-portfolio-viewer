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
function tintMix(tint: MapPopupTint): { edge: number; border: number; tone: string } {
  const body = new RegExp(`\\.map-popup-shell\\.${tint} \\{([^}]*)\\}`).exec(CSS)?.[1]
  expect(body, `${tint} declares no rule`).toBeDefined()
  const read = (property: string): { percent: number; tone: string } => {
    const m = new RegExp(
      `--popup-${property}: color-mix\\(in srgb, var\\((--[\\w-]+)\\) ([\\d.]+)%, var\\(--[\\w-]+\\)\\);`,
    ).exec(body!)
    expect(m, `${tint} does not mix --popup-${property} from a token`).not.toBeNull()
    return { tone: m![1]!, percent: Number(m![2]) }
  }
  const edge = read('edge')
  return { edge: edge.percent, border: read('border').percent, tone: edge.tone }
}

/** The body of the first rule whose selector is exactly this one. */
function ruleBody(selector: string): string {
  return new RegExp(`^\\${selector} \\{([^}]*)\\}`, 'm').exec(CSS)?.[1] ?? ''
}

/**
 * The smallest tint that is still a tint. Not a derived figure — it is the lesson from 12%, which
 * cleared every contrast bar and was reported as no tint at all.
 */
const MIN_TINT_PERCENT = 20

/**
 * The same floor stated perceptually, as the edge's contrast against `--card`. The flat-wash era
 * lived at 1.10–1.15 and read as untinted; the banked edges sit at 1.76 (red) and 2.22 (green).
 */
const MIN_EDGE_SEPARATION = 1.6

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
    const { edge, tone } = tintMix(tint)
    expect(edge).toBeGreaterThanOrEqual(MIN_TINT_PERCENT)
    // The same claim in perceptual terms rather than as a raw percentage: the edge has to stand
    // off `--card` far enough to register as colour. 12% resolved to 1.15 here.
    expect(
      contrast(mixSrgb(rgb(tone), rgb('--card'), edge), rgb('--card')),
      `${tint} edge vs --card`,
    ).toBeGreaterThanOrEqual(MIN_EDGE_SEPARATION)
  })

  /**
   * The invariant that lets the edge be loud: the gradient's two inner stops sit at
   * `--popup-pad-y`, which is also the content's vertical padding. The coloured band is therefore
   * exactly the gutter above the first line and below the last, and no glyph is ever on the tint.
   *
   * Pinned as *geometry* rather than as a contrast figure because that is what the strength now
   * rests on. Take the middle stops off the padding and nothing fails visually at first — the
   * colour just starts creeping under the text of the taller popups, which are the sector cards
   * with six rows.
   */
  it('finishes the gradient before the text starts, at both ends', () => {
    const content = ruleBody('.mapboxgl-popup-content')
    expect(content, 'the content rule is missing').not.toBe('')
    expect(content).toContain('padding: var(--popup-pad-y)')
    expect(content).toMatch(
      /background: linear-gradient\(\s*to bottom,\s*var\(--popup-edge, var\(--card\)\) 0,\s*var\(--popup-edge, var\(--card\)\) var\(--popup-edge-hold\),\s*var\(--card\) var\(--popup-pad-y\),\s*var\(--card\) calc\(100% - var\(--popup-pad-y\)\),\s*var\(--popup-edge, var\(--card\)\) calc\(100% - var\(--popup-edge-hold\)\),\s*var\(--popup-edge, var\(--card\)\) 100%\s*\)/,
    )
  })

  /**
   * The flat-held part of the band is what makes it read as a band rather than a hairline — a ramp
   * that starts fading at the first pixel spends most of its width already halfway to `--card`.
   * It has to stay strictly inside the gutter: at `--popup-edge-hold` the tint is still at full
   * strength, so if that ever reached `--popup-pad-y` the first line of text would sit on it.
   */
  it('holds the colour flat across part of the gutter, and only part', () => {
    const shell = ruleBody('.map-popup-shell')
    const rem = (name: string): number => {
      const m = new RegExp(`${name}: ([\\d.]+)rem;`).exec(shell)
      expect(m, `${name} is not declared on .map-popup-shell in rem`).not.toBeNull()
      return Number(m![1])
    }
    const pad = rem('--popup-pad-y')
    const hold = rem('--popup-edge-hold')
    expect(hold, 'the hold has to leave room for the fade').toBeLessThan(pad)
    expect(hold, 'a band with no flat part is the hairline this replaced').toBeGreaterThan(0)
  })

  /**
   * Because the text sits on `--card` and not on the tint, this is the contrast that has to hold —
   * and it is the *untinted* one. It guards a token retune rather than the tint: nudge `--card` or
   * `--muted` and the popup's labels fall below AA with nothing about the tint having changed.
   */
  it('keeps the popup’s text legible on the surface it actually sits on', () => {
    expect(contrast(rgb('--muted'), rgb('--card')), '--muted').toBeGreaterThanOrEqual(MIN_CONTRAST)
    expect(contrast(rgb('--text'), rgb('--card')), '--text').toBeGreaterThanOrEqual(MIN_CONTRAST)
  })

  /**
   * Up and down are opposite in sign, not in degree. The two tones do not read as equally loud at
   * the same percentage — `--pos` is the darker and more saturated — but pulling them apart to
   * even that out would encode a difference in magnitude that isn't there.
   */
  it('gives both directions the same strength', () => {
    const [pos, neg] = MAP_POPUP_TINTS.map(tintMix)
    expect(pos!.edge).toBe(neg!.edge)
    expect(pos!.border).toBe(neg!.border)
  })

  /** The border frames the whole popup, including the middle, so it stays the louder of the two. */
  it.each(MAP_POPUP_TINTS)('%s draws a border at least as strong as its edge', (tint) => {
    const { edge, border } = tintMix(tint)
    expect(border).toBeGreaterThanOrEqual(edge)
  })

  /**
   * One indirection, not eight anchor-specific rules: the gradient's extremes and all four tip
   * edges read `--popup-edge`, so a tone override is a single pair of declarations. The tip takes
   * the *edge* colour rather than the middle because it attaches to whichever edge Mapbox flipped
   * the popup onto — the loud one — and a `--card` arrow on a coloured edge would read as a seam.
   */
  it('routes the gradient’s extremes and every tip edge through --popup-edge', () => {
    const tips = [...CSS.matchAll(/\.mapboxgl-popup-anchor-\w+ \.mapboxgl-popup-tip \{([^}]*)\}/g)]
    expect(tips.length).toBeGreaterThanOrEqual(4)
    for (const [, body] of tips) {
      expect(body).toContain('var(--popup-edge,')
    }
  })

  /**
   * The untinted popup is the same geometry with the fallback colour, so it collapses to a flat
   * `--card` surface. Every reference has to carry the fallback — one bare `var(--popup-edge)`
   * would resolve to nothing on an untinted popup and drop that stop to transparent, showing the
   * basemap through the popup's own edge.
   */
  it('falls back to a flat --card popup when there is no tint', () => {
    const content = ruleBody('.mapboxgl-popup-content')
    // Every mention of the colour (`--popup-edge-hold` is a length, not a colour, so it is out)
    // has to be the full form with the fallback.
    const mentions = (content.match(/--popup-edge\b(?!-)/g) ?? []).length
    const withFallback = (content.match(/var\(--popup-edge, var\(--card\)\)/g) ?? []).length
    expect(mentions, 'the gradient references no edge colour').toBeGreaterThan(0)
    expect(withFallback, 'an edge stop with no --card fallback').toBe(mentions)
  })

  /**
   * The tint stays on the popup and never reaches a mark.
   *
   * This assertion used to read "the marks keep the diverging scale", pinning `.map-diverge-1`
   * beside it. #160 withdrew the gain/loss mode and the scale went with it, but the half that
   * mattered is unchanged and is now the whole of it: DDR-0021 permits `--pos` / `--neg` here
   * *because a figure sits two rows below the tint*, and a wedge has no figure beside it. So the
   * tint may not paint `fill`, and no mark rule may reach for the return colours.
   */
  it('keeps the return colours off the marks', () => {
    for (const tint of MAP_POPUP_TINTS) {
      const body = new RegExp(`\\.map-popup-shell\\.${tint} \\{([^}]*)\\}`).exec(CSS)?.[1] ?? ''
      expect(body).not.toContain('fill')
    }

    const markRules = [...CSS.matchAll(/^\.country-mark[\w-]* \{([^}]*)\}/gm)].map((m) => m[1] ?? '')
    expect(markRules.length).toBeGreaterThan(0)
    for (const body of markRules) {
      expect(body).not.toMatch(/--pos|--neg/)
    }
  })
})
