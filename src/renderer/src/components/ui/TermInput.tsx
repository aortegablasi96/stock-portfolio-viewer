import { useId, type InputHTMLAttributes } from 'react'
import { controlClassName } from '../../lib/fieldVariants'
import type { VocabularyTerm } from '../../lib/profileVocabulary'

/**
 * A vocabulary term the app suggests but does not require (Story #280, DDR-0094).
 *
 * A `<select>` was the first shape and it was wrong, for a reason the acceptance criteria state
 * outright: a currency target may name a currency **the owner anticipates** rather than one the
 * portfolio carries, and a list of held terms cannot express that at all. With nothing imported
 * it can express nothing — a fresh install could not state a single target.
 *
 * A `<datalist>` is the native control for exactly that shape: the known terms drop down as
 * suggestions, and anything else can still be typed. So the vocabularies stay what the story
 * calls them — a suggestion drawn from the app's own data (classification for sectors, the
 * allocation report for currencies and asset classes) — rather than a constraint the app
 * enforces on the owner's policy.
 *
 * The list is per instance through `useId()`, for the reason `Field` generates its id that way
 * (DDR-0035): every row's list is in the document at once, because the Profile tab stays mounted
 * like every other view (DDR-0027), and a fixed id would point every row at the first row's
 * suggestions.
 *
 * A term the portfolio does not currently hold is offered with its status written beside it, so
 * "not held" reads as information rather than as a warning. `<option>` text is a *label* here,
 * not the value — picking one fills the input with `key` alone.
 *
 * Pair it with `Field` for the label; used bare it has no accessible name.
 */
export function TermInput({
  terms,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'list' | 'type'> & {
  /** What the app knows about, each marked with whether the portfolio currently holds it. */
  terms: readonly VocabularyTerm[]
}): React.JSX.Element {
  const listId = useId()
  return (
    <>
      <input
        type="text"
        autoComplete="off"
        list={listId}
        className={controlClassName('term', className)}
        {...props}
      />
      <datalist id={listId}>
        {terms.map((term) => (
          <option key={term.key} value={term.key}>
            {term.held ? term.label : `${term.label} — not currently held`}
          </option>
        ))}
      </datalist>
    </>
  )
}
