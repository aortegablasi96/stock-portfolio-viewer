import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ANIMATED_CLASS,
  COLLAPSED_CLASS,
  SIDEBAR_TOGGLE_LABELS,
  collapsedTitle,
  shellClassName,
  sidebarClassName,
  sidebarToggleLabel,
} from './sidebarCollapse'

/**
 * The sidebar's collapse (Story #184, DDR-0057).
 *
 * Half of this has a module under test and half does not, which is the same split
 * `sidebarRail.test.ts` lives with. The class names and the wording are functions and are tested
 * as functions; the rest of the story is a set of promises about `app.css`, `App.tsx` and
 * `SidebarRail.tsx` that only a real browser could observe — Vitest runs Node-only with no jsdom,
 * so no component can be rendered (DDR-0029). Those are text guards here and behaviour in
 * `e2e/sidebar-collapse.spec.ts`, which CI does not run because it needs a display server.
 *
 * What this protects is the part that is a decision rather than a calculation: that collapse is
 * one flag and not a prop threaded through the rail, that a clipped label is still a name, that
 * the width is drawn from the motion scale so reduced motion reaches it, and that the state is
 * persisted the way DDR-0028 persists the window's own.
 */

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')

/* Comments blanked, for the reason DDR-0042 and DDR-0047 both record: every file below explains
   itself in prose that names the very tokens and attributes being scanned for. */
const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const APP = strip(read('../App.tsx'))
const RAIL = strip(read('../components/SidebarRail.tsx'))
const CSS = strip(read('../app.css'))
const SERVICE = strip(read('../../../services/window/sidebarStateService.ts'))
const HANDLERS = strip(read('../../../main/ipc/handlers.ts'))

