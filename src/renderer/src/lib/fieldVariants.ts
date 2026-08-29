/**
 * The `Field`, `Select` and `DateInput` primitives' class contract (Story #130, DDR-0035).
 *
 * Same split as the button's and the card's (DDR-0032, DDR-0033), for the same reason: Vitest
 * runs Node-only, so nothing inside a component is testable (DDR-0029). Keeping the union and
 * the class composition in a pure module lets the test assert both halves of the contract —
 * that a call composes the class list a caller expects, and that `app.css` actually declares a
 * rule behind every member of the union.
 *
 * The control has **no size axis**, unlike the button and the card. Both of the app's form
 * controls are the same dense box, so a size scale here would ship with exactly one value in
 * use — the speculative abstraction the project's principles rule out, and the same call
 * DDR-0034 made for the stat tile. The one thing that genuinely differs between the two
 * controls is which native element they are, and that is what `kind` names.
 */

/**
 * The five native controls the app has. A `kind` carries **cursor, colour-scheme and measure
 * only** — the differences that follow from the element rather than from any styling choice: a
 * select is clicked (`pointer`), a text control's content is edited in place (`text`), only the
 * date input has a browser-supplied picker whose calendar glyph needs `color-scheme` to be told
 * the surface under it is dark, and the two typed controls differ in how wide their content is.
 *
 * Everything else — padding, border, radius, type, hover, disabled — is the shared `.control`
 * box, which is what makes the four read as one control family.
 *
 * **`percent` and `term` arrived together with the Profile form** (Story #280, DDR-0094), the
 * app's first typed controls. They are two kinds rather than a size axis, because DDR-0035's
 * reason for refusing a size scale still holds — every control here is the same dense box — and
 * what actually differs is the measure the content implies: a percentage is at most five
 * characters and is set to exactly that, so a column of them lines up; a vocabulary term is a
 * currency code or a sector name and takes whatever the row can spare.
 *
 * **`term` names the measure, not the vocabulary** — an amendment Story #300 makes rather than
 * adding a sixth kind (DDR-0105). The assistant's API key field is a `type="password"` input that
 * wants exactly `term`'s box and nothing else, so a `secret` kind would be an axis value whose
 * rule duplicated another's declaration for declaration. That is the same abstraction DDR-0034 and
 * this record already refuse for a size scale, and the guard test would not catch it: a duplicate
 * rule *is* a rule. The `<datalist>` is the profile call site's, never the kind's.
 *
 * **`prose` arrives with the Assistant's question box** (Story #284, DDR-0098) and is the first
 * kind that is not an `<input>`. It fits the axis rather than straining it: a `kind` names the
 * element and the measure its content implies, and a question is several lines of ordinary
 * writing, so the measure is the row's whole width and a few lines of height. It is still the
 * shared `.control` box — same padding, border, radius and hover — which is what keeps a textarea
 * from reading as a foreign control on a page of them. What it adds beyond a measure is
 * `resize: vertical`: a textarea is resizable by default in both axes, and horizontal resizing
 * would let one control break a card's own width.
 */
export const CONTROL_KINDS = ['select', 'date', 'percent', 'term', 'prose'] as const

export type ControlKind = (typeof CONTROL_KINDS)[number]

/** Append a call site's `className` for placement, never for restyling (ADR-0008). */
function compose(parts: string[], className?: string): string {
  return className ? [...parts, className].join(' ') : parts.join(' ')
}

/** Compose the class list for the label/control pairing. */
export function fieldClassName(className?: string): string {
  return compose(['field'], className)
}

/** Compose the class list for a field's label. */
export function fieldLabelClassName(className?: string): string {
  return compose(['field-label'], className)
}

/** Compose the class list for a form control of the given kind. */
export function controlClassName(kind: ControlKind, className?: string): string {
  return compose(['control', `control-${kind}`], className)
}
