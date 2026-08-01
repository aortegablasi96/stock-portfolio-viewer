import { useId, type ReactNode } from 'react'
import { fieldClassName, fieldLabelClassName } from '../../lib/fieldVariants'

/**
 * The app's one labelled control (Story #130, DDR-0035). Before it, the two form controls in
 * the app shared a class but not a technique: `CurrencySelector` paired `<label htmlFor>` with
 * an `id`, while `RangeFilter` wrapped its input in a `<label>` around a bare `<span>` — two
 * valid ways to label the same control shape, in the same app, and a duplicate CSS rule
 * (`.range-custom .field-inline span`) that existed only because the second one put the text in
 * a `<span>` where the first had a `<label>`.
 *
 * `Field` settles it on **explicit `htmlFor`**, and owns the identity itself through `useId()`
 * rather than taking an `id` prop. That is not a stylistic preference: analytics tabs mount on
 * first visit and then stay mounted (DDR-0027), so all three views carrying a `RangeFilter` —
 * Performance, Dividends, Trade history — can be in the DOM at the same time. Any hard-coded
 * or defaulted id would then appear three times over, and a duplicate `id` silently points
 * every one of those labels at whichever control the document happens to hold first. `useId`
 * is unique per instance, so the pairing survives however many copies are mounted.
 *
 * The control comes as a function of that id rather than as plain children, so a call site
 * cannot receive the id and forget to use it — the label always names the control it sits
 * beside, by construction.
 */
export function Field({
  label,
  className,
  children,
}: {
  /** The visible label text, which is also the control's accessible name. */
  label: string
  className?: string
  /** The control, given the id its label points at. */
  children: (id: string) => ReactNode
}): React.JSX.Element {
  const id = useId()
  return (
    <div className={fieldClassName(className)}>
      <label className={fieldLabelClassName()} htmlFor={id}>
        {label}
      </label>
      {children(id)}
    </div>
  )
}
