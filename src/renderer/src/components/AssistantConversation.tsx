import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  askGate,
  askLabel,
  answerFromResult,
  groundingNotices,
  isAskable,
  isStale,
  STALE_NOTE,
  TRUNCATED_NOTE,
  type Turn,
} from '../lib/assistantAsk'
import { buildAssistantContext, type GroundingInputs } from '../lib/assistantContext'
import { flexDataVersion, profileDataVersion } from '../lib/dataVersion'
import { controlClassName } from '../lib/fieldVariants'
import type { AssistantStatus } from '@shared/domain/assistant'
import { Button } from './ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card'
import { Field } from './ui/Field'
import { StatePanel } from './ui/StatePanel'

/**
 * The question box and what came back (Story #284, DDR-0098).
 *
 * Below the consent gate rather than instead of it: the gate is the front door #283 opened, and
 * this is the room behind it. Nothing here can fire while the gate is closed — `askGate` reads the
 * same status the panel above draws, and `assistantService` checks consent again in main before a
 * key is read (DDR-0097). Two checks for one fact, because one of them is in the renderer.
 *
 * **The component holds state and does no reasoning.** Which gate applies, what the assistant
 * cannot see, what a result becomes on screen and what a screen reader is told are all in
 * `lib/assistantAsk`; the context is in `lib/assistantContext`. That split is not tidiness — Vitest
 * runs Node-only with no jsdom (DDR-0029), so what is left in here is exactly what no test can
 * reach, and it is kept to reads, writes and wiring for that reason.
 *
 * Three behaviours are worth reading before changing anything:
 *
 * **Grounding is re-read when either version store moves** (DDR-0027). The view stays mounted, so
 * a transcript outlives the import that invalidates it. The answers are not withdrawn — each was
 * true when given — but each records the Flex version it was grounded at, and one the store has
 * moved past says so beside itself. The profile store is watched for a different reason: it
 * changes what may be *asked* rather than what an answer said, because a profile can be the only
 * thing there is to ground on.
 *
 * **It is read again at the moment of asking**, and that read is what the question actually goes
 * with. The mounted reading drives the gate and the notices; it can be minutes old by the time a
 * question is typed, and the drift half of it is a *live* figure that nothing signals a change to
 * (which is why the Portfolio tab is excluded from stay-mounted at all).
 *
 * **The live region is the transcript itself, not a copy of it.** The list carries `aria-live` and
 * is in the document from mount — a region added at the same moment as its first content announces
 * nothing — so inserting a turn announces the wait, and replacing that turn's body announces the
 * answer. A second, hidden copy of the answer for a screen reader would be two strings for one
 * answer, which is the shape this codebase keeps refusing.
 *
 * **The newest turn is first.** A conversation usually reads downward, but this one is in a panel
 * that may have been hidden for minutes and has no scroll position to restore, and the answer to
 * the question just typed is the one that has to be adjacent to the box that typed it.
 */
