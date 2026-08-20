import { useEffect, useState } from 'react'
import { Button } from './ui/Button'
import { sidebarToggleLabel } from '../lib/sidebarCollapse'
import {
  describeGateway,
  GATEWAY_READING_TTL_MS,
  isStale,
  type GatewayReading,
} from '../lib/gatewayStatus'

/**
 * The sidebar's context rail (Story #183): the two things that are true of the *app* rather than
 * of whichever view is open — what it is, and whether the gateway behind it is answering.
 *
 * They live here rather than in `App.tsx` for the reason `TabIcons.tsx` does: that file is the
 * tab shell's ARIA pattern (DDR-0029, DDR-0055), and a reader checking the roving `tabindex` or
 * the `aria-controls`-only-when-selected rule should not have to scroll past a brand mark and a
 * status badge to find them.
 *
 * Neither part reaches IPC. The badge renders a reading the Portfolio view already took — see
 * `lib/gatewayStatus.ts` for why that is the source of truth and why nothing polls.
 *
 * Story #184 added the third thing that is true of the app rather than of a view: how wide this
 * column is. The toggle below is the rail's only control, and it reaches IPC no more than the
 * badge does — the shell owns the state and the write, and hands down a callback (DDR-0057).
 * Nothing else here learned about collapse at all: the brand's name, the badge's wording and the
 * nav rows' labels are clipped by one CSS rule, so none of them takes a `collapsed` prop.
 */

/**
 * The brand mark and the app's name.
 *
 * The name is **Stock Portfolio Viewer**. The Figma proposal reads *PortfolioOS · On-Premise*;
 * renaming the product is a product decision, not a redesign story, and Epic #179 rules it out
 * explicitly.
 *
 * The glyph is three ascending columns rather than the rising curve `PerformanceIcon` draws:
 * every tab icon names what its view *draws*, and the mark beside the app's name should not
 * read as one of the five views. It carries no colour of its own — `currentColor` again, so the
 * tile's rule decides the ink and `lib/contrast.ts` has one pairing to cover rather than two —
 * and no width or height attribute, because `.app-brand-glyph` sizes it from the type scale.
 */
export function SidebarBrand(): React.JSX.Element {
  return (
    <div className="app-brand">
      <span className="app-brand-mark">
        <svg
          className="app-brand-glyph"
          viewBox="0 0 16 16"
          aria-hidden="true"
          focusable="false"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M4 11.75V9.25" />
          <path d="M8 11.75V6.5" />
          <path d="M12 11.75V4.25" />
        </svg>
      </span>
      <span className="app-brand-name">Stock Portfolio Viewer</span>
    </div>
  )
}

/**
 * The one control that collapses the column and expands it again (Story #184).
 *
 * A single toggle rather than the prototype's pair of buttons — an invisible full-width strip at
 * the top of the rail and a second, visible one at the bottom. One visible control that is in the
 * same place in both states is what makes the affordance findable; two, one of which is invisible,
 * is how a reader collapses the sidebar by accident and cannot see what to click to undo it.
 *
 * It sits *last* in the column, below the currency selector, and that was measured rather than
 * preferred: 220px minus the 32px brand tile leaves the product's own name barely fitting, and a
 * control beside the brand ellipsised "Stock Portfolio Viewer" to "Stock Portfolio…". The cost is
 * one more stop between the selected tab and its panel — the tablist is a single Tab stop with a
 * roving `tabindex` (DDR-0029), so anything after it lands there — which makes the sidebar's Tab
 * order tab → currency → toggle → panel, as `e2e/tab-navigation.spec.ts` describes.
 *
 * `aria-expanded` states what the button did to the region; the name states what it will do next.
 * The glyph is the same panel in both states with its chevron reversed — the thing being acted on
 * stays recognisable, and only the direction changes.
 */
export function SidebarToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean
  onToggle: () => void
}): React.JSX.Element {
  const label = sidebarToggleLabel(collapsed)
  return (
    <Button
      variant="ghost"
      size="icon"
      className="app-sidebar-toggle"
      aria-expanded={!collapsed}
      aria-controls="app-sidebar"
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      <svg
        className="app-sidebar-toggle-glyph"
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.5" />
        <path d="M6.25 2.75v10.5" />
        <path d={collapsed ? 'M9 6.25 10.75 8 9 9.75' : 'M10.75 6.25 9 8l1.75 1.75'} />
      </svg>
    </Button>
  )
}

/**
 * The gateway status badge: a dot, the subject, and the state in words.
 *
 * The **words are the channel**; the dot seconds them. Three tones cover five outcomes precisely
 * so no pair of outcomes is separated by colour alone (DDR-0021), and the two that a single
 * "offline" would have merged — a gateway that is not running and one that stalled — read
 * "Not running" and "Stalled" (DDR-0022).
 *
 * Deliberately **not** a live region. The detail carries a clock time, so a `role="status"` here
 * would announce "IBKR Gateway Live 14:35" every time the owner returned to the Portfolio tab,
 * which is a re-read rather than a change of state. The Portfolio view already announces the
 * states that matter, with the sentence explaining each and the Retry beside it; this is ambient
 * context, and it is readable on demand like the rest of the sidebar.
 */
export function GatewayBadge({ reading }: { reading: GatewayReading | null }): React.JSX.Element {
  const badge = describeGateway(reading, useFreshnessClock(reading))

  return (
    <div className={`gateway-badge gateway-badge-${badge.tone}`}>
      <span className="gateway-dot" aria-hidden="true" />
      <span className="gateway-badge-text">
        <span className="gateway-badge-label">{badge.label}</span>
        <span className="gateway-badge-detail">{badge.detail}</span>
      </span>
    </div>
  )
}

/**
 * The clock the badge reads, and the one piece of this that needs a component.
 *
 * A reading ages on its own, so the moment it stops being current is a moment nothing else in
 * the app is re-rendering for. One `setTimeout`, armed for exactly that moment and only while a
 * live reading is waiting for it — not an interval, and emphatically not a poll: it asks the
 * gateway nothing and issues no IPC. When it fires, `describeGateway` demotes "Live · 14:32" to
 * "Last seen 14:32" (DDR-0022, DDR-0024).
 */
function useFreshnessClock(reading: GatewayReading | null): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    // A new reading is a new "now": the label quotes a time, so it has to be re-read even when
    // the timer below has nothing to do.
    setNow(Date.now())
    if (reading === null || reading.status !== 'live' || isStale(reading, Date.now())) return

    const due = reading.at + GATEWAY_READING_TTL_MS - Date.now()
    const timer = setTimeout(() => setNow(Date.now()), due)
    return () => clearTimeout(timer)
  }, [reading])

  return now
}
