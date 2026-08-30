import { useEffect, useState } from 'react'
import { OWNER_SOURCE } from '../lib/pageHeader'
import type { AssistantStatus } from '@shared/domain/assistant'
import { AssistantConversation } from './AssistantConversation'
import { AssistantKeyCard } from './AssistantKeyCard'
import { PageHeader } from './ui/PageHeader'
import { StatePanel } from './ui/StatePanel'

/**
 * The Assistant view: **the chat, and nothing in front of it** (Story #309, ADR-0011, DDR-0107).
 *
 * M10 stacked three cards above the question box — the consent gate, the key card, and the "What
 * would be sent" disclosure — so that asking a question was the fourth thing on the page. ADR-0011
 * removes the gate as a concept and stops the disclosure being rendered: for a single-user app
 * whose owner wrote it, installed it and pasted the key, supplying the key *is* the decision to
 * send, and asking the same person the same question a second time protects them from themselves.
 * What is left is a conversation, with one field above it on the one run where there is no key.
 *
 * **`DISCLOSURE_CATEGORIES` did not go with the list it drew** (DDR-0098). It still types
 * `AssistantContext`, so a section nobody declared cannot be assembled, and `assistantAskRequest`
 * still drops an undeclared one at the boundary. Only the *reading* of it is gone, which is the
 * transparency ADR-0011 records as the cost.
 *
 * **It is not an `AnalyticsShell` view, and that is a stated decision rather than drift**
 * (DDR-0098). The shell owns a four-branch guard, a `<main>` and a page header, and holds no
 * state — which is exactly what keeps DDR-0027 intact for the four analytics views (DDR-0043,
 * DDR-0058). This page holds a conversation and reads a status of its own, so it brings its own
 * `<main>` and `PageHeader` — the shape `ProfileView` already uses, and the reason its `source` is
 * `OWNER_SOURCE`: a page whose standard is the owner's names no data source (DDR-0094).
 *
 * The order left on the page is what is left of the order of the decisions: the key, on the run
 * where there is not one, and then the asking. `AssistantKeyCard` draws nothing at all once a key
 * is in force, so on every subsequent run this view is one card.
 */
export function AssistantView({ displayCurrency }: { displayCurrency: string }): React.JSX.Element {
  const [status, setStatus] = useState<AssistantStatus | null>(null)

  useEffect(() => {
    let live = true
    void window.api.getAssistantStatus().then((next) => {
      if (live) setStatus(next)
    })
    return () => {
      live = false
    }
  }, [])

  if (status === null) {
    return (
      <main className="dashboard">
        <PageHeader title="Assistant" source={OWNER_SOURCE} />
        <StatePanel variant="loading">Loading…</StatePanel>
      </main>
    )
  }

  return (
    <main className="dashboard">
      <PageHeader title="Assistant" source={OWNER_SOURCE} />

      <div className="analytics-view">
        {/* Shown when there is no working key, and not shown once there is one — no activate, no
            deactivate, no rotate (ADR-0011). It re-seats this view on the status that actually
            landed, which is what lets a key typed here reach the assistant with no restart. */}
        <AssistantKeyCard status={status} onStatus={setStatus} />

        {/* The question. It draws its own blocker where there is no key rather than being hidden:
            a box that is not there says nothing about why. */}
        <AssistantConversation status={status} displayCurrency={displayCurrency} />
      </div>
    </main>
  )
}
