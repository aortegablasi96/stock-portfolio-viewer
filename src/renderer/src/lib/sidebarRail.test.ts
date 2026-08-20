import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The sidebar's context rail (Story #183, DDR-0056).
 *
 * No module under test: the subject is `components/SidebarRail.tsx`, the shell that mounts it and
 * the rules that style it — the same shape as `tabIcons.test.ts` and `mapAccessibility.test.ts`.
 * It has to be a text guard for the same reason those are: Vitest runs in Node with no jsdom, so
 * no component can be rendered, and the only place that could observe the real DOM is `e2e/`,
 * which CI does not run because it needs a display server. What *is* renderable logic —
 * `describeGateway` and its staleness window — is tested properly in `gatewayStatus.test.ts`.
 *
 * What this protects is the half of the story that is a promise rather than a calculation: that
 * the badge reports a reading somebody else took, that the rail introduces no colour and no
 * length outside the scales, and that the display-currency control kept everything DDR-0035 gave
 * it when it moved out of the Portfolio header.
 */

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')

/**
 * The source with its comments removed.
 *
 * Not optional, and recorded three times already (`tokenAdoption.ts`, `mapAccessibility.test.ts`,
 * `tabIcons.test.ts`): every file below explains itself at length and names `window.api`,
 * `setInterval` and `currentColor` in its own prose, so a scan over the raw text would pass off
 * the commentary after the real declaration was deleted.
 */
const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const RAIL = strip(read('../components/SidebarRail.tsx'))
const APP = strip(read('../App.tsx'))
const DASHBOARD = strip(read('../components/PortfolioDashboard.tsx'))
const SELECTOR = strip(read('../components/CurrencySelector.tsx'))
const STATUS = strip(read('./gatewayStatus.ts'))
const CSS = strip(read('../app.css'))

