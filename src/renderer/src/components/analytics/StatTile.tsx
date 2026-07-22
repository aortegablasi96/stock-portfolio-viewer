/**
 * A single headline figure for the analytics views (Stories #21–#24). `tone` colours
 * the value for gain/loss polarity; it defaults to neutral. Text stays in ink tokens —
 * the tone is a deliberate, reserved semantic (positive/negative), not a series colour.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'neutral' | 'positive' | 'negative'
}): React.JSX.Element {
  return (
    <div className="stat-tile">
      <p className="stat-label">{label}</p>
      <p className={`stat-value stat-${tone}`}>{value}</p>
      {hint && <p className="stat-hint">{hint}</p>}
    </div>
  )
}

/** Polarity tone for a signed figure: positive, negative, or neutral at zero. */
export function toneOf(value: number): 'neutral' | 'positive' | 'negative' {
  if (value > 0) return 'positive'
  if (value < 0) return 'negative'
  return 'neutral'
}
