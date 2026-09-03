import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ASSISTANT_EYEBROW,
  PROFILE_COLLAPSED_CLASS,
  PROFILE_COLUMN_CLASS,
  PROFILE_COLUMN_WIDTH_PX,
  PROFILE_RAIL_WIDTH_PX,
  PROFILE_TOGGLE_LABELS,
  PROFILE_WIDTH_TOKENS,
  isProfileStated,
  profileColumnClassName,
  profileDotTitle,
  profileToggleLabel,
} from './assistantLayout'
import { scanDeclarations } from './cssDeclarations'
import { EXEMPTIONS, findViolations } from './motionTokens'

/**
 * The Assistant's two-column shell (Story #343, DDR-0115).
 *
 * Two halves, as `sidebarCollapse.test.ts` has: the module's own decisions, and the stylesheet
 * they only mean anything against. A width named here and written differently in `app.css` is a
 * constant that describes nothing, and that is precisely the failure a Node-only suite can catch
 * while a browser test is measuring the number the stylesheet actually shipped (DDR-0029).
 */

const CSS = readFileSync(new URL('../app.css', import.meta.url), 'utf8')

const strip = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** Comments stripped first — the trap DDR-0042, DDR-0047 and DDR-0075 each record. */
const BARE_CSS = strip(CSS)

