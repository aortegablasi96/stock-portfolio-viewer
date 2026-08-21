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

  it('renders on the chip’s fill, so its three tones are measured there (DDR-0069)', () => {
    // Story #219 gave the badge a background of its own, which moved every tone off the sidebar's
    // ground. `lib/contrast.ts`'s dot entries were re-pointed to match; this is the half of that
    // pairing the contrast guard cannot see, since it reads tokens and not which rule uses them.
    expect(rule('.gateway-badge')).toMatch(/background:\s*var\(--surface-raised\)/)
    /* Three rules stand on that surface now, and each one came here and said so, which is what
       this count is for. Not a style rule: every ink measured against `--surface-raised` is an
       ink one of these three renders, so a rule adopting it brings inks nobody has measured
       there. Story #220 floated the chart hover card on it (DDR-0070) and added four pairings to
       `lib/contrast.ts` plus nine for the series ink ramp — the card's own `--text` and `--muted`
       had only ever been measured on `--card`. Story #234 boxed the display currency at the far
       end of this column and paid the same toll: two pairings, the field's label and its value,
       both re-pointed off `--card`. A fourth adopter owes it too. */
    expect(CSS.match(/var\(--surface-raised\)/g)).toHaveLength(3)
  })

  it('is not announced as a live region', () => {
    // The detail quotes a clock time, so a status role would announce a re-read as if it were a
    // change of state. The Portfolio view announces the states that matter.
    expect(RAIL).not.toMatch(/role="status"/)
    expect(RAIL).not.toMatch(/aria-live/)
  })
})

/**
 * The chip and the rule above it (Story #219, DDR-0069).
 *
 * The visual result is a Playwright matter — `e2e/sidebar-collapse.spec.ts` measures the square on
 * the rail, which needs a layout engine. What is checkable here is the part that is a decision:
 * that the box is drawn from tokens, that the delimiter spans the column rather than sitting
 * inside its padding, and that the head did not end up with two rules doing the same job.
 */
describe('the badge is a boxed chip, ruled off from the brand', () => {
  it('draws its box entirely from tokens — surface, edge and corner', () => {
    const badge = rule('.gateway-badge')
    expect(badge, '.gateway-badge must exist').toBeDefined()
    expect(badge).toMatch(/background:\s*var\(--surface-raised\)/)
    expect(badge).toMatch(/border:\s*1px solid var\(--border\)/)
    expect(badge).toMatch(/border-radius:\s*var\(--radius-(sm|md|lg)\)/)
    expect(badge).toMatch(/padding:\s*var\(--space-\d\) var\(--space-\d\)/)
    // No colour of its own: the tones are the three `--gateway-*` rules, and the surface is the
    // one token above. A literal here is a pairing `lib/contrast.ts` does not cover (DDR-0046).
    expect(badge).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('rules the brand off from the badge, and lets the rule reach both edges', () => {
    // A 1px line inside a padded box stops short of the sidebar's edges, which is the one thing a
    // delimiter must not do. So the head carries no padding of its own and its two children do.
    const head = rule('.app-sidebar-head')
    const row = rule('.app-sidebar-head-row')
    const status = rule('.app-sidebar-status')
    expect(head).toMatch(/border-bottom:\s*1px solid var\(--border\)/)
    expect(head).not.toMatch(/padding/)
    expect(row).toMatch(/border-bottom:\s*1px solid var\(--border\)/)
    expect(row).toMatch(/padding:\s*var\(--space-\d\) var\(--space-\d\)/)
    expect(status).toMatch(/padding:\s*var\(--space-\d\)/)
  })

  it('leaves the head with one rule per boundary, not two competing ones', () => {
    // The head closes off the tablist; the row closes off the badge. The badge's own section adds
    // nothing — a third rule there would double the line under the brand.
    expect(rule('.app-sidebar-status')).not.toMatch(/border/)
  })

  it('squares the chip on the rail rather than dropping or stretching it', () => {
    const collapsed = rule('.app-collapsed .gateway-badge')
    expect(collapsed, '.app-collapsed .gateway-badge must exist').toBeDefined()
    expect(collapsed).not.toMatch(/display:\s*none/)
    // One box, both axes from the same step — a chip that is 32px across and 30px tall is a
    // rounded rectangle beside a 32px brand tile, which is what the story rules out.
    const [width, height] = [/width:\s*var\((--space-\d)\)/, /height:\s*var\((--space-\d)\)/].map(
      (pattern) => pattern.exec(collapsed ?? '')?.[1],
    )
    expect(width, 'the collapsed chip needs a width from the scale').toBeDefined()
    expect(height).toBe(width)
    expect(collapsed).toMatch(/margin-inline:\s*auto/)
  })

  it('keeps the collapsed wording clipped by the one rule, never removed', () => {
    // The chip is the only thing in the rail whose text sits inside a box, so it is the one most
    // easily "tidied" with a `display: none` — which would take the badge's accessible name with
    // it. It stays in the shared clip list (DDR-0057).
    const clipped = /\n([^{}]*\.app-collapsed \.gateway-badge-text[^{}]*)\{([^}]*)\}/.exec(CSS)
    expect(clipped, 'the badge’s wording must stay in the shared clip rule').not.toBeNull()
    // Shared, not its own: the same rule that clips the brand's name and the nav rows' labels.
    expect(clipped?.[1]).toMatch(/\.app-brand-name/)
    expect(clipped?.[2]).toMatch(/clip:\s*rect\(0, 0, 0, 0\)/)
    expect(clipped?.[2]).not.toMatch(/display:\s*none/)
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
    // Still not a variant: the two properties that would make it one are the ones `Field` and
    // `Select` own, and neither is here. `color` in particular — the field's ink is the shared
    // rules' in both states, which is what keeps the `:disabled` and hover treatments honest.
    expect(currency).not.toMatch(/outline|color:/)
  })

  /**
   * The box the field became (Story #234, amending DDR-0035).
   *
   * DDR-0035's rule was that `.app-currency` is placement and nothing else, and this guard used
   * to assert exactly that by forbidding `padding` and `border-radius` here. The amendment is
   * narrow and is asserted rather than removed: the *box* moves out to the field, and the
   * control gives up its resting border so the app does not draw two nested rounded rectangles
   * in a 220px column. Everything else the shared rules own stays theirs.
   */
  it('is the boxed chip, and takes the control’s resting border with it (DDR-0035, DDR-0069)', () => {
    const currency = rule('.app-currency')
    expect(currency).toMatch(/background:\s*var\(--surface-raised\)/)
    expect(currency).toMatch(/border:\s*1px solid var\(--border\)/)
    // The proposal's own 8px corner, from the scale rather than as a length (DDR-0031).
    expect(currency).toMatch(/border-radius:\s*var\(--radius-md\)/)

    const control = rule('.app-currency .control')
    expect(control, '.app-currency .control must exist').toBeDefined()
    // `transparent`, never `none`: the box metrics stay put, so `.control:hover:not(:disabled)`
    // — which is (0,3,0) against this rule's (0,2,0) — still brings the accent edge back.
    expect(control).toMatch(/border-color:\s*transparent/)
    expect(control).not.toMatch(/border:\s*none/)
    // The one inset that would double up, and nothing else about the control is re-declared.
    // The lookbehind is load-bearing: `border-color` above ends in `color:`, and a bare
    // /color:/ here would assert the opposite of what this line means.
    expect(control).toMatch(/padding-inline:\s*0/)
    expect(control).not.toMatch(/(?<!-)color:|font-size|background:/)
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
