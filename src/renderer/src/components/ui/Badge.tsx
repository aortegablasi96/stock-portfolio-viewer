import type { HTMLAttributes } from 'react'
import {
  badgeClassName,
  DEFAULT_BADGE_SIZE,
  DEFAULT_BADGE_VARIANT,
  type BadgeSize,
  type BadgeVariant,
} from '../../lib/badgeVariants'

/**
 * The app's one small label (Story #132, DDR-0037), replacing the four rules the Epic #125
 * audit found rendering the same idea — a piece of secondary text set off from its
 * surroundings: `.native-chip` (a holding's native amount beside its converted value),
 * `.flex-import-badge` / `-new` (an import row's status), `.card-count` (the "N of M shown"
 * row count) and `.flex-import-dup` (the "+3 dup" qualifier). Each was written for its own
 * view, and they disagreed on size, radius and colour with no rule underneath.
 *
 * Adding one means naming what sets it off and where it sits, not writing CSS: `variant` is the
 * boundary and the ink, `size` is the inline chip versus the standalone label.
 *
 * A badge is deliberately **never a pill**. Story #131 spent that corner on a meaning — a
 * multi-select toggle item, "any number of these can be pressed" (DDR-0036) — so a static label
 * wearing it would read as a control the owner can click. `.flex-import-badge`'s 999px radius
 * is the one visual correction this story makes.
 *
 * A badge is a `<span>` and carries no interaction of its own: nothing here is focusable, which
 * is why no focus rule appears in the stylesheet section either. Callers pass through whatever
 * the element needs — `title` on the unconverted chip, `role="status"` on the row count so a
 * changed filter is still announced.
 */
export function Badge({
  variant = DEFAULT_BADGE_VARIANT,
  size = DEFAULT_BADGE_SIZE,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant
  size?: BadgeSize
}): React.JSX.Element {
  return <span className={badgeClassName(variant, size, className)} {...props} />
}