const source = (path: string): string =>
  strip(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'))

/** One rule's body, by its class — comments already stripped. */
const rule = (name: string): string => {
  const start = BARE_CSS.indexOf(`\n.${name} {`)
  expect(start, `.${name} declares no rule`).toBeGreaterThan(0)
  return BARE_CSS.slice(start, BARE_CSS.indexOf('}', start))
}

const VIEW = source('components/AssistantView.tsx')
const CONVERSATION = source('components/AssistantConversation.tsx')
const SECTION = source('components/ProfileSection.tsx')

describe('the two widths', () => {
  it('are the design’s own measurements, not scale steps', () => {
    expect(PROFILE_COLUMN_WIDTH_PX).toBe(420)
    expect(PROFILE_RAIL_WIDTH_PX).toBe(48)
  })

  /**
   * The stylesheet's half. A named layout constant is only a constant if one number reaches both
   * the module and the rule, which is what `--donut-column-width` and `GRID_CONTENT_BREAKPOINT_PX`
   * already do (DDR-0063, DDR-0115 amendment 8).
   */
  it.each([
    [PROFILE_WIDTH_TOKENS.expanded, PROFILE_COLUMN_WIDTH_PX],
    [PROFILE_WIDTH_TOKENS.collapsed, PROFILE_RAIL_WIDTH_PX],
  ])('declares %s in :root at the module’s own value', (token, px) => {
    expect(BARE_CSS).toMatch(new RegExp(`^\\s*${token}:\\s*${px}px;`, 'm'))
  })

  /**
   * DDR-0115 amendment 2: two collapsing edges, two widths, and they may not be unified. 48 holds
   * a 32px expander; 56 holds a 32px brand tile plus the focus ring's room (DDR-0057). A shared
   * token would make either impossible to tune without moving the other and the Performance
   * breakpoints behind it (DDR-0068).
   */
  it('keeps the profile rail and the nav rail as two separate tokens', () => {
    expect(PROFILE_RAIL_WIDTH_PX).not.toBe(56)
    expect(BARE_CSS).toContain('--sidebar-width-collapsed: 56px;')
    // Each of the column's two rules reaches its own token and never the sidebar's.
    for (const name of [PROFILE_COLUMN_CLASS, PROFILE_COLLAPSED_CLASS]) {
      expect(rule(name), name).not.toContain('--sidebar-width')
    }
  })

  /** Neither width is a `--space-*` step, which is the reason each needed a name of its own. */
  it('lands on no spacing step', () => {
    const steps = [...BARE_CSS.matchAll(/--space-\d+:\s*([\d.]+)rem;/g)].map(
      (m) => Number(m[1]) * 16,
    )
    expect(steps.length).toBeGreaterThan(0)
    expect(steps).not.toContain(PROFILE_COLUMN_WIDTH_PX)
    expect(steps).not.toContain(PROFILE_RAIL_WIDTH_PX)
  })
})

describe('the collapse flag', () => {
  it('is one class on the column, in both states', () => {
    expect(profileColumnClassName(false)).toBe(PROFILE_COLUMN_CLASS)
    expect(profileColumnClassName(true)).toBe(
      `${PROFILE_COLUMN_CLASS} ${PROFILE_COLLAPSED_CLASS}`,
    )
  })

  /** Both classes are rules, or the flag switches nothing and the column never narrows. */
  it.each([PROFILE_COLUMN_CLASS, PROFILE_COLLAPSED_CLASS])('backs .%s with a rule', (name) => {
    expect(BARE_CSS).toContain(`\n.${name} {`)
  })

  /**
   * The collapsed rule has to *win*, and it does so on source order at equal specificity — the
   * same mechanism DDR-0044's reduced-motion block relies on, and the same one that would break
   * in silence if the two rules were reordered.
   */
  it('declares the collapsed width after the expanded one', () => {
    expect(BARE_CSS.indexOf(`\n.${PROFILE_COLLAPSED_CLASS} {`)).toBeGreaterThan(
      BARE_CSS.indexOf(`\n.${PROFILE_COLUMN_CLASS} {`),
    )
  })
})

describe('the controls the rail carries', () => {
  it('names the action rather than the state, in both directions', () => {
    expect(profileToggleLabel(false)).toBe(PROFILE_TOGGLE_LABELS.collapse)
    expect(profileToggleLabel(true)).toBe(PROFILE_TOGGLE_LABELS.expand)
    // Story #343 pins the expanding half's wording exactly.
    expect(PROFILE_TOGGLE_LABELS.expand).toBe('Expand investor profile')
  })

  /**
   * The dot is colour and a glow, and `--pos` may never be a mark's only channel (DDR-0021). The
   * count is what makes it readable, and it travels in both states rather than only the stated
   * one — "Profile: 0 style tags" is a fact, not an empty tooltip.
   */
  it('carries the count in the dot’s title, singular at one', () => {
    expect(profileDotTitle(0)).toBe('Profile: 0 style tags')
    expect(profileDotTitle(1)).toBe('Profile: 1 style tag')
    expect(profileDotTitle(3)).toBe('Profile: 3 style tags')
  })

  it('reads a stated profile off the style tags alone', () => {
    expect(isProfileStated(0)).toBe(false)
    expect(isProfileStated(1)).toBe(true)
  })
})

/**
 * The view's own composition — a text guard, for the reason every renderer guard in this
 * directory is one: no component may be rendered under Node (DDR-0029).
 */
describe('the view is a frame, not a page', () => {
  /**
   * DDR-0115 amendment 1. `PageHeader` is gone from this view and `OWNER_SOURCE` with it — a
   * constant nothing renders is the third failure mode `tokenAdoption.ts` exists to prevent
   * elsewhere, and the same principle reaches a dead export.
   */
  it('draws no page header, and OWNER_SOURCE is deleted rather than orphaned', () => {
    expect(VIEW).not.toContain('<PageHeader')
    expect(VIEW).not.toContain('OWNER_SOURCE')
    expect(source('lib/pageHeader.ts')).not.toContain('OWNER_SOURCE')
    expect(source('lib/pageHeader.ts')).not.toContain('Set by you')
  })

  /** The eyebrow is the panel's `<h1>`, so the document outline survives the header's removal. */
  it('makes the eyebrow the view’s h1', () => {
    expect(VIEW).toMatch(/<h1[^>]*>\{ASSISTANT_EYEBROW\}<\/h1>/)
    expect(ASSISTANT_EYEBROW).toBe('AI Assistant')
  })

  /**
   * Collapsed, the column has no room to draw the eyebrow — but an `<h1>` that leaves the tree is
   * a panel with no heading in one of its two states. `.sr-only` is the app's existing clip, and
   * reusing it is what keeps this from becoming a second visually-hidden idiom.
   */
  it('clips the h1 rather than removing it when the column collapses', () => {
    expect(VIEW).toContain('className="assistant-eyebrow sr-only"')
    expect(BARE_CSS).toContain('\n.sr-only {')
  })

  /** Two columns, and the profile is the first of them — the design's own order. */
  it('renders the profile column before the chat column', () => {
    expect(VIEW).toContain('profileColumnClassName(profileCollapsed)')
    expect(VIEW.indexOf('<ProfileSection')).toBeLessThan(VIEW.indexOf('<AssistantConversation'))
  })

  /**
   * DDR-0108, restated because two columns are the shape most likely to tempt a hoist: the
   * counter lives here because this component is the common ancestor of the profile that writes
   * it and the conversation that reads it. A module-level store is what Story #310 removed.
   */
  it('keeps profileVersion in the view and hands it down as a prop', () => {
    expect(VIEW).toContain('const [profileVersion, setProfileVersion] = useState(0)')
    expect(VIEW).toContain('profileVersion={profileVersion}')
    expect(VIEW).toMatch(/<ProfileSection\s+onWritten=\{onProfileWritten\}/)
    expect(CONVERSATION).not.toContain('profileDataVersion')
  })

  /**
   * The collapse is the column's own state, and it survives a tab switch for the reason every
   * other bit of view-local state does — the view stays mounted (DDR-0027). Component state, not
   * a store, and nothing writes it to `app_meta`: unlike the nav rail, this is not a preference
   * the app remembers between launches.
   */
  it('holds the collapse as component state, with no store and no persistence', () => {
    expect(VIEW).toContain('const [profileCollapsed, setProfileCollapsed] = useState(false)')
    expect(VIEW).not.toContain('window.api.setSidebarCollapsed')
    expect(VIEW).not.toContain('useSyncExternalStore')
  })
})

describe('the chat column is three bands', () => {
  /** The column itself is the view's; the three bands inside it are the conversation's. */
  it('draws the column, and backs it with a rule', () => {
    expect(VIEW).toContain('className="assistant-chat"')
    expect(BARE_CSS).toContain('\n.assistant-chat {')
  })

  it.each(['assistant-chat-head', 'assistant-transcript', 'assistant-composer'])(
    'draws .%s and backs it with a rule',
    (name) => {
      expect(CONVERSATION).toContain(`className="${name}"`)
      expect(BARE_CSS).toContain(`\n.${name} {`)
    },
  )

  /**
   * The order is the design's: the header, the transcript, then the composer at the bottom. It is
   * also what #345 depends on this story for — a composer pinned below a scrolling transcript is
   * a *position*, and it has to exist before Enter can send from it.
   */
  it('puts the composer below the transcript', () => {
    expect(CONVERSATION.indexOf('className="assistant-chat-head"')).toBeLessThan(
      CONVERSATION.indexOf('className="assistant-transcript"'),
    )
    expect(CONVERSATION.indexOf('className="assistant-transcript"')).toBeLessThan(
      CONVERSATION.indexOf('className="assistant-composer"'),
    )
  })

  /**
   * The middle band is the only one that scrolls, and the outer two do not shrink to make room —
   * `flex-shrink: 0` is what keeps a long transcript from squeezing the composer out of the
   * window rather than scrolling under it.
   */
  it('scrolls the transcript alone', () => {
    expect(rule('assistant-transcript')).toContain('overflow-y: auto')
    expect(rule('assistant-chat-head')).toContain('flex-shrink: 0')
    expect(rule('assistant-composer')).toContain('flex-shrink: 0')
    expect(rule('assistant-chat')).toContain('overflow: hidden')
  })

  /**
   * The live region did not move (DDR-0115 decision 9). It is still the transcript list itself,
   * still present from mount, and still `aria-atomic="false"` so a new turn and its answer are
   * two announcements rather than a re-reading (DDR-0107).
   */
  it('leaves the aria-live region on the turns list', () => {
    expect(CONVERSATION).toMatch(
      /<ol className="assistant-turns" aria-live="polite" aria-atomic="false">/,
    )
  })
})

describe('the profile is a column, not a disclosure', () => {
  /**
   * The outer `group` `Collapsible` is gone: the column that folds *is* the disclosure now, and
   * two nested ones would be a fold inside a fold. Its five `section` ones are untouched, and
   * `ProfileTargets` draws the fifth (DDR-0106, DDR-0108).
   */
  it('drops the group Collapsible and keeps the section ones', () => {
    expect(SECTION).not.toContain('level="group"')
    expect(SECTION).not.toContain('defaultOpen')
    expect([...SECTION.matchAll(/<Collapsible\b/g)]).toHaveLength(3)
    expect([...source('components/ProfileTargets.tsx').matchAll(/<Collapsible\b/g)]).toHaveLength(1)
  })

  /** The heading the group's trigger used to carry is now the column's own, at the same level. */
  it('states the column’s name as an h2', () => {
    expect(SECTION).toMatch(/<h2 className="profile-column-title">Investor Profile<\/h2>/)
  })

  /**
   * `hidden` and never unmounted (DDR-0027) — and the rule that makes `hidden` mean anything.
   *
   * The block declares `display: flex`, which out-specifies the UA's `[hidden]` rule, so without
   * the override the fold leaves the whole form laid out behind a 48px column: still announced,
   * still in the tab order, drawn over the rail's two controls. It is the trap
   * `.collapsible-panel[hidden]` already records (DDR-0106), and it shipped once here before
   * `e2e/assistant-layout.spec.ts` caught it.
   */
  it('hides the folded column rather than unmounting it, and backs the attribute with a rule', () => {
    expect(SECTION).toMatch(/<div className="profile-column-body" hidden=\{hidden\}>/)
    expect(rule('profile-column-body')).toContain('display: flex')
    expect(BARE_CSS).toContain('\n.profile-column-body[hidden] {\n  display: none;\n}')
  })
})

/**
 * The motion budget's documented exit (DDR-0044, DDR-0115 amendment 4).
 *
 * The design's `0.22s cubic-bezier(0.4,0,0.2,1)` is neither of the scale's two durations and
 * neither of its two easings, so it takes the one way out the record allows: a raw value declared
 * at the call site with its reason, listed in `motionTokens.EXEMPTIONS`. Being raw puts it
 * *outside* the mechanism that zeroes the tokens, so it needs an explicit reduced-motion rule of
 * its own — which is the half that would otherwise ship a column that keeps sliding for a reader
 * who asked it not to.
 */
describe('the width transition and its reduced-motion rule', () => {
  const exempt = EXEMPTIONS.filter((entry) => entry.key.startsWith(`.${PROFILE_COLUMN_CLASS} `))

  it('is exempted by name and value, with a reason', () => {
    expect(exempt).toHaveLength(1)
    expect(exempt[0]!.value).toContain('0.22s')
    expect(exempt[0]!.reason.length).toBeGreaterThan(40)
  })

  it('leaves the stylesheet with no unexempted raw motion', () => {
    expect(findViolations(CSS).map((d) => `${d.key} — ${d.value}`)).toEqual([])
  })

  /**
   * The block still sits directly under `:root` and still zeroes the tokens rather than listing
   * what moves — the explicit rule *joins* it there rather than travelling with the component,
   * which is what keeps one reduced-motion rule in the file (DDR-0115 amendment 4).
   */
  it('zeroes the column’s own transition inside the one reduced-motion block', () => {
    // Doubled, which is what makes it win: the rule it overrides is declared thousands of lines
    // below at the same specificity, and source order would otherwise decide it (DDR-0059).
    const inside = scanDeclarations(CSS).filter(
      (d) =>
        d.context ===
        `@media (prefers-reduced-motion: reduce) >> .${PROFILE_COLUMN_CLASS}.${PROFILE_COLUMN_CLASS}`,
    )
    expect(inside.map((d) => `${d.property}: ${d.value}`)).toEqual(['transition-duration: 0s'])
  })
})