export function AssistantConversation({
  status,
  displayCurrency,
}: {
  status: AssistantStatus
  /** The app's own currency selection, which every drift weight is a share of a total in. */
  displayCurrency: string
}): React.JSX.Element {
  const version = useSyncExternalStore(flexDataVersion.subscribe, flexDataVersion.get)
  const profileVersion = useSyncExternalStore(profileDataVersion.subscribe, profileDataVersion.get)
  const [grounding, setGrounding] = useState<GroundingInputs | null>(null)
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<readonly Turn[]>([])
  const [pending, setPending] = useState(false)
  // Turn ids are the list's keys and must not repeat within a session; a ref rather than
  // `turns.length`, which would collide if a turn were ever removed.
  const nextId = useRef(1)

  /**
   * The standing reading: what the gate and the notices are computed from.
   *
   * The display currency is the app's selection, threaded down from the shell for the reason the
   * Portfolio dashboard takes it (DDR-0007) — and the drift report states the currency it used, so
   * what an answer quotes is the report's own word rather than this component's.
   */
  useEffect(() => {
    let live = true
    void readGrounding(displayCurrency).then((next) => {
      if (live) setGrounding(next)
    })
    return () => {
      live = false
    }
    // Both versions are dependencies, not values read here: each means something underneath this
    // view changed while it may have been hidden for minutes (DDR-0027).
  }, [displayCurrency, profileVersion, version])

  const ask = useCallback(async (): Promise<void> => {
    if (grounding === null || !isAskable(question)) return

    const asked = question.trim()
    const id = nextId.current++
    setTurns((prev) => [
      { id, question: asked, groundedAt: version, answer: { kind: 'thinking' } },
      ...prev,
    ])
    setQuestion('')
    setPending(true)

    try {
      // Read again, and send *this* reading. The one in state answered the question of whether the
      // box should be open; it is not necessarily what is true now.
      const fresh = await readGrounding(displayCurrency)
      setGrounding(fresh)
      const result = await window.api.askAssistant({
        question: asked,
        context: buildAssistantContext(fresh),
      })
      setTurns((prev) =>
        prev.map((turn) => (turn.id === id ? { ...turn, answer: answerFromResult(result) } : turn)),
      )
    } finally {
      setPending(false)
    }
  }, [displayCurrency, grounding, question, version])

  const gate = askGate(status, grounding)

  // Loading its grounding: `ready` is false and there is nothing to say about why, which is the
  // one state that is a wait rather than a blocker.
  if (!gate.ready && gate.blocker === null) {
    return <StatePanel variant="loading">Reading what the assistant can see…</StatePanel>
  }

  const notices = grounding === null ? [] : groundingNotices(grounding)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ask about your portfolio</CardTitle>
      </CardHeader>
      <CardContent>
        {gate.blocker !== null ? (
          // Named, calm, and never toned as a failure: none of the four is something that went
          // wrong (DDR-0022). `notice` is the variant that paints nothing.
          <StatePanel variant="notice" surface="inline">
            {gate.blocker}
          </StatePanel>
        ) : (
          <form
            className="assistant-ask"
            onSubmit={(event) => {
              event.preventDefault()
              void ask()
            }}
          >
            <Field label="Your question">
              {(id) => (
                <textarea
                  id={id}
                  className={controlClassName('prose')}
                  value={question}
                  rows={3}
                  disabled={pending}
                  placeholder="What is my largest position, and how does it sit against my profile?"
                  onChange={(event) => setQuestion(event.target.value)}
                />
              )}
            </Field>
            <div className="assistant-ask-actions">
              <Button type="submit" variant="primary" disabled={pending || !isAskable(question)}>
                {askLabel(pending)}
              </Button>
            </div>
          </form>
        )}

        {notices.length > 0 && (
          <ul className="assistant-notices">
            {notices.map((notice) => (
              <li key={notice.id} className="assistant-notice">
                {notice.text}
              </li>
            ))}
          </ul>
        )}

        {/* Rendered from mount, empty or not. An `aria-live` region that arrives together with
            its first content announces nothing, so the list has to already be here when the first
            question is asked. `aria-atomic="false"` keeps the announcement to what changed — the
            turn just inserted, then that turn's answer — rather than re-reading the transcript on
            every question. */}
        <ol className="assistant-turns" aria-live="polite" aria-atomic="false">
          {turns.map((turn) => (
            <li key={turn.id} className="assistant-turn">
              <TurnBody turn={turn} version={version} />
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}

/**
 * Everything an answer may be grounded in, read in one go.
 *
 * All three are issued together rather than in sequence: none depends on another, and the slowest
 * is the drift read, which waits on the IBKR gateway's own bounded deadline (DDR-0022). None of
 * them throws — each channel returns its failure as a variant — so there is nothing to catch here
 * and no partial state to invent.
 */
async function readGrounding(displayCurrency: string): Promise<GroundingInputs> {
  const [allocation, profile, drift] = await Promise.all([
    window.api.getAllocation(),
    window.api.getInvestorProfile(),
    window.api.getBalanceDrift({ displayCurrency }),
  ])
  return { allocation, profile, drift }
}

/** One question and its answer. Nothing about it depends on where in the list it sits. */
function TurnBody({ turn, version }: { turn: Turn; version: number }): React.JSX.Element {
  return (
    <>
      <p className="assistant-question">{turn.question}</p>
      {turn.answer.kind === 'thinking' && (
        <p className="assistant-thinking">Asking the assistant…</p>
      )}
      {turn.answer.kind === 'answered' && (
        <>
          <p className="assistant-answer">{turn.answer.text}</p>
          {turn.answer.truncated && <p className="assistant-turn-note">{TRUNCATED_NOTE}</p>}
        </>
      )}
      {turn.answer.kind === 'failed' && (
        // The one state that interrupts, and the only one the primitive paints (DDR-0038).
        <StatePanel variant="error" surface="inline" heading={turn.answer.heading}>
          {turn.answer.text}
        </StatePanel>
      )}
      {isStale(turn, version) && <p className="assistant-turn-note">{STALE_NOTE}</p>}
    </>
  )
}
