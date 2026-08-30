import { useCallback, useEffect, useState } from 'react'
import { OWNER_SOURCE } from '../lib/pageHeader'
import type { AssistantStatus } from '@shared/domain/assistant'
import { AssistantConversation } from './AssistantConversation'
import { AssistantKeyCard } from './AssistantKeyCard'
import { ProfileSection } from './ProfileSection'
import { PageHeader } from './ui/PageHeader'
import { StatePanel } from './ui/StatePanel'

/**
 * The Assistant view: **the standard the owner set, and the conversation about it** (Story #310,
 * DDR-0108; Story #309, ADR-0011, DDR-0107).
 *
 * M10 stacked three cards above the question box — the consent gate, the key card, and the "What
 * would be sent" disclosure — so that asking a question was the fourth thing on the page. #309
 * removed the gate as a concept and stopped the disclosure being rendered: for a single-user app
 * whose owner wrote it, installed it and pasted the key, supplying the key *is* the decision to
 * send, and asking the same person the same question a second time protects them from themselves.
 *
 * **#310 puts the profile back on top of it, and takes a sidebar row away.** The two were the same
 * page twice — neither an `AnalyticsShell` view, both declaring their own `<main>` and `<h1>`, both
 * carrying `OWNER_SOURCE`, the one provenance value that names no data source because the standard
 * on the page is the owner's rather than the app's (DDR-0094, DDR-0098). They were adjacent rows
 * six and seven so the list read *data, then the surface that talks about it, then the policy over
 * it*; merging them is the conclusion of that argument rather than a departure from it. The
 * sidebar now has **six** rows and this is the last of them.
 *
 * **`DISCLOSURE_CATEGORIES` did not go with the list it drew** (DDR-0098). It still types
 * `AssistantContext`, so a section nobody declared cannot be assembled, and `assistantAskRequest`
 * still drops an undeclared one at the boundary. Only the *reading* of it is gone, which is the
 * transparency ADR-0011 records as the cost.
 *
 * **It is not an `AnalyticsShell` view, and that is a stated decision rather than drift**
 * (DDR-0098). The shell owns a four-branch guard, a `<main>` and a page header, and holds no
 * state — which is exactly what keeps DDR-0027 intact for the four analytics views (DDR-0043,
 * DDR-0058). This page holds a conversation, a form and a status of its own, so it brings its own
 * `<main>` and `PageHeader`.
 *
 * **This component is where the two halves meet, and therefore where the profile's version now
 * lives** (DDR-0108). `profileDataVersion` was a module-level store because the writer and the
 * reader were two views with no common ancestor short of the shell; they now have one, and it is
 * this. A plain counter here is the same call `App` makes for every fact the sidebar and a view
 * share (DDR-0056), and it removes a global whose only two users are siblings. `flexDataVersion`
 * is untouched — it still crosses views.
 *
 * The order on the page is the order of the decisions that are left: the standard, then the key on
 * the one run where there is not one, then the asking. `AssistantKeyCard` draws nothing at all
 * once a key is in force, and the profile is closed on arrival, so on every subsequent run this
 * view is a one-line head row over a conversation.
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

  const onProfileWritten = useCallback((): void => {
    setProfileVersion((version) => version + 1)
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

  return (
    <main className="dashboard">
      <PageHeader title="Assistant" source={OWNER_SOURCE} />

      <div className="analytics-view">
        {/* The standard, collapsed. It reads and writes `app_meta` alone and waits on no status,
            so it is drawn while the assistant's own is still in flight. */}
        <ProfileSection onWritten={onProfileWritten} />

        {status === null ? (
          <StatePanel variant="loading">Loading…</StatePanel>
        ) : (
          <>
            {/* Shown when there is no working key, and not shown once there is one — no activate,
                no deactivate, no rotate (ADR-0011). It re-seats this view on the status that
                actually landed, which is what lets a key typed here reach the assistant with no
                restart. */}
            <AssistantKeyCard status={status} onStatus={setStatus} />

            {/* The question. It draws its own blocker where there is no key rather than being
                hidden: a box that is not there says nothing about why. */}
            <AssistantConversation
              status={status}
              displayCurrency={displayCurrency}
              profileVersion={profileVersion}
            />
          </>
        )}
      </div>
    </main>
  )
}
