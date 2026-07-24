# 0013. Performance view: cumulative TWR curve, chart tabs, and interactive hover

- **Status:** Accepted
- **Date:** 2026-07-24

## Context

M3 (Epic #4) is still open for view refinement. Story #45 asks the Performance view to offer
**two** switchable charts and an interactive hover on both:

1. the existing day-by-day **portfolio value** curve ([[0008-daily-portfolio-value-reconstruction]]),
   unchanged in data; and
2. a new **"performance change over time"** curve.

The story deliberately left the second metric loose ("e.g. cumulative/percentage change"), so
its definition was a planning decision. The view already surfaces a headline **Time-weighted
return** stat (`cumulativeTwr`, chain-linked per-period TWR — DDR-0005). Three candidates were
weighed: cumulative % change of portfolio *value* (dense but conflates deposits — a €10k
deposit reads as a spike), cumulative *gain* in EUR (money P&L, still contribution-inflated
unless netted), and a **cumulative time-weighted return** curve. The owner chose the **TWR
curve** so the chart reconciles with the existing headline and answers *performance*, not
*balance* — deposits and withdrawals must not move it.

The data constraint: IBKR reports TWR **per statement period** only (`ChangeInNAV.twr`), not
daily. A daily NAV series to compute true daily TWR denominators does not exist in the export.
The same `PriorPeriodPositions` daily MTM series that DDR-0008 uses for the value curve is the
only dense intra-period signal available.

## Decision

### Metric: a cumulative TWR curve, anchored to each period's reported TWR and chain-linked

`performanceService` gains `buildReturnSeries(periods, dailyMtm)`, returning `ValuePoint[]`
where `value` is a **percent** (cumulative TWR since the start of imported history). It mirrors
the DDR-0008 value-curve philosophy — real interior shape from daily MTM, endpoints anchored to
the authoritative IBKR figure — but anchors to **per-period TWR** instead of `endingValue`, and
composes multiplicatively instead of additively:

1. **Within-period shape.** For each `ChangeInNAV` period, the fraction of the period's return
   "achieved" by interior day `d` is `Σ(dailyMtm up to d) / Σ(dailyMtm over the whole period)`
   — the same base-currency daily MTM (`priorMtmPnl × fxRateToBase`) the value curve uses. When
   a period's net MTM is ~0 (an unstable denominator), the fraction falls back to **linear in
   time**.
2. **Endpoint anchor.** The interior is scaled so the period spans exactly from its opening
   cumulative return to `openingGrowth × (1 + twr/100)`. `fromDate` is 0% for the first period;
   each `toDate` is the chain-linked cumulative TWR at that boundary.
3. **Chain-link across periods.** The running growth factor carries oldest→newest, so the
   **final point equals `chainLinkTwr(periods)` exactly** — i.e. the headline stat. Shared
   period boundaries are not duplicated.

**Contribution-adjusted by construction:** TWR excludes deposits/withdrawals, so the curve
genuinely diverges from the value curve (the value curve climbs with contributions; the TWR
curve shows real drawdowns). On the owner's real exports the value curve rises monotonically to
€63.6k while the TWR curve dips to ≈ −12% and recovers to the +31.64% headline.

**Graceful degradation:** a period with no daily MTM degrades to a straight line to its reported
TWR (two points), exactly as the value curve degrades to its endpoints. Zero periods → empty
series → the shared `needs_import` state is unchanged.

No new IPC channel and no new domain: `returnSeries` is added to the existing
`PerformanceReport` (it rides the `getPerformance` result), reusing `ValuePoint` — the renderer
formats it with the existing `formatSignedPercent`.

### Chart selection: an in-panel segmented control, not a new route

The two charts share one panel. A `role="tablist"` segmented control (`.chart-tabs`) in the
panel header switches them; the panel title updates with the selection. This reuses the tab-pill
visual language of the app-shell nav ([[0006-app-shell-tab-navigation]]) at panel scale rather
than adding a route or a second panel — the "Returns by period" table below is untouched. Each
chart is keyed distinctly so switching tabs resets transient hover state cleanly.

### Interaction: one shared hover on `LineChart`, reused by both charts

Rather than a chart-specific overlay, the hover lives in the shared `LineChart`
([[0008-daily-portfolio-value-reconstruction]]) so **both** charts (and any future caller) get
it. On pointer move the component maps the cursor to the **nearest** data point in viewBox space
and renders a dashed **crosshair**, a highlighted **dot**, and a small floating **tooltip** with
the point's date and formatted value (currency for the value chart, signed percent for the TWR
chart, via the caller's `formatValue`). It stays dependency-free inline SVG and CSP-safe; the
sparse-series `<title>` markers (DDR-0008) remain as the non-hover affordance. `role="img"` +
`aria-label` stay the non-visual path.

## Consequences

Benefits:

* The Performance view answers both *"what is my portfolio worth over time"* and *"how has it
  performed, net of what I paid in"* — the latter reconciling exactly with the headline TWR.
* Pure reuse of the analytics slice: no new IPC, domain, dependency, or table. The hover, added
  once to `LineChart`, upgrades the value chart too.

Tradeoffs:

* The TWR curve is a **reconstruction between statement boundaries** — exact at each boundary
  (and at the final headline), approximate in the interior, since only per-period TWR is
  authoritative and the intra-period shape is inferred from MTM. Same class of approximation as
  the value curve (DDR-0008), documented here as intentional.
* Nearest-point hit-testing is horizontal (by date); acceptable for a monotonic-in-x time series.

Risks:

* **Non-monotonic MTM** can push a within-period fraction slightly outside `[0, 1]`, so the
  curve may briefly overshoot a boundary before the anchor pulls it back — a faithful "up then
  down" wiggle, bounded in practice. The near-zero-MTM linear-in-time fallback prevents the
  unstable-denominator blow-up.
* **Overlapping statements** would double-count daily rows and per-period TWR alike — the same
  non-overlap assumption as DDR-0005/DDR-0008, unchanged here.

## Alternatives Considered

### Cumulative % change of portfolio *value* (`value/startValue − 1`)

Rejected: dense and trivially derived from the existing `valueSeries`, but deposits/withdrawals
inflate it — a contribution reads as performance, and it would contradict the TWR headline. The
owner explicitly wanted *performance*, not *balance change*.

### Cumulative gain in EUR (running sum of daily MTM)

Rejected: shows money made in base currency but is still contribution-sensitive unless netted,
and is essentially the value curve's information in different units — it does not add the
*return* view the headline promises.

### True daily time-weighted return (daily MTM ÷ daily capital, chain-linked)

Rejected as over-engineering for this slice: it needs a reliable daily capital base (running NAV
before each day's flows) and careful flow-timing (Modified Dietz), and would still not reconcile
to IBKR's reported period TWR without an anchor. The chosen anchor-to-reported-TWR approach is
simpler, reconciles by construction, and matches the value curve's established pattern.

### A separate chart panel or route per chart

Rejected: two panels double the vertical scroll and the empty-state handling; a route is
heavier than a view-local toggle. The in-panel segmented control keeps both charts one click
apart with a single `needs_import` guard ([[0006-app-shell-tab-navigation]]).

## References

- [[0008-daily-portfolio-value-reconstruction]] — the value curve, endpoint-anchoring pattern,
  daily MTM source, and shared `LineChart` this decision extends
- [[0005-analytics-read-model-and-base-currency-conversion]] — `cumulativeTwr`/`chainLinkTwr`,
  convert-in-the-service rule, and the non-overlap statement caveat
- [[0006-app-shell-tab-navigation]] — the tab-pill pattern reused at panel scale
- ADR-0005 (`docs/decisions/0005-flex-query-file-import.md`) — the Flex file data source
- GitHub Issues #4 (Epic M3), #45 (Story), #29 (the value curve this builds beside)
