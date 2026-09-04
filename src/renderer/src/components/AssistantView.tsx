import { useCallback, useEffect, useState } from 'react'
import {
  ASSISTANT_EYEBROW,
  isProfileStated,
  profileColumnClassName,
  profileDotTitle,
  profileToggleLabel,
} from '../lib/assistantLayout'
import type { AssistantStatus } from '@shared/domain/assistant'
import type { InvestorProfile } from '@shared/domain/investorProfileTerms'
import { AssistantConversation } from './AssistantConversation'
import { AssistantKeyCard } from './AssistantKeyCard'
import { ProfileSection } from './ProfileSection'
import { Button } from './ui/Button'
import { StatePanel } from './ui/StatePanel'

/**
 * The Assistant view: **the standard the owner set, and the conversation about it** (Story #310,
 * DDR-0108; Story #309, ADR-0011, DDR-0107), **laid out as two columns** (Story #343, DDR-0115).
 *
 * M10 stacked three cards above the question box — the consent gate, the key card, and the "What
 * would be sent" disclosure — so that asking a question was the fourth thing on the page. #309
 * removed the gate as a concept and stopped the disclosure being rendered: for a single-user app
 * whose owner wrote it, installed it and pasted the key, supplying the key *is* the decision to
 * send, and asking the same person the same question a second time protects them from themselves.
 *
 * **#310 puts the profile back on top of it, and takes a sidebar row away.** The two were the same
 * page twice — neither an `AnalyticsShell` view, both declaring their own `<main>` and `<h1>`,
 * both naming the owner as their source, which is the one provenance value that names no data
 * source at all (DDR-0094, DDR-0098). They were adjacent rows six and seven so the list read
 * *data, then the surface that talks about it, then the policy over it*; merging them is the
 * conclusion of that argument rather than a departure from it. The sidebar now has **six** rows
 * and this is the last of them.
 *
 * **#343 stops it being a page and makes it a frame** (DDR-0115). The two halves were stacked in a
 * scrolling `.dashboard`, so reading an answer scrolled the standard it was judged against off the
 * top. They are columns now: the profile at 420px on the left, foldable to a 48px rail, and the
 * conversation filling the rest. Neither scrolls the page — each scrolls itself — and the widths
 * are in `lib/assistantLayout.ts` because Vitest is Node-only and a number inside a component is
 * a number nothing can assert (DDR-0029).
 *
 * **There is no `PageHeader` here** (DDR-0115 amendment 1). The design has none, and `OWNER_SOURCE`
 * — `'Set by you'`, whose only call site this was — is deleted rather than left as a constant
 * nothing renders. What replaces it says more than the slot could: the eyebrow below is this
 * view's `<h1>`, the column names itself, and the profile's own intro paragraph states in full
 * sentences that the standard is the owner's. DDR-0094's rule still holds for the five views that
 * do have a data source to name.
 *
 * **`DISCLOSURE_CATEGORIES` did not go with the list it drew** (DDR-0098). It still types
 * `AssistantContext`, so a section nobody declared cannot be assembled, and `assistantAskRequest`
 * still drops an undeclared one at the boundary. Only the *reading* of it is gone, which is the
 * transparency ADR-0011 records as the cost.
 *
 * **This component is where the two halves meet, and therefore where the profile's version lives**
 * (DDR-0108). `profileDataVersion` was a module-level store because the writer and the reader were
 * two views with no common ancestor short of the shell; they now have one, and it is this. Two
 * columns are still two children of one component, so nothing about that moved with the layout —
 * and a refactor tempted to hoist the counter would be restoring the global #310 removed.
 *
 * Three pieces of state, and it is worth reading why none of them is stored. `profileVersion` says
 * the standard changed under a conversation that read it once. `profileCollapsed` is the column's
 * own fold, component state for the same reason every other bit of view-local state is: the view
 * stays mounted, so it survives a trip to Allocation and back with no store and nothing written to
 * `app_meta` (DDR-0027). It is deliberately *not* the nav rail's kind of preference, which does
 * persist (DDR-0057) — this one is a gesture inside a session, not a setting. And `styleTags` is
 * what the rail's dot reports, reported up by the section that reads it rather than read a second
 * time here: two reads of one `app_meta` value are two answers waiting to disagree.
 */
