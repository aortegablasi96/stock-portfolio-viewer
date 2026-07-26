import type { Bounds, RangeId } from '../../lib/dateRange'
import { RANGE_OPTIONS, toDateInput } from '../../lib/dateRange'

/**
 * The time-range control: a group of period presets (1M / 3M / 1Y / All / Custom) plus the two
 * date inputs that appear when Custom is chosen. Introduced for the Performance view (Story #69)
 * and shared with the dividends and trades tables (Story #75), so every period selector in the
 * app looks and behaves the same.
 *
 * Presentational only — the owning view holds the selection (through `useRangeSelection`) and
 * resolves it to a window (through `lib/dateRange`), because what a window *does* differs by
 * view: charts slice a series to it, tables filter rows against it.
 *
 * The presets are `aria-pressed` toggle buttons inside an `aria-label`led group, so the control
 * is labelled and fully keyboard-operable. The date inputs are bounded by the data extent, so
 * the picker can't offer a day the imported history doesn't cover.
 */
export function RangeFilter({
  label,
  range,
  onSelect,
  extent,
  custom,
  onEditCustom,
}: {
  /** Accessible label for the group, e.g. "Trade history time range". */
  label: string
  range: RangeId
  onSelect: (id: RangeId) => void
  /** The data's full date span; `null` when nothing is dated, which hides the custom inputs. */
  extent: Bounds | null
  /** The custom window to show in the inputs (the caller's extent until first edited). */
  custom: Bounds
  onEditCustom: (edge: 'from' | 'to', value: string) => void
}): React.JSX.Element {
  return (
    <div className="range-bar">
      <div className="chart-tabs" role="group" aria-label={label}>
        {RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            title={opt.title}
            aria-pressed={range === opt.id}
            className={`chart-tab ${range === opt.id ? 'chart-tab-active' : ''}`}
            onClick={() => onSelect(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {range === 'custom' && extent && (
        <div className="range-custom">
          <label className="field-inline">
            <span>From</span>
            <input
              type="date"
              className="select-control"
              value={toDateInput(custom.from)}
              min={toDateInput(extent.from)}
              max={toDateInput(extent.to)}
              onChange={(e) => onEditCustom('from', e.target.value)}
            />
          </label>
          <label className="field-inline">
            <span>To</span>
            <input
              type="date"
              className="select-control"
              value={toDateInput(custom.to)}
              min={toDateInput(extent.from)}
              max={toDateInput(extent.to)}
              onChange={(e) => onEditCustom('to', e.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  )
}
