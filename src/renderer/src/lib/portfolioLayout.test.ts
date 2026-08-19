import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GRID_CONTENT_BREAKPOINT_PX, SIDEBAR_PX } from './chartGeometry'

/**
 * The Portfolio view's composition (Story #189).
 *
 * No module under test: the subject is `PortfolioDashboard.tsx`, `DataSources.tsx` and the rules
 * that place them — the same shape as `sidebarRail.test.ts` and `analyticsShell.test.ts`, and a
 * text guard for the same reason. Vitest runs in Node with no jsdom, so no component can be
 * rendered, and the only place that could observe the real DOM is `e2e/`, which CI does not run.
 * The arithmetic that *is* renderable logic — how a weight becomes a bar — is tested properly in
 * `weightBars.test.ts`; what this file protects is the half of the story that is a promise.
 *
 * Every promise below is one a later story could break while every other test still passed: the
 * destructive reset could quietly become a `confirm()`, the `dataVersion` bump could be dropped
 * while moving a button, the snapshot section could be deleted for looking absent from the
 * prototype, and the rail could be folded inside the `ok` branch — which reads as tidying and
 * costs the owner the import button on exactly the day the gateway is down.
 */

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')

/**
 * The source with its comments removed.
 *
 * Not optional, and now recorded five times (`tokenAdoption.ts`, `mapAccessibility.test.ts`,
 * `tabIcons.test.ts`, `sidebarRail.test.ts`, `analyticsShell.test.ts`): every file below explains
 * itself at length and names `window.confirm`, `SnapshotHistory` and `flexDataVersion` in its own
 * prose, so a scan over the raw text would pass off the commentary alone after the real code was
 * deleted. Both files here open with a paragraph doing exactly that.
 */
const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const DASHBOARD = strip(read('../components/PortfolioDashboard.tsx'))
const SOURCES = strip(read('../components/DataSources.tsx'))
const HOLDINGS = strip(read('../components/HoldingsTable.tsx'))
const ALLOCATION = strip(read('../components/AllocationPanel.tsx'))
const APP = strip(read('../App.tsx'))
const CSS = strip(read('../app.css'))

