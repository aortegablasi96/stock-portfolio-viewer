/**
 * The five main-tab icons (Story #168).
 *
 * Dependency-free inline SVG in the convention `TitleBar.tsx` established: no icon library, no
 * new runtime dependency (ADR-0008). Each glyph is a **second channel beside the tab's text**,
 * never a replacement for it and never its accessible name — hence `aria-hidden="true"` on every
 * one, which is also what keeps `tablist.getByRole('tab')` reading exactly the five labels.
 *
 * They live here rather than at the bottom of `App.tsx` because that file is the tab shell's ARIA
 * pattern (DDR-0029) — roving `tabindex`, `aria-controls`-only-when-selected, automatic
 * activation — and seventy lines of path data between a reader and those invariants is the kind
 * of cosmetic change that makes an invariant-heavy component harder to review.
 *
 * Each glyph names what its view *draws*, not an abstract synonym of its label: a pie for the
 * Allocation donuts, a rising curve for the Performance line, a banknote for dividend income,
 * exchange arrows for trades. The Portfolio briefcase is the one conventional glyph — the live
 * dashboard draws several things and none of them is the tab.
 */

/**
 * The shared frame every icon renders through.
 *
 * One place carries `aria-hidden`, `focusable="false"` and `currentColor`, so an icon added later
 * cannot ship without them by forgetting an attribute. `fill="none"` + a stroke is what makes
 * `currentColor` sufficient: the glyph is drawn entirely in the tab's own ink, so it inherits the
 * muted → text → accent progression the tab already goes through and introduces no colour of its
 * own for `lib/contrast.ts` to cover (DDR-0046).
 *
 * The 16×16 viewBox is geometry, not a size — `.app-tab-icon` in `app.css` decides how big it
 * renders, from the type scale.
 */
function Glyph({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      className="app-tab-icon"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

/** Portfolio — a briefcase: the holdings and balances the account actually carries. */
export function PortfolioIcon(): React.JSX.Element {
  return (
    <Glyph>
      <rect x="2.25" y="5.25" width="11.5" height="8.5" rx="1.5" />
      <path d="M6 5.25V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.25" />
    </Glyph>
  )
}

/** Performance — a rising curve with its arrow head, the view's own cumulative TWR line. */
export function PerformanceIcon(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M2.25 11.5 6 7.5l2.75 2.5 4.75-5.5" />
      <path d="M10.25 4.5h3.25v3.25" />
    </Glyph>
  )
}

/** Allocation — a pie with one slice cut, the shape the breakdown donuts draw. */
export function AllocationIcon(): React.JSX.Element {
  return (
    <Glyph>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 2.25V8h5.75" />
    </Glyph>
  )
}

/** Dividends — a banknote: income received, which is what the view totals. */
export function DividendsIcon(): React.JSX.Element {
  return (
    <Glyph>
      <rect x="1.75" y="4.5" width="12.5" height="7" rx="1.5" />
      <circle cx="8" cy="8" r="1.75" />
    </Glyph>
  )
}

/** Trades — arrows crossing in both directions: buys and sells, and the gains they realize. */
export function TradesIcon(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M2.5 5.5h11M10.75 2.75 13.5 5.5l-2.75 2.75" />
      <path d="M13.5 10.5h-11M5.25 7.75 2.5 10.5l2.75 2.75" />
    </Glyph>
  )
}

/**
 * Assistant — a speech bubble: the view is a conversation about the portfolio (Story #283).
 *
 * The glyph names what the view *draws*, like the five before it. A sparkle or a star would name
 * the technology rather than the surface, and this app's assistant is deliberately not presented
 * as magic — it phrases figures other views computed.
 */
export function AssistantIcon(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M13.75 9.25a2 2 0 0 1-2 2H6.5L3 13.75V4.75a2 2 0 0 1 2-2h6.75a2 2 0 0 1 2 2Z" />
    </Glyph>
  )
}