/** One rule's body, by selector. */
const rule = (selector: string): string | undefined =>
  CSS.match(new RegExp(`\\n${selector.replace(/[.*+?^$()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1]

describe('the badge reports; it does not ask', () => {
  it('reaches no IPC channel of its own', () => {
    // The whole source-of-truth decision in one assertion: the rail renders what the Portfolio
    // view already learned. A `window.api` call here would be a second caller of the gateway,
    // living in a component that never unmounts (DDR-0022, DDR-0024).
    expect(RAIL).not.toMatch(/window\.api/)
    expect(STATUS).not.toMatch(/window\.api/)
  })

  it('starts no repeating timer', () => {
    // A poll is what the story forbids, and an interval is how one would arrive by accident —
    // "just to keep the clock honest". The one timer the rail owns is a single `setTimeout`,
    // armed for the moment a live reading ages out.
    expect(RAIL).not.toMatch(/setInterval/)
    expect(STATUS).not.toMatch(/setInterval/)
    expect(RAIL.match(/setTimeout/g)).toHaveLength(1)
  })

  it('takes its reading from the shell, which takes it from the Portfolio view', () => {
    expect(RAIL).toMatch(/reading: GatewayReading \| null/)
    expect(APP).toMatch(/<GatewayBadge reading=\{gateway\} \/>/)
    expect(DASHBOARD).toMatch(/onGatewayReading\(readingFrom\(result\.status, Date\.now\(\)\)\)/)
  })

  it('is reported on a failed read too, so the badge cannot go stale silently', () => {
    // Two call sites: the resolved result, and the catch. A read that threw still observed the
    // gateway, and leaving the badge on its last success is exactly the "live on stale
    // information" the story rules out.
    expect(DASHBOARD.match(/onGatewayReading\(/g)).toHaveLength(2)
  })
})

describe('the brand mark', () => {
  it('names the product, not the prototype’s', () => {
    expect(RAIL).toMatch(/Stock Portfolio Viewer/)
    expect(RAIL).not.toMatch(/PortfolioOS/)
  })

  it('draws in currentColor and introduces no colour of its own', () => {
    // Any literal or token here would be a pairing `lib/contrast.ts` does not cover (DDR-0046).
    // The tile's fill and ink are a CSS rule, and both are measured.
    expect(RAIL).toMatch(/stroke="currentColor"/)
    expect(RAIL).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(RAIL).not.toMatch(/var\(--/)
  })

  it('is hidden from assistive technology, because the name beside it is the name', () => {
    expect(RAIL).toMatch(/aria-hidden="true"/)
    expect(RAIL).toMatch(/focusable="false"/)
  })

  it('imports no icon library (ADR-0008)', () => {
    expect(RAIL).not.toMatch(/^\s*import .*(lucide|heroicons|react-icons)/m)
  })

  it('is sized from the type scale rather than by a hand-picked height', () => {
    // `lib/tokenAdoption.ts` guards padding, margin, gap, font-size and radius — not width or
    // height — so this is the only thing that catches a px glyph (the trap DDR-0048 records).
    const glyph = rule('.app-brand-glyph')
    expect(glyph, '.app-brand-glyph must exist').toBeDefined()
    expect(glyph).toMatch(/width:\s*1em/)
    expect(glyph).toMatch(/height:\s*1em/)
    expect(glyph).not.toMatch(/\d+(\.\d+)?(px|rem)/)

    const mark = rule('.app-brand-mark')
    expect(mark, '.app-brand-mark must exist').toBeDefined()
    // The tile is a box, and 32px is on the spacing scale — so it needs no length of its own.
    expect(mark).toMatch(/width:\s*var\(--space-\d\)/)
    expect(mark).toMatch(/height:\s*var\(--space-\d\)/)
    expect(mark).toMatch(/border-radius:\s*var\(--radius-(sm|md|lg)\)/)
  })

  it('fills with the accent’s measured fill half, not its text half (DDR-0046)', () => {
    // White sits on this tile. `--accent` is the text token and is 4.47:1 under white;
    // `--accent-strong` is the one `lib/contrast.ts` measures for exactly this pairing.
    expect(rule('.app-brand-mark')).toMatch(/background:\s*var\(--accent-strong\)/)
  })
})

describe('the status dot is a second channel, and a tokenised one', () => {
  it('declares all three tones, and keeps the loss split straight', () => {
    // A dot is a filled shape (`--neg`); the detail line beside it is text (`--neg-text`).
    // Picking the wrong half of that split is silent, which is why it is asserted rather than
    // trusted (DDR-0046).
    expect(rule('.gateway-badge-live')).toMatch(/--gateway-mark:\s*var\(--pos\)/)
    expect(rule('.gateway-badge-idle')).toMatch(/--gateway-mark:\s*var\(--muted\)/)
    expect(rule('.gateway-badge-warn')).toMatch(/--gateway-mark:\s*var\(--neg\)/)
    expect(rule('.gateway-badge-warn')).toMatch(/--gateway-ink:\s*var\(--neg-text\)/)
  })

  it('carries no raw length, glow included', () => {
    const dot = rule('.gateway-dot')
    expect(dot, '.gateway-dot must exist').toBeDefined()
    // `box-shadow` is not a property the adoption ratchet guards, so the glow's blur is the one
    // length in this component that could have been hand-picked without anything failing.
    expect(dot).not.toMatch(/\d+(\.\d+)?(px|rem)/)
    expect(dot).toMatch(/box-shadow:[^;]*currentColor/)
  })

  it('is not announced as a live region', () => {
    // The detail quotes a clock time, so a status role would announce a re-read as if it were a
    // change of state. The Portfolio view announces the states that matter.
    expect(RAIL).not.toMatch(/role="status"/)
    expect(RAIL).not.toMatch(/aria-live/)
  })
})

describe('the display-currency control after the move', () => {
  it('left the Portfolio dashboard', () => {
    expect(DASHBOARD).not.toMatch(/CurrencySelector/)
  })

  it('renders in the sidebar’s footer', () => {
    expect(APP).toMatch(/app-sidebar-foot[\s\S]{0,200}<CurrencySelector/)
  })

  it('still generates its own id through Field, and takes none (DDR-0035)', () => {
    // Analytics tabs stay mounted, so a fixed id would name only the first control in the
    // document. `Field` owns the identity; this pins that the selector did not start supplying
    // one when it moved.
    expect(SELECTOR).toMatch(/<Field label=\{label\}/)
    expect(SELECTOR).not.toMatch(/\bid\??:/)
    expect(SELECTOR).toMatch(/\{\(id\) => \(/)
  })

  it('is never disabled from out here', () => {
    // It has to stay usable while the view it converts is not mounted (DDR-0027), which is why
    // the dashboard's in-flight guard became a request-sequence check instead.
    expect(SELECTOR).not.toMatch(/disabled/)
    expect(DASHBOARD).toMatch(/currentRead/)
  })

  it('stacks by placement rather than by a new Field variant', () => {
    const currency = rule('.app-currency')
    expect(currency, '.app-currency must exist').toBeDefined()
    expect(currency).toMatch(/flex-direction:\s*column/)
    // Placement only: it must not re-declare what the shared `.control` rules own (DDR-0035).
    expect(currency).not.toMatch(/padding|border-radius|outline|color:/)
  })
})

describe('what the rail must not have displaced', () => {
  it('leaves the tablist as the part of the column that scrolls', () => {
    // The rail states what the app is and the footer holds a control; neither may scroll out of
    // sight to make room for a sixth view.
    expect(rule('.app-sidebar')).toMatch(/overflow:\s*hidden/)
    const tabs = rule('.app-sidebar-tabs')
    expect(tabs).toMatch(/flex:\s*1/)
    expect(tabs).toMatch(/min-height:\s*0/)
    expect(tabs).toMatch(/overflow-y:\s*auto/)
  })

  it('keeps the tablist itself untouched', () => {
    expect(APP).toMatch(/role="tablist"/)
    expect(APP).toMatch(/aria-orientation="vertical"/)
    expect(APP).toMatch(/aria-controls=\{isActive \? panelDomId\(t\.id\) : undefined\}/)
  })

  it('declares no focus rule of its own', () => {
    // The ring comes from the zero-specificity `:where()` base rule; `designTokens.test.ts`
    // fails on a second `outline` value anywhere, and this pins the new selectors specifically.
    expect(RAIL).not.toMatch(/outline/)
    for (const selector of [
      '.app-sidebar-head',
      '.app-sidebar-head-row',
      '.app-sidebar-foot',
      '.gateway-badge',
      '.app-brand',
    ]) {
      expect(rule(selector) ?? '').not.toMatch(/outline/)
    }
  })
})
