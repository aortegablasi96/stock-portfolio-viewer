import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { scanDeclarations, stripComments } from './cssDeclarations'
import { FIGURE_FAMILY, figureRoleContext, figureRoleSelectors, isFigureSelector } from './figureRole'

/**
 * The typeface contract (Story #180, DDR-0053).
 *
 * Like `designTokens.test.ts` there is no module under test: the subject is `app.css` and the
 * renderer's HTML shell. Two invariants live here, and they fail for different reasons.
 *
 * The first is a **network** guarantee, and it is the one that matters most. The proposal this
 * milestone adopts loads both faces from `fonts.googleapis.com`, and the renderer's CSP names
 * exactly one external origin *by omitting every other* (ADR-0007). A reinstated `@import` would
 * be blocked at runtime and silently fall back to system-ui — which looks like a font that failed
 * to load, not like a policy violation, so nothing else in the suite would notice.
 *
 * The second is that the figure role stays **one rule**. Its three properties only work together:
 * a mono face without `tabular-nums` still staggers a column on a face whose figures are
 * proportional, and without the negative tracking the digits read as separated at a tile's
 * `--text-xl`. Spread across thirteen call sites, one of them drifts.
 *
 * Comments are stripped before matching. `app.css` explains all of this in prose directly above
 * the rules, quoting the very strings asserted here — the trap DDR-0042 and DDR-0047 both record,
 * where deleting the real declaration left the assertion green off the commentary alone.
 */

const CSS = readFileSync(new URL('../app.css', import.meta.url), 'utf8')
const HTML = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

/** The stylesheet with its prose blanked, so an assertion can only match a real declaration. */
const CODE = stripComments(CSS)

const DECLARATIONS = scanDeclarations(CSS)

/** The declared value of a custom property in `:root`. */
function token(name: string): string {
  const root = CODE.slice(CODE.indexOf(':root {'), CODE.indexOf('}', CODE.indexOf(':root {')))
  const value = new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(root)?.[1]
  expect(value, `${name} is not declared in :root`).toBeDefined()
  return value!.trim()
}

describe('bundled typefaces', () => {
  it('declares one @font-face per family, both variable and both local', () => {
    const faces = DECLARATIONS.filter((d) => d.context === '@font-face')
    const families = faces.filter((d) => d.property === 'font-family').map((d) => d.value)
    expect(families).toEqual(["'Inter'", "'JetBrains Mono'"])

    // A weight *range* is what makes one file cover the proposal's nine static cuts.
    const weights = faces.filter((d) => d.property === 'font-weight').map((d) => d.value)
    expect(weights).toHaveLength(2)
    for (const weight of weights) expect(weight).toMatch(/^\d{3} \d{3}$/)
  })

  it('points each face at a woff2 that is actually in the repo', () => {
    const sources = DECLARATIONS.filter(
      (d) => d.context === '@font-face' && d.property === 'src',
    ).map((d) => d.value)
    expect(sources).toHaveLength(2)

    for (const source of sources) {
      const url = /url\('([^']+)'\)\s+format\('woff2'\)/.exec(source)?.[1]
      expect(url, `${source} is not a single local woff2`).toBeDefined()
      expect(url).toMatch(/^\.\/assets\/fonts\/[a-z-]+\.woff2$/)
      expect(existsSync(new URL(`../${url!.slice(2)}`, import.meta.url)), `${url} is missing`).toBe(
        true,
      )
    }
  })

  it('blocks rather than swaps, so no table is laid out twice', () => {
    // There is no download to hide here — the file sits beside the stylesheet — and `swap` would
    // paint every figure in system-ui first and reflow it under different metrics.
    const display = DECLARATIONS.filter(
      (d) => d.context === '@font-face' && d.property === 'font-display',
    ).map((d) => d.value)
    expect(display).toEqual(['block', 'block'])
  })
})

