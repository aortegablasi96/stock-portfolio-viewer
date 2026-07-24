import type { AllocationSlice } from '@shared/domain/allocation'
import { MAP_HEIGHT, MAP_WIDTH, splitCountryBubbles, WORLD_SILHOUETTE_PATH } from '../../lib/worldGeo'

/**
 * Equirectangular bubble map of holdings by country (Milestone M3, Story #46, DDR-0014).
 *
 * A faint world-land silhouette is drawn once as a single SVG path; each country the owner
 * holds is a circle placed at its centroid, with area proportional to market value. Silhouette
 * and circles share one projection (`projectEquirectangular`), so they align exactly — no
 * charting or geo dependency, matching the inline-SVG stance of the other charts (DDR-0006).
 *
 * The map consumes the same `report.byCountry` slices the geography donut uses. Countries with
 * no centroid and the '' / 'Unknown' slice can't be placed, so `splitCountryBubbles` folds them
 * into an `unknown` bucket surfaced as a labelled legend chip rather than dropping them.
 */
export function BubbleMap({
  data,
  formatValue,
  ariaLabel,
  emptyMessage = 'No country data to map yet.',
}: {
  data: AllocationSlice[]
  formatValue: (v: number) => string
  ariaLabel: string
  emptyMessage?: string
}): React.JSX.Element {
  const { bubbles, unknown } = splitCountryBubbles(data)

  if (bubbles.length === 0 && unknown.count === 0) {
    return <p className="chart-empty">{emptyMessage}</p>
  }

  return (
    <figure className="chart-figure bubble-map-figure">
      <svg
        className="bubble-map"
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="xMidYMid meet"
      >
        <path className="bubble-map-land" d={WORLD_SILHOUETTE_PATH} />
        {bubbles.map((b) => (
          <circle key={b.code} className="bubble-map-dot" cx={b.x} cy={b.y} r={b.r}>
            <title>{`${b.name} — ${formatValue(b.value)} (${b.percent.toFixed(1)}% of NAV)`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="chart-legend bubble-map-legend">
        <span className="bubble-map-hint">Circle size ∝ holding value</span>
        {unknown.count > 0 && (
          <span
            className="bubble-map-unknown"
            title={`${unknown.count} country group(s) with no locatable country`}
          >
            Unknown — {formatValue(unknown.value)} ({unknown.percent.toFixed(1)}% of NAV)
          </span>
        )}
      </figcaption>
    </figure>
  )
}
