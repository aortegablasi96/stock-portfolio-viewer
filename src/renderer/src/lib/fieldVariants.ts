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
 * The two native controls the app has. A `kind` carries **cursor and colour-scheme only** —
 * the differences that follow from the element rather than from any styling choice: a select
 * is clicked (`pointer`), a date input's text is edited in place (`text`), and only the date
 * input has a browser-supplied picker, whose calendar glyph needs `color-scheme` to be told
 * the surface under it is dark.
 *
 * Everything else — padding, border, radius, type, hover, disabled — is the shared `.control`
 * box, which is what makes the two read as one control family.
 */
export const CONTROL_KINDS = ['select', 'date'] as const

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
