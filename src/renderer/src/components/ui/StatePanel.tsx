import type { HTMLAttributes, ReactNode } from 'react'
import {
  DEFAULT_STATE_PANEL_SURFACE,
  DEFAULT_STATE_PANEL_VARIANT,
  statePanelClassName,
  statePanelElement,
  statePanelRole,
  type StatePanelSurface,
  type StatePanelVariant,
} from '../../lib/statePanelVariants'
import { Card } from './Card'

/**
 * The app's one "there is nothing here to show" panel (Story #133, DDR-0038), replacing the five
 * presentations the Epic #125 audit found for four states the architecture already models as one
 * thing: `.state-panel` / `.state-notice` / `.state-error` on the Portfolio dashboard,
 * `NeedsImport`'s own panel, `.snapshot-empty`, `.chart-empty` (twelve call sites) and the map's
 * `.country-map-unavailable`. They disagreed about whether a state gets a surface, a heading, an
 * explanation, a hint and an action — so a reader meeting two of them in one session was given no
 * consistent signal.
 *
 * Adding one means naming the state and where it sits, not writing CSS: `variant` says which of
 * loading · empty · notice · error this is, `surface` whether the panel brings a card with it or
 * sits inside one that already exists.
 *
 * The parts are fixed in one order — heading, explanation, hint, action — so the recovery action
 * is always the last thing and always in the same place. That ordering *is* the story: the states
 * differ in what they say, never in where they say it.
 *
 * Two things the primitive derives rather than asks for. The element: a panel with no heading is
 * its own paragraph, which is exactly the markup the superseded call sites rendered and what
 * keeps the dashboard's spacing (DDR-0033). And the ARIA role: an error is the one state that
 * interrupts, so it is the one `alert`. Both live in `lib/statePanelVariants` where they can be
 * tested, and `role` remains overridable for a caller that needs it.
 */
export function StatePanel({
  variant = DEFAULT_STATE_PANEL_VARIANT,
  surface = DEFAULT_STATE_PANEL_SURFACE,
  heading,
  hint,
  action,
  className,
  children,
  ...props
}: Omit<HTMLAttributes<HTMLElement>, 'children'> & {
  variant?: StatePanelVariant
  surface?: StatePanelSurface
  /** The state in a few words. Omitted by the one-line loading and inline empty states. */
  heading?: ReactNode
  /** What to do about it, below the explanation: a re-login URL, an env var to set. */
  hint?: ReactNode
  /** The recovery action — a `Button`, always last (Retry, Import statements…). */
  action?: ReactNode
  /** The explanation. Wrapped in a paragraph when a heading is present, else it *is* one. */
  children?: ReactNode
}): React.JSX.Element {
  const Tag = statePanelElement(surface, heading != null)
  const classes = statePanelClassName(variant, surface, className)
  const role = statePanelRole(variant)

  // No heading: the panel is the paragraph its explanation would have been, so there is nothing
  // to wrap and nothing else to place. Hint and action still follow if a caller supplies them.
  const body =
    heading == null ? (
      children
    ) : (
      <>
        <h2 className="state-panel-heading">{heading}</h2>
        {children != null && <p>{children}</p>}
      </>
    )

  const content = (
    <>
      {body}
      {hint != null && <p className="state-panel-hint">{hint}</p>}
      {action}
    </>
  )

  if (surface === 'inline') {
    return (
      <Tag className={classes} role={role} {...props}>
        {content}
      </Tag>
    )
  }

  // `lg` is the surface padding DDR-0031 reserved for full-width state panels, and the only size
  // any of the superseded panels used.
  return (
    <Card as={Tag} size="lg" className={classes} role={role} {...props}>
      {content}
    </Card>
  )
}
