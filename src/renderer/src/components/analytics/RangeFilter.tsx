import type { Bounds, RangeId } from '../../lib/dateRange'
import { RANGE_OPTIONS, toDateInput } from '../../lib/dateRange'
import { DateInput } from '../ui/DateInput'
import { Field } from '../ui/Field'
import { ToggleGroup } from '../ui/ToggleGroup'

/**
 * The time-range control: a group of period presets (1M / 3M / 1Y / YTD / All / Custom) plus the
 * two date inputs that appear when Custom is chosen. Introduced for the Performance view (Story
 * #69) and shared with the dividends and trades tables (Story #75), so every period selector in
 * the app looks and behaves the same.
 *
 * The list is `RANGE_OPTIONS` and nothing here filters it: a preset belongs to the vocabulary or
 * it does not exist, which is what keeps the three views from drifting apart. YTD was added that
 * way rather than as a Performance-only option (Story #256, DDR-0085) — "dividends this year" and
 * "trades this year" are the same question the Performance view asks.
 *
 * Presentational only — the owning view holds the selection (through `useRangeSelection`) and
 * resolves it to a window (through `lib/dateRange`), because what a window *does* differs by
 * view: charts slice a series to it, tables filter rows against it.
 *
 * The presets are a single-select `ToggleGroup` (Story #131, DDR-0036) — exactly one period is
 * in force, so they wear the control corner rather than the type filter's pills.
 *
 * The date inputs are `Field`s (Story #130, DDR-0035), which matters more here than anywhere
 * else in the app: all three views carrying a `RangeFilter` can be mounted at once (DDR-0027),
 * so their labels are paired to generated ids rather than to any name this file could pick.
 * They stay bounded by the data extent, so the picker can't offer a day the imported history
 * doesn't cover.
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
      <ToggleGroup label={label} options={RANGE_OPTIONS} value={range} onSelect={onSelect} />
      {range === 'custom' && extent && (
        <div className="range-custom">
          <Field label="From">
            {(id) => (
              <DateInput
                id={id}
                value={toDateInput(custom.from)}
                min={toDateInput(extent.from)}
                max={toDateInput(extent.to)}
                onChange={(e) => onEditCustom('from', e.target.value)}
              />
            )}
          </Field>
          <Field label="To">
            {(id) => (
              <DateInput
                id={id}
                value={toDateInput(custom.to)}
                min={toDateInput(extent.from)}
                max={toDateInput(extent.to)}
                onChange={(e) => onEditCustom('to', e.target.value)}
              />
            )}
          </Field>
        </div>
      )}
    </div>
  )
}