/** One rule's body, by selector. */
const rule = (selector: string): string | undefined =>
  CSS.match(new RegExp(`\\n${selector.replace(/[.*+?^$()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1]

describe('the page is one block, in the redesign’s order', () => {
  it('renders the header, the balances, the pair and the tables from one component', () => {
    // The Flex panel used to be a second `.dashboard` mounted beside this one, which is why the
    // Portfolio tab was the only panel in the app with two page-length columns stacked in it.
    expect(APP).not.toMatch(/FlexImport/)
    expect(APP.match(/<PortfolioDashboard/g)).toHaveLength(1)
  })

  it('places the four sections in the order the story states', () => {
    const order = ['<PageHeader', '<BalancesSummary', 'dashboard-columns', '<StoredStatementsCard']
    const positions = order.map((token) => DASHBOARD.indexOf(token))

    expect(positions.every((at) => at >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('keeps SnapshotHistory, last on the page', () => {
    // The prototype simply does not draw it. That is an omission in a sketch — removing a
    // capability is not this Epic's business — so the guard is that it is still rendered, and
    // that its placement is a decision rather than an accident: below the statements it pairs
    // with, which is what the PR had to state.
    expect(DASHBOARD).toMatch(/<SnapshotHistory/)
    expect(DASHBOARD.indexOf('<SnapshotHistory')).toBeGreaterThan(
      DASHBOARD.indexOf('<StoredStatementsCard'),
    )
  })
})

describe('the rail is beside the live states, not inside them', () => {
  it('renders the data-sources card outside every gateway branch', () => {
    // Imported history is local and has never needed the gateway. A card that only rendered
    // under `state.phase === 'ok'` would hide the import button precisely when the dashboard is
    // showing not_connected — the moment importing is the useful thing to do.
    const railStart = DASHBOARD.indexOf('<aside className="col-side">')
    const railEnd = DASHBOARD.indexOf('</aside>')
    const rail = DASHBOARD.slice(railStart, railEnd)

    expect(railStart).toBeGreaterThan(-1)
    expect(rail).toMatch(/<DataSourcesCard/)
    // The allocation list is the one thing in the rail that is a reading of the live positions,
    // so it is the one thing gated on them.
    expect(rail).toMatch(/state\.phase === 'ok'[\s\S]*<AllocationPanel/)
  })

  it('keeps the five live states as states, none of them an error panel', () => {
    // DDR-0002 and DDR-0022: `not_connected` and `not_responding` are results, not failures, and
    // they are not interchangeable — the second names a fix the first would send the owner past.
    for (const phase of ['loading', 'not_connected', 'not_responding', 'error', 'ok']) {
      expect(DASHBOARD).toContain(`state.phase === '${phase}'`)
    }
    expect(DASHBOARD).toMatch(/heading="Interactive Brokers isn’t responding"/)
    expect(DASHBOARD).toMatch(/heading="Not connected to Interactive Brokers"/)
  })

  it('re-reads the live overview on every visit, and is not memoised out of doing so', () => {
    // The Portfolio tab is deliberately excluded from stay-mounted (DDR-0027): it shows live data
    // that changes with no event to signal it. Restructuring the view around it must not
    // "optimise" the read away, and the load effect must still key on the display currency.
    expect(DASHBOARD).toMatch(/void load\(displayCurrency, keepPrevious\)/)
    expect(DASHBOARD).toMatch(/\[displayCurrency, load, loadHistory\]/)
  })
})

describe('the destructive reset keeps its settled interaction', () => {
  it('reaches Clear statements through ConfirmAction, not through a dialog', () => {
    // DDR-0012 and ADR-0006: expand in place, no modal, no `window.confirm`. The prototype draws
    // a bare red button, which is the thing that decision exists to prevent.
    expect(SOURCES).toMatch(/<ConfirmAction[\s\S]*label="Clear statements"/)
    expect(SOURCES).not.toMatch(/window\.confirm|<dialog|role="dialog"/)
    expect(DASHBOARD).not.toMatch(/window\.confirm|<dialog|role="dialog"/)
  })

  it('takes its loss tone from the text token, never the fill', () => {
    // DDR-0046, and picking the wrong one is silent: `--neg` is a fill and `--neg-text` is text.
    // The control is `.btn-danger`, whose resting rule must colour rather than paint.
    const danger = rule('.btn-danger')

    expect(danger).toMatch(/color:\s*var\(--neg-text\)/)
    expect(danger).not.toMatch(/background/)
  })

  it('leaves the shared primitive’s behaviour alone, overriding only its alignment', () => {
    // The rail's copy is narrower than the control's 26rem cap and cannot be right-aligned, but a
    // placement override is all it may be — the tone, the buttons and the phases are the
    // primitive's (ADR-0008: `className` is for placement, not colour).
    const scoped = rule('.flex-import-actions .confirm-action')

    expect(scoped).toMatch(/align-items:\s*stretch/)
    expect(scoped).not.toMatch(/color|background|border-color/)
  })
})

describe('both Flex write paths still bump the data version', () => {
  it('bumps on import and on clear', () => {
    // What stops a mounted analytics view from going stale behind a fresh import (DDR-0027).
    // Both call sites, not one: a clear that skipped the bump would leave four views rendering
    // history that no longer exists.
    expect(SOURCES.match(/flexDataVersion\.bump\(\)/g)).toHaveLength(2)
  })

  it('keeps the bump in the hook, where splitting the panel cannot strand it', () => {
    // The controls, the receipt and the store list now render in three different cells of the
    // page. A bump living in whichever fragment kept the button would be one refactor from being
    // left behind by the button.
    const hook = SOURCES.slice(
      SOURCES.indexOf('export function useFlexSources'),
      SOURCES.indexOf('export function DataSourcesCard'),
    )

    expect(hook.match(/flexDataVersion\.bump\(\)/g)).toHaveLength(2)
  })

  it('reads the store back after every write, rather than patching it from a summary', () => {
    expect(SOURCES.match(/await loadStore\(\)/g)).toHaveLength(2)
  })
})

describe('coverage stays a service fact', () => {
  it('reads `coverage` rather than deriving a span from the rows on screen', () => {
    // DDR-0026: statements overlap and arrive out of order, so the span is a min/max across all
    // of them, computed in the service. A `Math.min(...statements.map(...))` here would be right
    // for a store of one and wrong for a store of two.
    expect(SOURCES).toMatch(/store\.coverage\.fromDate/)
    expect(SOURCES).toMatch(/store\.coverage\.toDate/)
    expect(SOURCES).not.toMatch(/Math\.(min|max)\([\s\S]{0,80}(fromDate|toDate)/)
  })

  it('renders an empty store as an empty list, not as a result variant', () => {
    expect(SOURCES).toMatch(/store\.statements\.length === 0/)
  })

  it('shows the five columns the story names', () => {
    // Account and file are one cell (the filename is the account's secondary line), then the
    // period, the base currency and the import time.
    for (const header of ["header: 'Account'", "header: 'Period covered'", "header: 'Base'", "header: 'Imported'"]) {
      expect(SOURCES).toContain(header)
    }
    expect(SOURCES).toMatch(/s\.sourceFilename/)
  })
})

describe('the weight bars are one fact drawn twice', () => {
  it('scales both drawings through the shared module, never a hard-coded divisor', () => {
    // The prototype used `weight / 30` in the rail and `weight / 28` in the table — two magic
    // numbers that disagree with each other and with the portfolio.
    expect(ALLOCATION).toMatch(/from '\.\.\/lib\/weightBars'/)
    expect(HOLDINGS).toMatch(/from '\.\.\/lib\/weightBars'/)
    expect(ALLOCATION).not.toMatch(/weight\s*\/\s*\d/)
    expect(HOLDINGS).not.toMatch(/weight\s*\/\s*\d/)
  })

  it('derives the table’s scale from the allocation, not from the rows on screen', () => {
    // The table sorts, and a filtered or re-sorted table must not silently rescale its bars.
    expect(HOLDINGS).toMatch(/weightBarScale\(allocation\.map/)
  })

  it('draws one track and one fill for both, rather than a class family each', () => {
    expect(rule('.weight-track')).toBeDefined()
    expect(rule('.weight-fill')).toBeDefined()
    // The superseded pair, gone rather than left beside their replacements.
    expect(CSS).not.toMatch(/\.allocation-track\s*\{/)
    expect(CSS).not.toMatch(/\.allocation-bar\s*\{/)
  })

  it('reports the weight to a screen reader, and hides the drawing of it', () => {
    // The `meter` carries the fact; the in-table bar is a second visual channel on a percentage
    // that is already spelled out beside it, so announcing it again would double the table's
    // length to hear for no information (the same rule the tab icons follow, DDR-0048).
    expect(ALLOCATION).toMatch(/role="meter"[\s\S]*aria-valuenow=\{Math\.round\(bar\.weight \* 100\)\}/)
    expect(HOLDINGS).toMatch(/weight-track-micro" aria-hidden="true"/)
    expect(HOLDINGS).not.toMatch(/role="meter"/)
  })
})

describe('the rail’s geometry', () => {
  it('is one width token, quoted by the grid that places it', () => {
    expect(CSS).toMatch(/--rail-width:\s*260px/)
    expect(rule('.dashboard-columns')).toMatch(/grid-template-columns:.*var\(--rail-width\)/)
  })

  it('collapses below the table rather than squeezing it', () => {
    // The criterion is which way the pair breaks, not where: the rail goes *under* the table,
    // and the table keeps the full column.
    const collapsed = CSS.match(
      /@media \(max-width: (\d+)px\) \{\s*\.dashboard-columns \{([^}]*)\}/,
    )

    expect(collapsed).not.toBeNull()
    expect(collapsed?.[2]).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/)
  })

  it('breaks at a width the pair genuinely stops fitting at', () => {
    // Derived rather than eyeballed, and derived from the numbers already in the stylesheet: the
    // sidebar, both content paddings, the rail and the gap, over a table column no narrower than
    // the one the chart grid already treats as a full-width content column.
    const breakpoint = Number(
      CSS.match(/@media \(max-width: (\d+)px\) \{\s*\.dashboard-columns/)?.[1],
    )
    const CONTENT_PAD_PX = 32
    const RAIL_PX = 260
    const GAP_PX = 24
    const TABLE_MIN_PX = 560

    expect(breakpoint).toBe(SIDEBAR_PX + CONTENT_PAD_PX * 2 + RAIL_PX + GAP_PX + TABLE_MIN_PX)
    // And the table's minimum is under the chart grid's content column, so the rail is never the
    // reason a window that fits the 2×2 grid cannot fit the pair.
    expect(TABLE_MIN_PX + RAIL_PX + GAP_PX).toBeLessThanOrEqual(GRID_CONTENT_BREAKPOINT_PX - 200)
  })
})
