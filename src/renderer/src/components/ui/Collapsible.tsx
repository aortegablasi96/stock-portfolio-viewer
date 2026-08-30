import { useId, useState, type ReactNode } from 'react'
import {
  collapsibleClassName,
  collapsibleMarkerClassName,
  collapsiblePartClassName,
  DEFAULT_COLLAPSIBLE_LEVEL,
  headingFor,
  triggerAria,
  type CollapsibleLevel,
} from '../../lib/collapsibleVariants'

/**
 * The app's one show-and-hide surface (Story #308, DDR-0106).
 *
 * `components/ui/` held thirteen primitives and none of them collapsed. The only `aria-expanded`
 * in the renderer was `SidebarRail`'s own toggle, which is a sidebar concern — one `app-collapsed`
 * flag on the shell, deliberately not a `collapsed` prop (DDR-0068) — and reusable nowhere. #310
 * needs six collapsible surfaces on one page, so the behaviour comes first and separately rather
 * than being written inline six times, which is the hand-picked-value failure Epic #125 exists to
 * prevent.
 *
 * **It paints nothing.** No background, no border, no radius: the surface behind a collapsible is
 * the `Card`'s, exactly as a `StatTile` declares no surface of its own (DDR-0033, DDR-0034). What
 * it owns is the head row, the trigger's affordance and the panel's visibility — which is why the
 * five sections of #310's profile can each become collapsible without any of them changing shape.
 *
 * **Closed means hidden, never unmounted.** That is the same decision the tab shell makes for a
 * view (DDR-0027) and it is load-bearing here: #310's sections hold a form, and unmounting one
 * would discard whatever the owner had typed into it the moment they folded it away to read the
 * section below. `hidden` also removes the content from the tab order for free, so a closed
 * panel's controls are not focusable stops the reader cannot see.
 *
 * **Uncontrolled, unlike `ToggleGroup`.** That primitive is presentational because a selection
 * *is* view state — it decides what a card draws, and the view has to know. Open-and-closed
 * decides nothing but its own visibility, and no other part of the app has a reason to read or
 * set it. `defaultOpen` therefore seeds the first render and the primitive keeps it from there.
 *
 * The pattern is the WAI-ARIA **disclosure**, not the accordion: independent sections, no sibling
 * coordination, no arrow keys. `lib/collapsibleVariants` records what that leaves out and why.
 */
export function Collapsible({
  label,
  level = DEFAULT_COLLAPSIBLE_LEVEL,
  defaultOpen = true,
  action,
  className,
  children,
}: {
  /** The visible section name, which is also the trigger's accessible name. */
  label: string
  /** How deep this sits — a band over cards, or one card's own head. The only axis. */
  level?: CollapsibleLevel
  /** Whether it starts open. Open by default: a section that hides its content unasked is lost. */
  defaultOpen?: boolean
  /** A control belonging to the section, placed beside the trigger and never inside it. */
  action?: ReactNode
  className?: string
  children: ReactNode
}): React.JSX.Element {
  const panelId = useId()
  const [open, setOpen] = useState(defaultOpen)
  const Heading = headingFor(level)

  return (
    <div className={collapsibleClassName(level, className)}>
      <div className={collapsiblePartClassName('head')}>
        <Heading className={collapsiblePartClassName('heading')}>
          <button
            type="button"
            className={collapsiblePartClassName('trigger')}
            {...triggerAria(open, panelId)}
            onClick={() => setOpen((wasOpen) => !wasOpen)}
          >
            <Marker open={open} />
            {label}
          </button>
        </Heading>
        {action !== undefined && (
          <div className={collapsiblePartClassName('action')}>{action}</div>
        )}
      </div>
      <div id={panelId} className={collapsiblePartClassName('panel')} hidden={!open}>
        {children}
      </div>
    </div>
  )
}

/**
 * The disclosure arrow, in the convention `TabIcons.tsx` and `TitleBar.tsx` established:
 * dependency-free inline SVG, a 16×16 viewBox that is geometry rather than a size, drawn in
 * `currentColor` so it inherits the trigger's ink and introduces no colour of its own for
 * `lib/contrast.ts` to cover (ADR-0008).
 *
 * `aria-hidden`, because it is a second channel beside `aria-expanded` and never the announcement:
 * a reader is told the state by the trigger, and shown it by this.
 *
 * One glyph turned, rather than two glyphs swapped — the same call `SidebarToggle` makes for its
 * chevron, and the reason there applies here too: the thing being acted on stays recognisable and
 * only its direction changes. The turn is CSS, so the one `prefers-reduced-motion` block that
 * zeroes `--duration-*` reaches it without naming it (DDR-0044).
 */
function Marker({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg
      className={collapsibleMarkerClassName(open)}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  )
}