export function AssistantView({ displayCurrency }: { displayCurrency: string }): React.JSX.Element {
  const [status, setStatus] = useState<AssistantStatus | null>(null)
  /**
   * How many times the profile has been written since this view mounted.
   *
   * It is a *dependency*, never a value that is read: what it means is that the standard an answer
   * would be judged against has changed underneath a conversation that read it once, which is the
   * same thing `flexDataVersion` means about the figures (DDR-0027, DDR-0098).
   */
  const [profileVersion, setProfileVersion] = useState(0)
  const [profileCollapsed, setProfileCollapsed] = useState(false)
  /** What the stored profile currently says, for the rail's dot alone. */
  const [styleTags, setStyleTags] = useState(0)

  const onProfileWritten = useCallback((): void => {
    setProfileVersion((version) => version + 1)
  }, [])

  const onProfileStored = useCallback((profile: InvestorProfile): void => {
    setStyleTags(profile.styleTags.length)
  }, [])

  useEffect(() => {
    let live = true
    void window.api.getAssistantStatus().then((next) => {
      if (live) setStatus(next)
    })
    return () => {
      live = false
    }
  }, [])

  const toggleLabel = profileToggleLabel(profileCollapsed)

  return (
    <main className="assistant-view">
      <div className={profileColumnClassName(profileCollapsed)} id="assistant-profile-column">
        {/* The `<h1>` is in both branches, because it is this panel's only heading and one that
            leaves the tree in a state is a document outline with a hole in it. Collapsed it takes
            `.sr-only` — the app's existing clip, reused rather than copied — and the control it
            shared a row with moves into the rail beside the completeness dot. */}
        {profileCollapsed ? (
          <div className="assistant-rail-strip">
            <h1 className="assistant-eyebrow sr-only">{ASSISTANT_EYEBROW}</h1>
            <ProfileToggle
              collapsed
              label={toggleLabel}
              onToggle={() => setProfileCollapsed(false)}
            />
            {/* Colour and a glow, so the count is what makes its state readable and it is stated
                in both states rather than only the stated one (DDR-0021). `aria-hidden` on the
                mark: the `title` is what a pointer meets, and the head two clicks away says the
                same thing in words. */}
            <span
              className={`assistant-profile-dot ${isProfileStated(styleTags) ? 'assistant-profile-dot-stated' : ''}`}
              title={profileDotTitle(styleTags)}
              aria-hidden="true"
            />
          </div>
        ) : (
          <div className="assistant-column-head">
            <h1 className="assistant-eyebrow">{ASSISTANT_EYEBROW}</h1>
            <ProfileToggle
              collapsed={false}
              label={toggleLabel}
              onToggle={() => setProfileCollapsed(true)}
            />
          </div>
        )}

        {/* The standard. It reads and writes `app_meta` alone and waits on no status, so it is
            drawn while the assistant's own is still in flight.

            `hidden` rather than unmounted, which is the app's rule one level down from the tab
            shell (DDR-0027): a half-finished profile survives the column being folded away, and
            the form's controls leave the tab order while it is — a 48px rail must not be four
            invisible Tab stops. */}
        <ProfileSection
          onWritten={onProfileWritten}
          onStored={onProfileStored}
          hidden={profileCollapsed}
        />
      </div>

      <div className="assistant-chat">
        {status === null ? (
          <div className="assistant-chat-block">
            <StatePanel variant="loading">Loading…</StatePanel>
          </div>
        ) : (
          <>
            {/* Shown when there is no working key, and not shown once there is one — no activate,
                no deactivate, no rotate (ADR-0011). It re-seats this view on the status that
                actually landed, which is what lets a key typed here reach the assistant with no
                restart. It draws nothing at all once a key is in force, and the wrapper goes with
                it: an empty band would rule off a strip of padding above the chat header. */}
            <AssistantKeyCard status={status} onStatus={setStatus} />

            {/* The question. It draws its own blocker where there is no key rather than being
                hidden: a box that is not there says nothing about why.

                The column's fold goes down as a **prop**, not as a second source of truth (Story
                #346): the design's *Edit profile* chip is the second of the two collapsing
                affordances (DDR-0115 amendment 2), drawn in the chat header while the column is
                shut, and the state it reports is the same `profileCollapsed` the rail is drawn
                from. A conversation that kept its own copy would be a fold that two components
                could disagree about. */}
            <AssistantConversation
              status={status}
              displayCurrency={displayCurrency}
              profileVersion={profileVersion}
              profileCollapsed={profileCollapsed}
              onExpandProfile={() => setProfileCollapsed(false)}
            />
          </>
        )}
      </div>
    </main>
  )
}

/**
 * The control that folds the column, drawn twice and never at once — in the head while the column
 * is open, in the rail while it is shut.
 *
 * Two call sites rather than one moved element, because the two are in different boxes and the
 * design draws them at different sizes; what they share is the wording, which is
 * `profileToggleLabel`'s. It carries **no focus rule of its own**: the zero-specificity
 * `:where(...)` base at the top of `app.css` rings it, which is the mechanism that makes a control
 * shipped without a ring impossible rather than merely unlikely (DDR-0026).
 *
 * **`ghost`, not a bordered square, and that is the one place this control departs from the
 * design.** The design draws both halves as a transparent box with a `1px solid var(--border)`
 * edge. This app has a `Button` primitive whose `variant` axis owns that decision (DDR-0032,
 * where `className` is placement and never colour), and the app's *other* collapsing edge — the
 * nav rail's toggle, the same control doing the same job one column over — is `ghost`. Two
 * collapsing edges that look different from each other would be a worse reading of the design
 * than two that match: what is adopted is the 32px icon button in the rail, not its border, which
 * is ADR-0008's rule about taking the shape and not the stylesheet (DDR-0115).
 */
function ProfileToggle({
  collapsed,
  label,
  onToggle,
}: {
  collapsed: boolean
  label: string
  onToggle: () => void
}): React.JSX.Element {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-expanded={!collapsed}
      aria-controls="assistant-profile-column"
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      <svg
        className="assistant-toggle-glyph"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={collapsed ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'} />
      </svg>
    </Button>
  )
}
