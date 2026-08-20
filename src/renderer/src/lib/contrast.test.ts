import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AA_NORMAL,
  NON_TEXT,
  PAIRINGS,
  SURFACE_EDGE,
  brightness,
  contrastRatio,
  findFailures,
  measure,
  readColorTokens,
  relativeLuminance,
} from './contrast'

/**
 * The contrast guard (Story #163).
 *
 * Two halves, as in `tokenAdoption.test.ts`: the arithmetic is unit-tested against values with
 * known answers, and the contract runs against the real stylesheet.
 */

const CSS = readFileSync(new URL('../app.css', import.meta.url), 'utf8')

describe('relative luminance', () => {
  it('anchors at the ends of the range', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
  })

  it('weights green most and blue least, as the WCAG coefficients do', () => {
    expect(relativeLuminance('#00ff00')).toBeGreaterThan(relativeLuminance('#ff0000'))
    expect(relativeLuminance('#ff0000')).toBeGreaterThan(relativeLuminance('#0000ff'))
  })
})

describe('contrast ratio', () => {
  it('spans 1:1 to 21:1', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1)
    expect(contrastRatio('#4c8dff', '#4c8dff')).toBeCloseTo(1, 5)
  })

  it('does not depend on the order of its arguments', () => {
    expect(contrastRatio('#d03b3b', '#171a21')).toBeCloseTo(contrastRatio('#171a21', '#d03b3b'), 10)
  })

  it('reproduces the figures the audit reported', () => {
    // These are the numbers in #163. If the arithmetic here disagreed with axe-core, the guard
    // would be measuring something other than what the audit found.
    expect(contrastRatio('#d03b3b', '#171a21')).toBeCloseTo(3.62, 2)
    expect(contrastRatio('#d03b3b', '#0f1115')).toBeCloseTo(3.93, 2)
    expect(contrastRatio('#ffffff', '#4c8dff')).toBeCloseTo(3.2, 2)
    expect(contrastRatio('#0ca30c', '#171a21')).toBeCloseTo(5.19, 2)
  })
})

describe('brightness', () => {
  it('models the filter the primary button’s hover applies', () => {
    expect(brightness('#646464', 2)).toBe('#c8c8c8')
  })

  it('clamps rather than wrapping, which would darken a bright channel', () => {
    expect(brightness('#ffffff', 1.5)).toBe('#ffffff')
  })

  it('lowers contrast against white — the reason hover is the binding measurement', () => {
    const rest = contrastRatio('#ffffff', '#1360e7')
    const hover = contrastRatio('#ffffff', brightness('#1360e7', 1.08))
    expect(hover).toBeLessThan(rest)
  })
})

describe('reading the palette', () => {
  const tokens = readColorTokens(CSS)

  it('finds the colour tokens and ignores the length scales', () => {
    expect(tokens.get('--card')).toBe('#0f1320')
    expect(tokens.get('--neg')).toBe('#e11d48')
    expect(tokens.has('--space-4')).toBe(false)
  })

  it('is not fooled by a hex quoted in a comment', () => {
    // `app.css` discusses colours in prose above the tokens; a text scan that missed this would
    // read a documented value as a declaration.
    expect(readColorTokens(':root {\n  /* --neg: #000000 */\n  --neg: #d03b3b;\n}').get('--neg')).toBe(
      '#d03b3b',
    )
  })
})

describe('the pairing list', () => {
  it('gives every pairing a reason, since it is maintained by hand', () => {
    for (const pairing of PAIRINGS) {
      expect(pairing.reason.length, `${pairing.where} has no reason`).toBeGreaterThan(30)
    }
  })

  it('lists both tones, so they cannot drift apart again', () => {
    const text = PAIRINGS.map((p) => p.where).join(' ')
    expect(text).toMatch(/\.stat-positive/)
    expect(text).toMatch(/\.stat-negative/)
  })

  it('lists a hover state, which the audit could not see', () => {
    expect(PAIRINGS.some((p) => p.backgroundBrightness !== undefined)).toBe(true)
  })

  /**
   * The surface-edge floor (Story #219, DDR-0069). It is the one threshold in this module that no
   * standard hands us, so what it means has to be pinned rather than remembered: it sits above the
   * separation two surfaces manage by fill alone, and below every accessibility bar — a decorative
   * boundary must not be confused for a control's.
   */
  it('holds the surface-edge floor between a fill-only step and the accessibility bars', () => {
    const tokens = readColorTokens(CSS)
    const fillOnly = contrastRatio(tokens.get('--card')!, tokens.get('--bg')!)
    expect(SURFACE_EDGE).toBeGreaterThan(fillOnly)
    expect(SURFACE_EDGE).toBeLessThan(NON_TEXT)
    // And it is the app's own edge, not a number chosen to clear one chip: --border on --card is
    // every card's inner edge and every table rule, and it is what this floor is calibrated to.
    expect(contrastRatio(tokens.get('--border')!, tokens.get('--card')!)).toBeGreaterThanOrEqual(
      SURFACE_EDGE,
    )
  })

  it('fails loudly if a pairing names a token that no longer exists', () => {
    const tokens = readColorTokens(CSS)
    expect(() =>
      measure(
        {
          where: 'gone',
          foreground: { token: '--not-a-token' },
          background: { token: '--card' },
          minimum: AA_NORMAL,
          reason: 'A pairing whose token was deleted must fail, not silently pass.',
        },
        tokens,
      ),
    ).toThrow(/--not-a-token/)
  })
})

/**
 * The contract. This is the assertion that would have caught the audit's findings.
 */
describe('app.css contrast', () => {
  it('meets AA on every enumerated pairing', () => {
    const failures = findFailures(CSS).map(
      (f) =>
        `${f.where}\n    ${f.foreground} on ${f.background} = ${f.ratio.toFixed(2)}:1` +
        `, needs ${f.minimum}:1`,
    )
    expect(failures, `\n${failures.join('\n')}\n`).toEqual([])
  })

  it('keeps the loss tone at least as legible as the gain tone', () => {
    // The finding behind this story was not that --neg was below a number; it was that losses
    // were harder to read than gains. That asymmetry is the thing worth pinning.
    const tokens = readColorTokens(CSS)
    // `--surface-raised` joined the list in Story #219: the gateway chip renders both tones on it,
    // so it is the third surface on which the asymmetry could reappear (DDR-0069).
    for (const surface of ['--card', '--bg', '--surface-raised'] as const) {
      const background = tokens.get(surface)!
      const negative = contrastRatio(tokens.get('--neg-text')!, background)
      const positive = contrastRatio(tokens.get('--pos')!, background)
      expect(negative, `--neg-text is less legible than --pos on ${surface}`).toBeGreaterThanOrEqual(
        positive - 0.5,
      )
    }
  })

  it('keeps --neg for fills only, and --neg-text off them', () => {
    // The split is the whole design (DDR-0021's validated value survives untouched). If a fill
    // adopted --neg-text, or a text rule went back to --neg, the guard above would still pass
    // while the thing it protects had quietly moved.
    const textRules = /\.(btn-danger|stat-negative)\s*\{[^}]*\}/g
    for (const [rule] of CSS.matchAll(textRules)) {
      if (rule.includes('color:')) expect(rule).toMatch(/color:\s*var\(--neg-text\)/)
    }
    expect(CSS).toMatch(/\.chart-bar-loss\s*\{\s*fill:\s*var\(--neg\)/)
    expect(CSS).not.toMatch(/fill:\s*var\(--neg-text\)/)
  })
})