/** One rule's body, by selector — the same reader `sidebarRail.test.ts` uses. */
const rule = (selector: string): string | undefined =>
  CSS.match(new RegExp(`\\n${selector.replace(/[.*+?^$()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1]

describe('the two widths, as class names', () => {
  it('flags the shell rather than the sidebar, so one class reaches every rule', () => {
    expect(shellClassName(false)).toBe('app')
    expect(shellClassName(true)).toBe(`app ${COLLAPSED_CLASS}`)
  })

  it('arms the transition separately from the width', () => {
    // The two are separate precisely so the stored width can be applied without animating to it.
    expect(sidebarClassName(false)).toBe('app-sidebar')
    expect(sidebarClassName(true)).toBe(`app-sidebar ${ANIMATED_CLASS}`)
  })
})

describe('the toggle', () => {
  it('names the action rather than the state, which aria-expanded already carries', () => {
    expect(sidebarToggleLabel(false)).toBe(SIDEBAR_TOGGLE_LABELS.collapse)
    expect(sidebarToggleLabel(true)).toBe(SIDEBAR_TOGGLE_LABELS.expand)
    expect(SIDEBAR_TOGGLE_LABELS.collapse).not.toBe(SIDEBAR_TOGGLE_LABELS.expand)
  })

  it('is one visible, labelled control, not the prototype’s invisible strip and second button', () => {
    expect(RAIL.match(/<Button/g)).toHaveLength(1)
    expect(RAIL).toMatch(/aria-label=\{label\}/)
    expect(RAIL).toMatch(/aria-expanded=\{!collapsed\}/)
    // A tooltip on top of a name, never instead of one.
    expect(RAIL).toMatch(/title=\{label\}/)
  })

  it('is in the head row beside the brand, above the tablist (Story #218)', () => {
    const brand = APP.indexOf('<SidebarBrand')
    const toggle = APP.indexOf('<SidebarToggle')
    const tablist = APP.indexOf('role="tablist"')
    const currency = APP.indexOf('<CurrencySelector')
    expect(toggle).toBeGreaterThan(-1)
    expect(toggle).toBeGreaterThan(brand)
    // DOM order is the Tab order, and this is the whole of it: toggle → tabs → currency → panel.
    // `e2e/tab-navigation.spec.ts` walks it in a real browser.
    expect(toggle).toBeLessThan(tablist)
    expect(tablist).toBeLessThan(currency)
    // And it is one row with the brand rather than a third child of the column head, because the
    // badge below still needs a line of its own.
    expect(APP).toMatch(/app-sidebar-head-row[\s\S]{0,200}<SidebarBrand[\s\S]{0,200}<SidebarToggle/)
    // The footer it left is the currency alone; the wrapper it had there is gone from both files.
    expect(APP).not.toMatch(/app-sidebar-toggle-row/)
    expect(CSS).not.toMatch(/app-sidebar-toggle-row/)
  })

  it('is fitted by wrapping the product’s name, never by abbreviating it or widening the column', () => {
    // Story #184 measured this and decided the other way: a control beside the brand ellipsised
    // "Stock Portfolio Viewer" to "Stock Portfolio…". #218 answers the measurement instead of
    // ignoring it — the name wraps to two lines and the head row grows in height.
    const name = rule('.app-brand-name')
    expect(name, '.app-brand-name must exist').toBeDefined()
    expect(name).not.toMatch(/text-overflow/)
    expect(name).not.toMatch(/white-space:\s*nowrap/)
    expect(name).toMatch(/line-height:\s*var\(--leading-tight\)/)
    // Neither width moved, so neither grid breakpoint derived from them can have (DDR-0051).
    expect(CSS).toMatch(/--sidebar-width:\s*220px/)
    expect(CSS).toMatch(/--sidebar-width-collapsed:\s*56px/)
  })

  it('keeps both the tile and the control visible on the rail, by stacking them', () => {
    // 40px of content holds one of them across, so the row turns the corner rather than dropping
    // either: the rail still shows the brand and exactly one visible control.
    expect(rule('.app-collapsed .app-sidebar-head-row')).toMatch(/flex-direction:\s*column/)
  })

  it('introduces no raw length in the row that carries it', () => {
    // The head row is the one new rule this story adds; `lib/tokenAdoption.ts` guards the
    // stylesheet at large, and this pins the selector specifically.
    //
    // The 1px hairline Story #219 added is not a length this is looking for: it is the border
    // width every rule in the stylesheet is drawn at, and the token in it is the colour. So it is
    // struck before the scan rather than allowed through the pattern, which would also let a
    // hand-picked `padding: 13px` past (DDR-0069).
    const head = rule('.app-sidebar-head-row')?.replace(/^\s*border[^;]*;$/gm, '')
    expect(head, '.app-sidebar-head-row must exist').toBeDefined()
    expect(head).toMatch(/gap:\s*var\(--space-\d\)/)
    expect(head).toMatch(/padding:\s*var\(--space-\d\) var\(--space-\d\)/)
    expect(head).not.toMatch(/\d+(\.\d+)?(px|rem)/)
  })

  it('reaches no IPC of its own — the shell owns the state and the write', () => {
    expect(RAIL).not.toMatch(/window\.api/)
    expect(RAIL).toMatch(/onToggle: \(\) => void/)
  })
})

describe('selecting a view while collapsed does not reopen the column', () => {
  it('leaves the tab-selection path untouched by collapse', () => {
    // The prototype re-expands on every nav click, which defeats the point of collapsing. The
    // only writer of the flag is the toggle's own callback, called from exactly one place.
    expect(APP.match(/setSidebarCollapsed\(/g)).toHaveLength(1)
    const select = APP.match(/const select = useCallback\([\s\S]*?\}, \[\]\)/)?.[0]
    expect(select, 'select must exist').toBeDefined()
    expect(select).not.toMatch(/ollapsed/)
  })
})

describe('a collapsed row keeps its name', () => {
  it('clips the five labels in one rule, rather than removing them', () => {
    // `display: none` would take the text out of the accessibility tree and leave `title` as the
    // mechanism, which is the thing the story rules out.
    //
    // The fifth is the tablist's own "Views" title (Story #234). It joins the rule rather than
    // being dropped at 56px for a reason the other four share and it sharpens: it is the
    // tablist's accessible name via `aria-labelledby`, so removing it would leave the region
    // unnamed on the rail — the same failure as a nav row losing its label, one level up.
    const hidden = CSS.match(
      /\n\.app-collapsed \.app-brand-name,\n\.app-collapsed \.gateway-badge-text,\n\.app-collapsed \.app-tab-label,\n\.app-collapsed \.app-nav-label,\n\.app-collapsed \.app-currency \.field-label \{([^}]*)\}/,
    )?.[1]
    expect(hidden, 'the one hidden-label rule must exist').toBeDefined()
    expect(hidden).toMatch(/clip:\s*rect\(0, 0, 0, 0\)/)
    expect(hidden).toMatch(/position:\s*absolute/)
    expect(hidden).not.toMatch(/display:\s*none/)
    expect(hidden).not.toMatch(/visibility:\s*hidden/)
  })

  it('gives the label an element to clip without giving the tab a second name', () => {
    expect(APP).toMatch(/<span className="app-tab-label">\{t\.label\}<\/span>/)
    // No `aria-label` on the tab: the name is the label text, in both states.
    expect(APP).not.toMatch(/role="tab"[\s\S]{0,600}aria-label=/)
  })

  it('adds the tooltip only while the label is clipped', () => {
    expect(collapsedTitle(true, 'Performance')).toBe('Performance')
    expect(collapsedTitle(false, 'Performance')).toBeUndefined()
    expect(APP).toMatch(/title=\{collapsedTitle\(collapsed, t\.label\)\}/)
  })
})

describe('the status dot grows a second channel where its words are clipped', () => {
  /**
   * DDR-0056 made the *wording* the channel and the dot its second. On the rail the wording is
   * clipped, so without this the three tones would be separated by hue alone — the one thing
   * DDR-0021 forbids. Shape is the channel that fits in 12px: filled, hollow, haloed.
   */
  it('draws idle hollow and warn haloed, so no pair of tones is colour alone', () => {
    expect(rule('.app-collapsed .gateway-badge-idle .gateway-dot')).toMatch(/box-shadow:\s*inset/)
    expect(rule('.app-collapsed .gateway-badge-warn .gateway-dot')).toMatch(/box-shadow:\s*0 0 0/)
    // Still `currentColor`, so a tone remains one declaration and introduces no pairing
    // `lib/contrast.ts` does not already cover (DDR-0046).
    expect(rule('.app-collapsed .gateway-badge-idle .gateway-dot')).toMatch(/currentColor/)
    expect(rule('.app-collapsed .gateway-badge-warn .gateway-dot')).toMatch(/currentColor/)
  })

  it('grows the dot from the spacing scale first, because a ring on 8px is a smudge', () => {
    const dot = rule('.app-collapsed .gateway-dot')
    expect(dot, '.app-collapsed .gateway-dot must exist').toBeDefined()
    expect(dot).toMatch(/width:\s*var\(--space-\d\)/)
    expect(dot).toMatch(/height:\s*var\(--space-\d\)/)
  })
})

describe('the width is on the motion scale', () => {
  it('transitions width alone, from the tokens', () => {
    const animated = rule(`.${ANIMATED_CLASS}`)
    expect(animated, `.${ANIMATED_CLASS} must exist`).toBeDefined()
    // `lib/motionTokens.ts` fails a raw duration or easing anywhere; this pins that the rule the
    // reduced-motion override has to reach is *this* one, and that it moves only the width.
    expect(animated).toMatch(/transition:\s*width var\(--duration-base\) var\(--ease-out\)/)
    expect(animated).not.toMatch(/\d+m?s/)
  })

  it('takes its two widths from the shell’s own tokens', () => {
    expect(rule('.app-collapsed .app-sidebar')).toMatch(/width:\s*var\(--sidebar-width-collapsed\)/)
    expect(CSS).toMatch(/--sidebar-width-collapsed:\s*56px/)
  })
})

describe('the state is remembered the way the window’s own bounds are', () => {
  it('is one overwritten app_meta value, through the repository', () => {
    expect(SERVICE).toMatch(/metaRepository/)
    expect(SERVICE).toMatch(/'sidebar_state'/)
    // No new table, and no second mechanism: the story's own reference.
    expect(SERVICE).not.toMatch(/@db|drizzle|sqliteTable/)
  })

  it('does not import electron, like every other service (DDR-0028)', () => {
    expect(SERVICE).not.toMatch(/from 'electron'/)
  })

  it('parses what it read, so a hand-edited row costs a preference rather than a launch', () => {
    expect(SERVICE).toMatch(/safeParse/)
  })

  it('is validated at the handler, like every other channel with a payload', () => {
    expect(HANDLERS).toMatch(/sidebarStateSchema\.parse\(rawInput\)/)
  })

  it('is read once on launch and written only on a toggle', () => {
    expect(APP.match(/window\.api\.getSidebarState/g)).toHaveLength(1)
    expect(APP.match(/window\.api\.setSidebarState/g)).toHaveLength(1)
    // Nothing polls and nothing writes on render: the write sits beside the state update.
    expect(APP).not.toMatch(/setInterval/)
  })

  it('applies a stored collapse without animating to it', () => {
    // Otherwise every launch replays a decision the owner made on a previous one.
    expect(APP).toMatch(/setCollapsed\(state\.collapsed\)[\s\S]{0,160}requestAnimationFrame/)
  })
})

describe('what collapse must not have displaced', () => {
  it('leaves the title bar spanning the window above the sidebar', () => {
    // The bar is the window's only grab handle, and DDR-0028 judges a restored window's
    // reachability on it. A sidebar beside it would make the drag region's width a function of a
    // navigation preference.
    // `{}` is what a stripped JSX comment leaves behind.
    expect(APP).toMatch(/<TitleBar \/>\s*(\{\})?\s*<div className="app-body">/)
    expect(rule('.titlebar')).toMatch(/position:\s*sticky/)
    expect(rule('.app-sidebar')).toMatch(/top:\s*var\(--titlebar-height\)/)
  })

  it('keeps the tabs pattern exactly as it was', () => {
    expect(APP).toMatch(/aria-orientation="vertical"/)
    expect(APP).toMatch(/tabIndex=\{isActive \? 0 : -1\}/)
    expect(APP).toMatch(/aria-controls=\{isActive \? panelDomId\(t\.id\) : undefined\}/)
  })

  it('declares no focus rule of its own', () => {
    // The ring comes from the zero-specificity `:where()` base rule.
    expect(RAIL).not.toMatch(/outline/)
    for (const selector of [
      '.app-sidebar-head-row',
      '.app-sidebar-animated',
      '.app-collapsed .app-tab',
      '.app-collapsed .app-currency .control',
    ]) {
      expect(rule(selector) ?? '').not.toMatch(/outline/)
    }
  })

  it('re-declares no colour or border on the rail’s currency control (DDR-0035)', () => {
    const control = rule('.app-collapsed .app-currency .control')
    expect(control, 'the rail’s currency control must exist').toBeDefined()
    expect(control).not.toMatch(/color|border|background/)
  })
})
