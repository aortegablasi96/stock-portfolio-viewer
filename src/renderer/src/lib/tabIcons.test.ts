import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The main tablist's icons (Story #168), which moved into the sidebar with it (Story #182).
 *
 * No module under test — the subject is `TabIcons.tsx` and the tab markup in `App.tsx`, the same
 * shape as `mapAccessibility.test.ts` taking a component as its subject and `designTokens.test.ts`
 * taking the stylesheet as its. It has to be a text guard for the same reason: Vitest runs in Node
 * with no jsdom, so no component may be rendered, and the only place that could observe the real
 * DOM is `e2e/` — which CI does not run, because it needs a display server.
 *
 * What it protects is that this stayed cosmetic. The tablist is the app's most invariant-heavy
 * component (DDR-0029), and an icon is one attribute away from becoming the tab's accessible name:
 * drop `aria-hidden` and a screen reader gains a graphic it cannot describe, while
 * `e2e/tab-navigation.spec.ts`'s five label texts would still pass, since an SVG contributes no
 * text node either way.
 */

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')

/**
 * The source with its comments removed.
 *
 * Not optional, and the trap is recorded twice already — `tokenAdoption.ts` for `app.css`, which
 * quotes lengths in prose, and `mapAccessibility.test.ts` for `CountryMap.tsx`, where deleting a
 * real declaration left an assertion green off the sentence describing it. Both files below
 * explain themselves at length, `aria-hidden` and `currentColor` included.
 */
const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const ICONS = strip(read('../components/TabIcons.tsx'))
const APP = strip(read('../App.tsx'))
const CSS = strip(read('../app.css'))

/**
 * The tabs, in the order `App.tsx` declares them and `tab-navigation.spec.ts` asserts.
 *
 * Six since Story #310, and six again rather than still: Story #280 added the investor profile as
 * a seventh row and #310 folded it into the Assistant view, taking its glyph with it (DDR-0108).
 * A `ProfileIcon` left behind would be a row waiting to be restored, which is why
 * `profileSection.test.ts` asserts its absence beside the absent row.
 */
const TABS = [
  'Portfolio',
  'Performance',
  'Allocation',
  'Dividends',
  'Trades',
  'Assistant',
] as const

describe('every icon renders through the shared frame', () => {
  it.each(TABS)('%s has an icon component', (tab) => {
    expect(ICONS).toMatch(new RegExp(`export function ${tab}Icon\\(\\)`))
    // Through `Glyph`, not its own `<svg>` — which is what makes the assertions below total.
    expect(ICONS).toMatch(new RegExp(`export function ${tab}Icon\\(\\)[\\s\\S]*?<Glyph>`))
  })

  it('declares exactly one <svg>, so no icon can carry its own attributes', () => {
    expect(ICONS.match(/<svg/g)).toHaveLength(1)
  })
})

describe('the frame keeps the icons out of the accessible name', () => {
  it('hides them from assistive technology', () => {
    // The label is the name. An icon that announced itself would give every tab two.
    expect(ICONS).toMatch(/aria-hidden="true"/)
    expect(ICONS).toMatch(/focusable="false"/)
  })

  it('leaves the label beside the icon, as the tab’s only text', () => {
    // The invariant is that the icon is a *second* channel: the label is still there, still text,
    // and still the whole of the tab's `textContent` — which is what `e2e/tab-navigation.spec.ts`
    // asserts when it reads the five tabs as their five names.
    //
    // Story #184 wrapped that text in a `<span>`, because the collapsed rail needs an element to
    // clip; the label is still one text node, and an SVG contributes none. What this pins now is
    // that the wrapper carries nothing but the label — an icon moved inside it, or a second
    // string beside it, would give the tab a name it was never meant to have.
    expect(APP).toMatch(/<Icon \/>\s*<span className="app-tab-label">\{t\.label\}<\/span>/)
  })
})

describe('the icons introduce no colour and no dependency', () => {
  it('draws entirely in currentColor', () => {
    expect(ICONS).toMatch(/stroke="currentColor"/)
    // Any literal colour would be a pairing `lib/contrast.ts` does not cover (DDR-0046).
    expect(ICONS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(ICONS).not.toMatch(/var\(--/)
  })

  it('imports no icon library (ADR-0008)', () => {
    expect(ICONS).not.toMatch(/^\s*import /m)
  })
})

describe('the icons are sized from the token scale', () => {
  it('tracks the tab’s own type step rather than a hand-picked height', () => {
    const rule = CSS.match(/\.app-tab-icon\s*\{([^}]*)\}/)?.[1]
    expect(rule, '.app-tab-icon must exist').toBeDefined()
    expect(rule).toMatch(/width:\s*1em/)
    expect(rule).toMatch(/height:\s*1em/)
    // `lib/tokenAdoption.ts` guards padding, margin, gap, font-size and radius — not width or
    // height — so this is the one part of the story's sizing criterion nothing else can catch.
    expect(rule).not.toMatch(/\d+(\.\d+)?(px|rem)/)
  })

  it('spaces the icon from the label with a spacing step', () => {
    const rule = CSS.match(/\n\.app-tab\s*\{([^}]*)\}/)?.[1]
    expect(rule, '.app-tab must exist').toBeDefined()
    expect(rule).toMatch(/gap:\s*var\(--space-\d\)/)
  })
})

describe('what the icons must not have displaced', () => {
  it('keeps the active tab’s bar', () => {
    // Accent-on-tint is two cues but both are colour; the bar is the non-colour one, and an icon
    // is not a substitute for it (DDR-0029). It rotated with the tablist in Story #182 — a 2px
    // bar under a label became a 3px bar down a row's leading edge — so what is asserted is the
    // marker's thickness, which is its `width` now that its length is the row's own height.
    // `tab-navigation.spec.ts` checks the computed value in a real browser.
    expect(CSS).toMatch(/\.app-tab-active::after\s*\{[^}]*width:\s*3px/)
  })

  it('declares no focus rule of its own', () => {
    // The ring comes from the zero-specificity `:where()` base rule. `designTokens.test.ts` fails
    // on a second `outline` value anywhere; this pins the two new selectors specifically.
    expect(CSS).not.toMatch(/\.app-tab-icon[^{]*\{[^}]*outline/)
    expect(ICONS).not.toMatch(/outline/)
  })
})