describe('no font leaves the machine', () => {
  it('references no external font host anywhere in the renderer', () => {
    for (const [name, source] of [
      ['app.css', CODE],
      ['index.html', HTML],
    ] as const) {
      expect(source, `${name} names a font host`).not.toMatch(
        /fonts\.(googleapis|gstatic|bunny|cdnfonts)\.[a-z]+/i,
      )
      expect(source, `${name} loads a remote font file`).not.toMatch(
        /url\(\s*['"]?https?:\/\/[^)]*\.(woff2?|ttf|otf|eot)/i,
      )
    }
  })

  it('declares no @import at all, which is how a font host gets back in', () => {
    expect(CODE).not.toMatch(/@import/)
  })

  it('leaves the CSP at exactly one external origin (ADR-0007)', () => {
    const csp = /content="([^"]*default-src[^"]*)"/.exec(HTML)?.[1]
    expect(csp, 'the renderer declares no Content-Security-Policy').toBeDefined()

    const origins = [...csp!.matchAll(/https?:\/\/[^\s;]+/g)].map((m) => m[0])
    expect(origins).toEqual(['https://api.mapbox.com'])

    // No `font-src` directive was added: `default-src 'self'` already covers it, and every
    // directive this policy does spell out is a directive that can later be widened.
    expect(csp).not.toMatch(/font-src/)
  })
})

describe('the figure role', () => {
  it('declares both families as tokens, each falling back to a generic family', () => {
    expect(token('--font-sans')).toMatch(/^'Inter',.*sans-serif$/)
    expect(token('--font-figure')).toMatch(/^'JetBrains Mono',.*monospace$/)
    // A missing asset must land on system-ui, never on a UA's serif default.
    expect(token('--font-sans')).toContain('system-ui')
  })

  it('tracks figures tighter than prose, as a token', () => {
    expect(token('--tracking-figure')).toMatch(/^-0?\.\d+em$/)
  })

  it('is one rule, carrying all three properties and nothing else', () => {
    const role = figureRoleContext(CSS)
    const declared = DECLARATIONS.filter((d) => d.context === role)
    expect(declared.map((d) => [d.property, d.value])).toEqual([
      ['font-family', FIGURE_FAMILY],
      ['font-variant-numeric', 'tabular-nums'],
      ['letter-spacing', 'var(--tracking-figure)'],
    ])
  })

  it('throws rather than merging, if a second rule ever applies the family', () => {
    // Two rules is the drift the role exists to prevent, and a helper that returned their union
    // would let every caller below keep passing while the guarantee quietly split in two.
    const split = CSS.replace('body {', `.rogue-figure {\n  font-family: ${FIGURE_FAMILY};\n}\n\nbody {`)
    expect(() => figureRoleSelectors(split)).toThrow(/exactly one/)
  })

  it('covers the app’s figures — a KPI value, a table cell, and a chart label', () => {
    for (const selector of [
      '.stat-value',
      '.data-table .data-table-num',
      '.highlight-value',
      '.snapshot-value',
      '.bar-list-value',
      '.chart-axis-label',
      '.chart-tooltip-value',
      '.pie-legend-value',
      '.map-popup-row dd',
    ]) {
      expect(isFigureSelector(CSS, selector), `${selector} is not in the figure role`).toBe(true)
    }
  })

  it('adds no font-size, so a chart label keeps scaling from its viewBox (DDR-0018)', () => {
    // The role reaches four SVG `<text>` selectors. Family and tracking are relative and travel
    // into a viewBox unchanged; a page type step would resize a label against its own geometry.
    const role = figureRoleContext(CSS)
    expect(DECLARATIONS.some((d) => d.context === role && d.property === 'font-size')).toBe(false)
  })

  it('lets no rule declare a raw family, so both roles stay tokenised', () => {
    const stacks = DECLARATIONS.filter(
      (d) => d.property === 'font-family' && d.context !== '@font-face',
    )
    expect(stacks.map((d) => `${d.key} = ${d.value}`).filter((s) => !s.includes('var(--font-'))).toEqual(
      [],
    )
    expect(stacks.length, 'nothing applies a family at all').toBeGreaterThan(1)
  })

  it('keeps prose that merely contains a figure out of the role', () => {
    // Each of these renders a sentence — "Already imported", "Refreshing…", a country name — and
    // keeps its own tabular digits. Setting a whole badge in mono to reach the currency chip
    // inside it is a trade for a variant, not for a selector.
    for (const prose of ['.badge', '.view-updated', '.map-popup-title', '.country-map-unknown']) {
      expect(isFigureSelector(CSS, prose), `${prose} is prose, not a figure`).toBe(false)
      expect(
        DECLARATIONS.some((d) => d.context === prose && d.property === 'font-variant-numeric'),
        `${prose} lost its tabular digits`,
      ).toBe(true)
    }
  })
})
