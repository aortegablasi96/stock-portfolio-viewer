/**
 * Pure helpers for the type-filtered, row-capped analytics tables (Stories #32, #33).
 * Kept out of the components so the option-derivation and filtering rules are unit-tested
 * directly, the way the other renderer helpers in this folder are.
 */

/** Sentinel filter value meaning "no type filter applied" (all rows shown). */
export const ALL_TYPES = 'all'

/**
 * The distinct values of `key` across `rows`, in first-seen order — the option list for a
 * type filter. First-seen (not alphabetical) keeps the options in the table's own order,
 * which for these views is already newest-first, so the most recent types surface first.
 */
export function distinctTypes<T>(rows: readonly T[], key: (row: T) => string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const row of rows) {
    const type = key(row)
    if (!seen.has(type)) {
      seen.add(type)
      out.push(type)
    }
  }
  return out
}

/**
 * The rows whose `key` equals `selected`, or every row when `selected` is `ALL_TYPES`.
 * Returns a fresh array so callers can render it directly without aliasing the input.
 */
export function filterByType<T>(
  rows: readonly T[],
  key: (row: T) => string,
  selected: string,
): T[] {
  return selected === ALL_TYPES ? [...rows] : rows.filter((row) => key(row) === selected)
}
