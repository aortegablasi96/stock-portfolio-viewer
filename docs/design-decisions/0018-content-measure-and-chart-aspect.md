# 0018. One shared content measure, and charts sized by aspect ratio

- **Status:** Accepted
- **Date:** 2026-07-26

## Context

The dashboard column has been capped at `72rem` since M1 ([[0001-dashboard-layout-and-load-states]]),
a measure chosen when the only screen was a header, three tiles, a holdings table and a
narrow allocation rail. M3 filled the app with much denser views — eight- and nine-column
tables, side-by-side breakdowns, a world map — and the window is now frameless and usually
maximized ([[0011-custom-frameless-window-shell]]). On a maximized window the `72rem` column
left several hundred pixels of empty background on each side while tables were squeezed
inside it. Story #76 asks for that space back.

Widening the column is one line on its own; what makes it a decision is what widening
*breaks*. The tab strip and the content column were positioned independently, so they only
happened to look aligned while the column was narrow. And the inline SVG charts
([[0005-analytics-read-model-and-base-currency-conversion]], [[0013-performance-twr-curve-and-chart-hover]])
are `width: 100%` over a fixed `viewBox`, so width drives height: a chart in a `110rem`
column would have been half a screen tall, with axis labels scaled up to match.

## Decision

**One measure for the whole shell.** `--content-max` (`110rem`) and `--content-pad` (`2rem`)
are declared on `:root` and used by both the content column (`.dashboard`) and the tab strip
(`.app-tabs`). The nav *bar* stays full-bleed — its border and blur span the window — but the
tabs inside it sit on the content measure, so the first tab lines up with the page heading at
every width. Alignment is now structural rather than coincidental.

> **Amended by [[0055-vertical-sidebar-tablist]] (Story #182).** The tab strip is gone: the views
> are a vertical sidebar beside the content, not a row above it, so there is nothing left to align
> to the measure and the second half of this paragraph no longer describes the app. The measure
> itself is untouched and now governs the content column alone — but it is measured from what the
> sidebar leaves, which is why `lib/chartGeometry` subtracts `--sidebar-width` before capping.

`110rem` (1760px) is chosen so a maximized window on an ordinary display is filled edge to
edge — at the common 1536px-wide desktop the column simply becomes the window — while an
ultrawide monitor still gets a cap rather than table rows a metre long.

**Charts are sized by aspect ratio, not by a pixel width.** The line chart's `viewBox` widens
from `720×240` to `1080×240` (4.5:1), and the column chart's minimum width follows it. Because
the SVG scales to its container, changing the ratio — not any CSS size — is what decides how
tall a full-width chart gets. At the new column width this reproduces almost exactly the plot
height and on-screen label size the charts had inside the old `72rem` column; they simply span
more of it.

**The bubble map keeps its own measure** (`56rem`, centred). It holds the world's 2:1 aspect,
so full-width would make it tall enough to push the breakdown panels off-screen — a chart's
natural aspect ratio, not the column, decides whether it should fill the column.

## Consequences

Benefits:

- Every view gets ~53% more horizontal room without a single per-view layout change: tables
  breathe, the breakdown split and realized-gains split get real column widths, and the
  charts plot more of their series per pixel of height.
- Nav and content share one measure, so future full-bleed chrome (a status bar, a footer)
  has an obvious rule to follow: full-bleed background, `--content-max` contents.
- Verified at 1280 / 1536 / 1920 CSS px on every tab: no horizontal page scrollbar, no element
  extending past the viewport, tab strip aligned with the heading at all three.

Tradeoffs:

- On very wide windows the sparser tables (three or four columns) spread their cells further
  apart. Accepted: the story explicitly prefers reclaimed space over a narrow column, and the
  dense tables — trades, dividends, returns by period — are the ones that gain most.
- Charts render their axis labels slightly smaller on a small window than before, since the
  labels now scale from a wider `viewBox`. Still comfortably above the app's smallest text.

## Alternatives Considered

### Just raise the `max-width` and leave everything else

Rejected: it is the whole change only if you stop at the numbers. It would have left the tab
strip visibly offset from the content and made the performance chart ~570px tall with oversized
axis labels — the story's own acceptance criteria ("charts remain readable") rule that out.

### Remove the cap entirely (full-bleed content)

Rejected: an ultrawide monitor would stretch a nine-column table across two feet of glass, and
prose (the Flex import intro, chart notes) would lose any readable measure. A cap that only
bites above ~1760px costs nothing on the displays this app actually runs on.

### Cap the charts' width and centre them inside the wider panel

Tried first, and it looked wrong: a chart floating in the middle of a panel with dark bands on
both sides reads as a rendering bug rather than a design. Widening the plot's aspect ratio gets
the same height control while the chart still fills its panel. The bubble map is the one place
the centred treatment is right, because its aspect is fixed by the world.

### Make the charts measure their container and pick a `viewBox` at runtime

Rejected: a `ResizeObserver` and re-render per chart to solve a problem a ratio solves. The
charts are deliberately dependency-free inline SVG; keeping the geometry declarative keeps them
testable and cheap.

## References

- [[0001-dashboard-layout-and-load-states]] (the original `72rem` column this supersedes),
  [[0011-custom-frameless-window-shell]], [[0013-performance-twr-curve-and-chart-hover]],
  [[0014-allocation-world-map-bubble-map]]
- `src/renderer/src/app.css` (`--content-max`, `.dashboard`, `.app-tabs`, `.chart`,
  `.bubble-map-frame`), `src/renderer/src/components/charts/LineChart.tsx`, `ColumnChart.tsx`
- GitHub Issue #76 (Epic #4)
