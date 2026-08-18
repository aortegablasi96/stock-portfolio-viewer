import { z } from 'zod'
import { metaRepository } from '@repositories/meta/metaRepository'

/**
 * Whether the sidebar is collapsed to its icon rail, remembered across launches (Story #184).
 *
 * It sits beside `windowStateService` and is deliberately built the same way (DDR-0028). The
 * shell is frameless, so with no OS chrome the app owns its own — and "how wide the navigation
 * column was left" is the same class of fact as "where the window was left": lightweight
 * application metadata, not history. So it is a single JSON value in the existing `app_meta`
 * key/value table rather than a table of its own, reached only through `metaRepository`
 * (ADR-0003), and this module stays free of `electron` like every other service.
 *
 * A collapse that is not remembered is not a feature — the owner would re-collapse it on every
 * launch — which is why this exists at all rather than the renderer holding a `useState`.
 */

/** Key under which the JSON blob is stored in `app_meta`. */
const SIDEBAR_STATE_KEY = 'sidebar_state'

/**
 * First launch opens **expanded**.
 *
 * The rail is the compact form of something the reader already knows; the labelled column is how
 * they learn what the five icons mean. A fresh install that opened on the rail would ask someone
 * to recognise glyphs they have never seen beside a label.
 */
export const SIDEBAR_DEFAULT_COLLAPSED = false

/** What is persisted. An object rather than a bare boolean, so a second rail fact needs no key. */
export interface SidebarState {
  collapsed: boolean
}

/**
 * Stored state is parsed, never trusted — the same rule `windowStateService` follows, and for the
 * same two reasons: the value is a hand-editable row in a local database, and it can predate a
 * change to this shape. Anything that fails to parse is treated as absent, so a corrupt value
 * costs the owner a preference rather than their launch.
 */
const storedSidebarStateSchema = z.object({
  collapsed: z.boolean(),
})

export const sidebarStateService = {
  /** The state to open with; the default when nothing usable is stored. */
  get(): SidebarState {
    return readStoredState() ?? { collapsed: SIDEBAR_DEFAULT_COLLAPSED }
  },

  /** Remember the current state. Overwritten in place — this is metadata, not history. */
  set(state: SidebarState): void {
    metaRepository.set(SIDEBAR_STATE_KEY, JSON.stringify({ collapsed: state.collapsed }))
  },
}

function readStoredState(): SidebarState | undefined {
  const raw = metaRepository.get(SIDEBAR_STATE_KEY)
  if (!raw) return undefined

  try {
    const parsed = storedSidebarStateSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : undefined
  } catch {
    // Not JSON at all.
    return undefined
  }
}
