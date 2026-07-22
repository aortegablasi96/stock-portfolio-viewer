/**
 * A horizontal magnitude bar list (Milestone M3, Story #22). One recessive track per
 * category, filled proportionally to the largest value in the set, with a direct value
 * + share label. Single-hue (magnitude), so no legend. Plain HTML/CSS — no SVG or
 * charting dependency.
 */
export interface BarListItem {
  key: string
  label: string
  value: number
  /** Share of NAV as a percent (shown beside the value). */
  percent: number
}

export function BarList({
  items,
  formatValue,
  ariaLabel,
}: {
  items: BarListItem[]
  formatValue: (v: number) => string
  ariaLabel: string
}): React.JSX.Element {
  const max = Math.max(...items.map((i) => i.value), 0) || 1

  return (
    <ul className="bar-list" aria-label={ariaLabel}>
      {items.map((item) => (
        <li key={item.key} className="bar-list-item">
          <div className="bar-list-head">
            <span className="bar-list-label">{item.label}</span>
            <span className="bar-list-value">
              {formatValue(item.value)}
              <span className="bar-list-pct">{item.percent.toFixed(1)}%</span>
            </span>
          </div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${Math.max(0, (item.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}
