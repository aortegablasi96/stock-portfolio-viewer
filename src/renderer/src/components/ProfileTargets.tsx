import {
  duplicateRowIds,
  newTargetRow,
  rowMessage,
  type TargetRowDraft,
} from '../lib/investorProfile'
import { availableTerms, type VocabularyTerm } from '../lib/profileVocabulary'
import {
  TARGET_DIMENSION_HEADINGS,
  TARGET_DIMENSION_LABELS,
  type TargetDimension,
} from '@shared/domain/investorProfileTerms'
import { Button } from './ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card'
import { Field } from './ui/Field'
import { PercentInput } from './ui/PercentInput'
import { TermInput } from './ui/TermInput'

/**
 * One dimension's target list on the Profile page (Story #280, DDR-0094).
 *
 * The same component draws currency, sector and asset-class weight, because they are the same
 * statement about three vocabularies — which is also why `RangeFilter` renders `RANGE_OPTIONS`
 * unfiltered (DDR-0085): a control that can differ per call site is a control that will.
 *
 * Three things about it are decisions rather than defaults.
 *
 * **The key is suggested, never constrained.** A sector target means something against the names
 * the classification domain actually produces (DDR-0009), so those are what drop down — but a
 * currency target may name a currency the owner *anticipates* rather than one they hold, and a
 * fresh install holds nothing at all. A `<select>` was the first shape and could express neither
 * (see `TermInput`).
 *
 * **Every control carries its own visible label**, repeated down the rows, rather than a table's
 * column heads. Three inputs whose meanings are "which", "at least" and "at most" are a sentence,
 * and a column head three rows above is not where the owner is looking. `Field` generates each
 * id with `useId()`, which is what makes that safe: the Profile tab stays mounted like every
 * other view (DDR-0027), so a fixed id would be duplicated the moment a second row existed
 * (DDR-0035).
 *
 * **A row reports its own fault, under itself.** The IPC boundary rejects a bad profile whole
 * (ADR-0002), but a sentence about the document is not what tells an owner which of eight rows to
 * look at.
 */
export function ProfileTargets({
  dimension,
  rows,
  terms,
  onChange,
  lede,
}: {
  dimension: TargetDimension
  rows: readonly TargetRowDraft[]
  /** What the portfolio holds, plus what the form already names. */
  terms: readonly VocabularyTerm[]
  onChange: (rows: readonly TargetRowDraft[]) => void
  /** One sentence saying what a target in this dimension means. */
  lede: string
}): React.JSX.Element {
  const noun = TARGET_DIMENSION_LABELS[dimension]
  const duplicates = duplicateRowIds(rows)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{TARGET_DIMENSION_HEADINGS[dimension]}</CardTitle>
        <Button size="sm" onClick={() => onChange([...rows, newTargetRow()])}>
          Add target
        </Button>
      </CardHeader>
      <CardContent>
        <p className="profile-lede">{lede}</p>

        {rows.length === 0 ? (
          /* Not a `StatePanel`: nothing failed and nothing is missing. An unset dimension is a
             valid profile, so the line says what it means rather than prompting a fix. */
          <p className="profile-empty">No {noun.toLowerCase()} targets — no policy stated here.</p>
        ) : (
          <ul className="profile-targets">
            {rows.map((row) => (
              <TargetRow
                key={row.id}
                row={row}
                dimension={dimension}
                message={rowMessage(row, dimension, duplicates)}
                /* Terms another row already claims are not offered to this one, which is how a
                   duplicate becomes hard to reach through the control rather than merely reported
                   after the fact. It stays *reported* too, because the list is only a suggestion
                   and a term can always be typed. */
                terms={availableTerms(terms, rows, row.id)}
                onEdit={(patch) =>
                  onChange(rows.map((r) => (r.id === row.id ? { ...r, ...patch } : r)))
                }
                onRemove={() => onChange(rows.filter((r) => r.id !== row.id))}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * One target: which category, and the band it should sit in.
 *
 * A component of its own rather than a mapped fragment, because `TermInput` calls `useId()` for
 * its suggestion list and a hook cannot be called from inside a `map`.
 */
function TargetRow({
  row,
  dimension,
  message,
  terms,
  onEdit,
  onRemove,
}: {
  row: TargetRowDraft
  dimension: TargetDimension
  message: string | null
  terms: readonly VocabularyTerm[]
  onEdit: (patch: Partial<TargetRowDraft>) => void
  onRemove: () => void
}): React.JSX.Element {
  const noun = TARGET_DIMENSION_LABELS[dimension]

  return (
    <li className="profile-target">
      <div className="profile-target-row">
        <Field label={noun} className="profile-target-key">
          {(id) => (
            <TermInput
              id={id}
              terms={terms}
              value={row.key}
              onChange={(e) => onEdit({ key: e.target.value })}
            />
          )}
        </Field>

        <Field label="At least %">
          {(id) => (
            <PercentInput
              id={id}
              value={row.low}
              onChange={(e) => onEdit({ low: e.target.value })}
            />
          )}
        </Field>

        <Field label="At most %">
          {(id) => (
            <PercentInput
              id={id}
              value={row.high}
              onChange={(e) => onEdit({ high: e.target.value })}
            />
          )}
        </Field>

        {/* The name says which target, so a screen reader hearing eight "Remove"s can tell them
            apart. An unfilled row has no name yet, hence the two forms. */}
        <Button
          variant="link"
          size="sm"
          aria-label={
            row.key.trim() === ''
              ? `Remove this ${noun.toLowerCase()} target`
              : `Remove the ${row.key.trim()} target`
          }
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
      {message && <p className="profile-target-issue">{message}</p>}
    </li>
  )
}
