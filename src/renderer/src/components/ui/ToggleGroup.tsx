import {
  DEFAULT_TOGGLE_MODE,
  toggleGroupClassName,
  toggleItemClassName,
  type ToggleMode,
} from '../../lib/toggleGroupVariants'

/** One choice in a group. `title` becomes the item's tooltip, as the range presets need. */
export type ToggleOption<T extends string> = {
  id: T
  label: string
  title?: string
}

type CommonProps<T extends string> = {
  /** Accessible name for the group, e.g. "Performance time range" — required, never inferred. */
  label: string
  options: readonly ToggleOption<T>[]
  /** Called with the item that was pressed. In `multiple` mode this means "toggle it". */
  onSelect: (id: T) => void
  className?: string
}

/**
 * The app's one segmented control (Story #131, DDR-0036), replacing `.chart-tabs` /
 * `.chart-tab` — a class named for the Performance view's chart switcher that four later
 * controls borrowed verbatim because no primitive existed.
 *
 * Adding a group means naming how many of its items can be on at once, not writing CSS:
 * `mode` says whether the group picks one option or any number, and it is the only axis
 * (see `lib/toggleGroupVariants`). The rest of the contract is fixed, which is the point —
 * a `role="group"` with an `aria-label`, and `aria-pressed` toggle buttons inside it.
 *
 * That contract also *corrects* three of the five call sites. The Performance chart switcher
 * and the Allocation view's two strips each declared `role="tablist"` with `role="tab"`
 * children, which promises the WAI-ARIA tabs pattern: a roving `tabindex`, arrow-key
 * navigation, and a `role="tabpanel"` each tab points at. None of them implemented any of it,
 * so a screen-reader user was told "tab 2 of 4" and then found four ordinary Tab stops and no
 * panel. The app *does* have that pattern, built properly for the tab shell in
 * `lib/tabKeyboard.ts` (DDR-0029) — and these are not tabs: they switch what a single card
 * draws, which is a pressed-state toggle. `aria-pressed` describes them accurately and needs
 * no keyboard behaviour beyond the button's own.
 *
 * Presentational only. The owning view holds the selection, because what a selection *does*
 * differs by view — a range filter reframes a window, a breakdown strip picks a dimension, a
 * type chip filters rows.
 *
 * Four call sites now, not five: Story #172 retired the Performance chart switcher — the control
 * this primitive's superseded class was named after — when the four charts moved into a grid that
 * shows them at once (DDR-0051). The paragraph above is kept as written because it is the record
 * of what the contract corrected, and the switcher is where the `role="tablist"` mistake started.
 */
export function ToggleGroup<T extends string>(
  props: CommonProps<T> &
    (
      | { mode?: 'single'; value: T }
      | { mode: 'multiple'; value: ReadonlySet<T> }
    ),
): React.JSX.Element {
  const mode: ToggleMode = props.mode ?? DEFAULT_TOGGLE_MODE
  const isSelected = (id: T): boolean =>
    props.mode === 'multiple' ? props.value.has(id) : props.value === id

  return (
    <div className={toggleGroupClassName(props.className)} role="group" aria-label={props.label}>
      {props.options.map((option) => {
        const selected = isSelected(option.id)
        return (
          <button
            key={option.id}
            type="button"
            title={option.title}
            aria-pressed={selected}
            className={toggleItemClassName(mode, selected)}
            onClick={() => props.onSelect(option.id)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
