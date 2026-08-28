import { useCallback, useEffect, useState } from 'react'
import {
  consentLine,
  disclosureRows,
  gateKind,
  granularitySummary,
  GATE_ACTIONS,
  GATE_BODIES,
  GATE_HEADINGS,
} from '../lib/assistantGate'
import { formatDate } from '../lib/format'
import { OWNER_SOURCE } from '../lib/pageHeader'
import {
  DISCLOSURE_DESTINATION,
  GRANULARITY_LABELS,
} from '@shared/domain/assistantDisclosure'
import type { AssistantStatus } from '@shared/domain/assistant'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card'
import { ConfirmAction } from './ConfirmAction'
import { PageHeader } from './ui/PageHeader'
import { StatePanel } from './ui/StatePanel'

/**
 * The Assistant view, which in this story is **only its front door** (Story #283, DDR-0097).
 *
 * The consent gate needs a room to stand in, and the room is the Assistant's. Building a
 * temporary home on another page and moving it when #284 lands would be churn; this is the view
 * that story fills in, opened one story early with exactly the part that must exist before
 * anything can be asked. There is no question box here, and no channel behind one — the app
 * cannot reach OpenAI at all until #284 adds one.
 *
 * What it draws is the disclosure and the decision. Three rules shape it:
 *
 * **The list is rendered from `DISCLOSURE_CATEGORIES`, never written out here.** That constant is
 * also the only set of keys a context may carry and the input to the fingerprint consent is stored
 * against, so what the owner reads, what may be sent, and what their agreement covers are one
 * thing rather than three that can drift apart.
 *
 * **The wording is not softened.** The heading says this is the one feature that sends data off
 * the machine; the destination is named; no benefit is offered in the same breath. The benefit is
 * why the owner came, and the cost is what this panel is for.
 *
 * **Withdrawing is the in-place `ConfirmAction`** — no modal, no `window.confirm` (DDR-0012) —
 * although withdrawing is the *safe* direction, so the confirm is there to stop a slip rather than
 * to warn of loss.
 */
export function AssistantView(): React.JSX.Element {
  const [status, setStatus] = useState<AssistantStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void window.api.getAssistantStatus().then((next) => {
      if (live) setStatus(next)
    })
    return () => {
      live = false
    }
  }, [])

  const setConsent = useCallback(async (granted: boolean): Promise<void> => {
    setBusy(true)
    try {
      setStatus(await window.api.setAssistantConsent({ granted }))
    } finally {
      setBusy(false)
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

  const kind = gateKind(status)
  const action = GATE_ACTIONS[kind]
  const granted = consentLine(status, formatDate)

  return (
    <main className="dashboard">
      <PageHeader title="Assistant" source={OWNER_SOURCE} />

      <div className="analytics-view">
        {/* One surface for all four states. A decision is not a louder card — the heading and the
            badge carry which state is in force, and inventing a variant to emphasise it would be
            a new axis on the primitive for one call site (DDR-0033). */}
        <Card>
          <CardHeader>
            <CardTitle>{GATE_HEADINGS[kind]}</CardTitle>
            {/* Neither a decision nor a missing key is a failure, so neither is toned as one. The
                badge states which fact is in force, and `neutral` is the absence of a tone
                (DDR-0037). */}
            <Badge variant={kind === 'ready' ? 'positive' : 'neutral'}>
              {kind === 'ready' ? 'Allowed' : 'Not sending'}
            </Badge>
          </CardHeader>
          <CardContent>
            <p className="assistant-lede">{GATE_BODIES[kind]}</p>
            {granted && <p className="assistant-note">{granted}</p>}
            <div className="assistant-actions">
              {action && (
                <Button variant="primary" disabled={busy} onClick={() => void setConsent(true)}>
                  {busy ? 'Saving…' : action}
                </Button>
              )}
              {status.consented && (
                <ConfirmAction
                  label="Withdraw permission"
                  confirmLabel="Yes, withdraw it"
                  busyLabel="Withdrawing…"
                  warning="The assistant stops sending anything immediately. Nothing else in the app changes, and you can allow it again later."
                  onConfirm={() => setConsent(false)}
                />
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What would be sent</CardTitle>
            {/* Built from the granularities actually present, so removing the last category that
                sends amounts changes this line by itself rather than leaving prose behind. */}
            <p className="assistant-note">{granularitySummary()}</p>
          </CardHeader>
          <CardContent>
            {/* Rendered from the declaration, never written out — this list, what may be sent, and
                what consent was recorded against are one thing. */}
            <ul className="assistant-disclosure">
              {disclosureRows().map((category) => (
                <li key={category.id} className="assistant-disclosure-row">
                  <div className="assistant-disclosure-head">
                    <span className="assistant-disclosure-title">{category.title}</span>
                    <Badge variant="neutral" size="sm">
                      {GRANULARITY_LABELS[category.granularity]}
                    </Badge>
                  </div>
                  <p className="assistant-disclosure-detail">{category.detail}</p>
                </li>
              ))}
            </ul>
            <p className="assistant-destination">
              <strong>Where it goes:</strong> {DISCLOSURE_DESTINATION}
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
