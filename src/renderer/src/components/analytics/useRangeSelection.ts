import { useCallback, useState } from 'react'
import type { Bounds, RangeId } from '../../lib/dateRange'
import { fromDateInput } from '../../lib/dateRange'

/**
 * Selected time-range state for a `RangeFilter` (Stories #69, #75). Holds the active preset and
 * the custom window, shared by the Performance view and the analytics tables so all three get
 * identical range behaviour.
 *
 * `custom` stays `null` until the owner first edits a date, which lets each caller seed the
 * inputs from its own data extent — the hook deliberately knows nothing about the data, because
 * the views resolve their extent only after their loading and needs-import states have returned.
 */
export function useRangeSelection(): {
  range: RangeId
  setRange: (id: RangeId) => void
  /** The edited custom window, or `null` before the first edit. */
  custom: Bounds | null
  /**
   * Set one edge of the custom window from a `YYYY-MM-DD` input value, seeding the untouched
   * edge from `fallback` (the caller's data extent). A malformed value is ignored, so a
   * half-typed date never collapses the window.
   */
  editCustom: (edge: 'from' | 'to', value: string, fallback: Bounds) => void
} {
  const [range, setRange] = useState<RangeId>('all')
  const [custom, setCustom] = useState<Bounds | null>(null)

  const editCustom = useCallback((edge: 'from' | 'to', value: string, fallback: Bounds): void => {
    const ms = fromDateInput(value)
    if (ms === null) return
    setCustom((prev) => ({ ...(prev ?? fallback), [edge]: ms }))
  }, [])

  return { range, setRange, custom, editCustom }
}
