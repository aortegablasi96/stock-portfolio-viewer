import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GRID_CONTENT_BREAKPOINT_PX, SIDEBAR_PX } from './chartGeometry'

/**
 * The Portfolio view's composition (Story #189, re-stated by Story #266).
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
 * prototype, and the imported store's row could be folded inside the `ok` branch — which reads as
 * tidying and costs the owner the import button on exactly the day the gateway is down.
 *
 * Story #266 turns four of them around rather than deleting them (DDR-0089). The rail is gone, so
 * "the rail is outside the branches" becomes "the row is", "the bars are one fact drawn twice"
 * becomes "drawn once", and the geometry guard measures a different pair. A guard that fails
 * because the layout changed is doing its job; the answer is to re-state the promise, not to drop
 * it — the decisions underneath (the import survives a dead gateway, one scale, one confirm) are
 * the same ones.
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
    const order = ['<PageHeader', '<BalancesSummary', '<HoldingsTable', 'dashboard-sources']
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

  it('gives the holdings table the page, with no column beside it', () => {
    // Story #266. The `1fr / 260px` pair and the rail's two class names go together — a grid
    // left behind with one child is the arrangement this story removed, drawn invisibly.
    expect(DASHBOARD).not.toMatch(/col-main|col-side|dashboard-columns/)
    expect(CSS).not.toMatch(/\.col-main\s*\{|\.col-side\s*\{|\.dashboard-columns\s*\{/)
  })
})

describe('the imported store renders beside the live states, not inside them', () => {
  it('renders both store cards outside every gateway branch, in one row', () => {
    // Imported history is local and has never needed the gateway. A card that only rendered
    // under `state.phase === 'ok'` would hide the import button precisely when the dashboard is
    // showing not_connected — the moment importing is the useful thing to do. Story #189 kept
    // that by putting the card in a rail beside the branches; Story #266 keeps it by making the
    // row a sibling of them, which is why the guard is that the row's own span holds no branch.
    const rowStart = DASHBOARD.indexOf('<div className="dashboard-sources">')
    const rowEnd = DASHBOARD.indexOf('</div>', rowStart)
    const row = DASHBOARD.slice(rowStart, rowEnd)

    expect(rowStart).toBeGreaterThan(-1)
    expect(row).toMatch(/<StoredStatementsCard/)
    expect(row).toMatch(/<DataSourcesCard/)
    expect(row).not.toMatch(/state\.phase/)
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
    // Story #189 overrode four things because a 260px rail is narrower than the control's 26rem
    // cap; a 400px card is not, so three of them are gone and the one that is left is the one
    // width never answered — the card's copy reads from the left, its home reads from the right.
    // A placement override is all it may ever be: the tone, the buttons and the phases are the
    // primitive's (ADR-0008: `className` is for placement, not colour).
    const scoped = rule('.flex-import-actions .confirm-action')

    expect(scoped).toMatch(/align-items:\s*flex-start/)
    expect(scoped).not.toMatch(/max-width|color|background|border-color/)
    expect(CSS).not.toMatch(/\.flex-import-actions \.confirm-buttons/)
  })

  it('lets the two controls stand beside each other, and wrap rather than squeeze', () => {
    // The stack was a consequence of the rail ("in a 260px rail there is no *beside*"), not a
    // decision about the controls — so it goes with the rail. `wrap` is what keeps the armed
    // confirm readable: it takes the next line instead of a sliver beside the Import button.
    const actions = rule('.flex-import-actions')

    expect(actions).not.toMatch(/flex-direction:\s*column|align-items:\s*stretch/)
    expect(actions).toMatch(/flex-wrap:\s*wrap/)
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

describe('the weight bar is one fact, now drawn once', () => {
  it('scales the drawing through the shared module, never a hard-coded divisor', () => {
    // The prototype used `weight / 30` in the rail and `weight / 28` in the table — two magic
    // numbers that disagreed with each other and with the portfolio. One drawing is left and the
    // module still owns its scale, because *where* the scale comes from is the load-bearing part.
    expect(HOLDINGS).toMatch(/from '\.\.\/lib\/weightBars'/)
    expect(HOLDINGS).not.toMatch(/weight\s*\/\s*\d/)
  })

  it('derives the table’s scale from the allocation, not from the rows on screen', () => {
    // The table sorts, and a filtered or re-sorted table must not silently rescale its bars.
    expect(HOLDINGS).toMatch(/weightBarScale\(allocation\.map/)
  })

  it('keeps the one track and fill, and leaves no second drawing behind', () => {
    expect(rule('.weight-track')).toBeDefined()
    expect(rule('.weight-fill')).toBeDefined()
    // The pair `.weight-*` superseded, and the list that was the second drawing — each gone
    // rather than left in the stylesheet for a later story to find and re-use (Story #266).
    expect(CSS).not.toMatch(/\.allocation-track\s*\{/)
    expect(CSS).not.toMatch(/\.allocation-bar\s*\{/)
    expect(CSS).not.toMatch(/\.allocation-list\s*\{|\.allocation-row\s*\{|\.allocation-head\s*\{/)
    expect(existsSync(new URL('../components/AllocationPanel.tsx', import.meta.url))).toBe(false)
  })

  it('keeps the weight a written figure, and the bar the silent channel', () => {
    // The rail's `meter` announced the weight; the table's cell announces it as a figure under a
    // Weight column header, which is what the story means by "no allocation figure is lost". The
    // bar stays `aria-hidden`: a meter per row would double the table's length to hear for a
    // number already spelled out beside it (the same rule the tab icons follow, DDR-0048).
    expect(HOLDINGS).toMatch(/header: 'Weight'/)
    expect(HOLDINGS).toMatch(/formatPercent\(weight\)/)
    expect(HOLDINGS).toMatch(/weight-track-micro" aria-hidden="true"/)
    expect(HOLDINGS).not.toMatch(/role="meter"/)
  })
})

describe('the sources row’s geometry', () => {
  it('is one width token, quoted by the grid that places it', () => {
    expect(CSS).toMatch(/--sources-width:\s*416px/)
    expect(rule('.dashboard-sources')).toMatch(/grid-template-columns:.*var\(--sources-width\)/)
    // The rail's token goes with the rail: a measure with no consumer is one a later story
    // reaches for and mis-reads.
    expect(CSS).not.toMatch(/--rail-width/)
  })

  it('takes each card’s height from the row, not from its own contents', () => {
    // Story #271. The two contents can never agree — a table as tall as the number of imported
    // statements beside a fixed set of import controls — so whichever was taller set the row and
    // the shorter one left a ragged gap against the page background. `align-items: start` is
    // right where it is doing real work (a stacked card is sized by its content, and
    // `.performance-charts` places four cards whose equal height comes from having identical
    // content, DDR-0051 and DDR-0072); on this row the equal height has to come from the row.
    expect(rule('.dashboard-sources')).toMatch(/align-items:\s*stretch/)
    expect(rule('.dashboard-sources')).not.toMatch(/align-items:\s*start/)

    // The other row keeps its own reason, and is not swept along with this one.
    expect(rule('.performance-charts')).toMatch(/align-items:\s*start/)
  })

  it('leaves the stacked layout sized by each card, as Story #266 left it', () => {
    // One column puts each card in its own implicit row, and an implicit row is auto-sized — so
    // stretching to it is stretching to the card's own content, and a stacked card is unchanged.
    // The guard is that the breakpoint restates the columns and nothing else: an `align-items`
    // in here would mean the row above was being corrected twice.
    const collapsed = CSS.match(
      /@media \(max-width: \d+px\) \{\s*\.dashboard-sources \{([^}]*)\}/,
    )

    expect(collapsed?.[1]).not.toMatch(/align-items/)
  })

  it('stacks rather than squeezing, statements first', () => {
    // The criterion is which way the row breaks, not where: the cards go one above the other and
    // each takes the full column, rather than the table being squeezed to hold the card beside it.
    const collapsed = CSS.match(
      /@media \(max-width: (\d+)px\) \{\s*\.dashboard-sources \{([^}]*)\}/,
    )

    expect(collapsed).not.toBeNull()
    expect(collapsed?.[2]).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/)
  })

  it('breaks at a width the row genuinely stops fitting at', () => {
    // Derived rather than eyeballed, and derived from the numbers already in the stylesheet: the
    // sidebar, both content paddings, the card and the gap, over a statements column no narrower
    // than what its four columns need before the table scrolls inside its own card.
    const breakpoint = Number(
      CSS.match(/@media \(max-width: (\d+)px\) \{\s*\.dashboard-sources/)?.[1],
    )
    const CONTENT_PAD_PX = 32
    const SOURCES_PX = 416
    const GAP_PX = 24
    const STATEMENTS_MIN_PX = 480

    expect(breakpoint).toBe(
      SIDEBAR_PX + CONTENT_PAD_PX * 2 + SOURCES_PX + GAP_PX + STATEMENTS_MIN_PX,
    )
    // And the row fits inside the chart grid's content column, so it is never the reason a
    // window that fits the 2×2 grid cannot fit this page.
    expect(STATEMENTS_MIN_PX + SOURCES_PX + GAP_PX).toBeLessThanOrEqual(
      GRID_CONTENT_BREAKPOINT_PX - 200,
    )
  })
})
