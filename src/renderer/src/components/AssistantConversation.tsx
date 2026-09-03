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
import { buildAssistantContext, type GroundingReports } from '../lib/assistantContext'
import {
  NEW_CONVERSATION_BUSY_LABEL,
  NEW_CONVERSATION_CONFIRM_LABEL,
  NEW_CONVERSATION_LABEL,
  NEW_CONVERSATION_WARNING,
  rememberedTurns,
} from '../lib/assistantHistory'
import {
  COMPOSER_PLACEHOLDER,
  sendsOnEnter,
  SUGGESTIONS_LABEL,
  THINKING_NOTE,
} from '../lib/assistantComposer'
import {
  blockClassName,
  bubbleClassName,
  EMPTY_TRANSCRIPT_DETAIL,
  EMPTY_TRANSCRIPT_HEADING,
  roleLabel,
  transcriptOrder,
} from '../lib/assistantTranscript'
import { flexDataVersion } from '../lib/dataVersion'
import { controlClassName } from '../lib/fieldVariants'
import type { AssistantStatus } from '@shared/domain/assistant'
import { AssistantAnswer } from './AssistantAnswer'
import { ConfirmAction } from './ConfirmAction'
import { Button } from './ui/Button'
import { Field } from './ui/Field'
import { StatePanel } from './ui/StatePanel'

/**
 * The question box and what came back (Story #284, DDR-0098).
 *
 * **It is the view now** (Story #309, ADR-0011). The consent gate it used to sit behind is gone as
 * a concept, and the key card above draws nothing once a key is in force, so on every run after the
 * first this component *is* the Assistant page. What stands in front of a question is the key and
 * nothing else: `askGate` reads it from the same status the card above draws, and where there is
 * none the gateway's own `not_configured` is what comes back from main — the renderer's check saves
 * a round trip, it does not enforce anything (DDR-0096).
 *
 * **The component holds state and does no reasoning.** Which gate applies, what the assistant
 * cannot see, what a result becomes on screen and what a screen reader is told are all in
 * `lib/assistantAsk`; the context is in `lib/assistantContext`. That split is not tidiness — Vitest
 * runs Node-only with no jsdom (DDR-0029), so what is left in here is exactly what no test can
 * reach, and it is kept to reads, writes and wiring for that reason.
 *
 * Three behaviours are worth reading before changing anything:
 *
 * **Grounding is re-read when either version moves** (DDR-0027). The view stays mounted, so a
 * transcript outlives the import that invalidates it. The answers are not withdrawn — each was
 * true when given — but each records the Flex version it was grounded at, and one the store has
 * moved past says so beside itself. The profile's version is watched for a different reason: it
 * changes what may be *asked* rather than what an answer said, because a profile can be the only
 * thing there is to ground on. Since Story #310 it arrives as a **prop** rather than from a
 * module-level store: the profile is written by a sibling on this very page, so `AssistantView` is
 * the common ancestor the counter belongs in (DDR-0108).
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
 * **The transcript is drawn oldest-first, and the array is not** (Story #344, DDR-0115 decision 7).
 * `turns` stays newest-first because that order is the *wire's*: `rememberedTurns` walks it
 * backwards and `trimHistory` drops from the oldest end, so reversing the stored array to get the
 * design's reading order would invert the memory in silence. `transcriptOrder` produces the second
 * order at the point of drawing and nowhere else.
 *
 * **There is no period control, and that is a decision** (DDR-0102, superseding half of DDR-0099).
 * #285 put a `RangeFilter` above the box; it was removed because a question already carries its own
 * period — *how did last year go?* — and a picker makes the owner say it twice, in two vocabularies,
 * with the control silently winning. The grounding is a **function of the reports alone** now, which
 * is why `GroundingInputs` collapsed back into `GroundingReports`: there is no selection left to
 * hold apart.
 *
 * **The newest turn is last, and is scrolled to.** #284 drew the transcript newest-first so the
 * answer to the question just typed was adjacent to the box that typed it. #343 moved the box to
 * the bottom of its own band and gave the transcript a scroller of its own, which answers the same
 * need the way a conversation does: the newest turn is at the bottom, beside the composer, and a
 * new one is scrolled into view. That scroll is `scroll-behavior` on the band rather than a
 * `behavior` option here, because a reader who asked for less motion has to be able to turn it off
 * and CSS is where this app answers that (DDR-0044, DDR-0115 amendment 4).
 */
export function AssistantConversation({
  status,
  displayCurrency,
  profileVersion,
}: {
  status: AssistantStatus
  /** The app's own currency selection, which every drift weight is a share of a total in. */
  displayCurrency: string
  /** How many times the profile beside this conversation has been written (DDR-0108). */
  profileVersion: number
}): React.JSX.Element {
  const version = useSyncExternalStore(flexDataVersion.subscribe, flexDataVersion.get)
  const [reports, setReports] = useState<GroundingReports | null>(null)
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<readonly Turn[]>([])
  const [pending, setPending] = useState(false)
  // Turn ids are the list's keys and must not repeat within a session; a ref rather than
  // `turns.length`, which would collide if a turn were ever removed.
  const nextId = useRef(1)
  /** The scrolling band, which is what is scrolled to its own end when a turn arrives. */
  const transcript = useRef<HTMLDivElement>(null)

  /**
   * The standing reading: what the gate and the notices are computed from.
   *
   * The display currency is the app's selection, threaded down from the shell for the reason the
   * Portfolio dashboard takes it (DDR-0007) — and the drift report states the currency it used, so
   * what an answer quotes is the report's own word rather than this component's.
   */
  useEffect(() => {
    let live = true
    void readReports(displayCurrency).then((next) => {
      if (live) setReports(next)
    })
    return () => {
      live = false
    }
    // Both versions are dependencies, not values read here: each means something underneath this
    // view changed — while it may have been hidden for minutes, or in the section directly above
    // it (DDR-0027, DDR-0108).
  }, [displayCurrency, profileVersion, version])

  /**
   * Keep the foot of the transcript in view, which is where the newest turn now is (Story #344).
   *
   * `turns` rather than `turns.length` on purpose: an answer replacing a waiting bubble is the
   * same object identity changing, and it is the moment the block grows by several lines — so the
   * question that prompted it would otherwise scroll off the bottom exactly when it was answered.
   *
   * **The band is scrolled to its own end, rather than a sentinel scrolled into view.** The design
   * puts an empty `<div>` after the last message and calls `scrollIntoView` on it; that lands the
   * sentinel's bottom on the scrollport's bottom edge and leaves the band's own bottom padding
   * below it unscrolled, so the newest bubble ends up flush against the composer's rule with no
   * gap. Setting `scrollTop` past the maximum is clamped to the true end, padding included, and
   * needs no element at all.
   *
   * **No `behavior` option, here or anywhere.** A programmatic scroll with the behavior left at
   * `auto` resolves the scroller's own `scroll-behavior` — `smooth` on `.assistant-transcript`,
   * `auto` under `prefers-reduced-motion`. Passing `'smooth'` would put the answer to that
   * preference in a place the media query cannot reach, which is the failure DDR-0044's whole
   * mechanism exists to prevent.
   */
  useEffect(() => {
    const band = transcript.current
    if (band !== null) band.scrollTop = band.scrollHeight
  }, [turns])

  const ask = useCallback(async (): Promise<void> => {
    if (reports === null || !isAskable(question)) return

    const asked = question.trim()
    // The conversation so far, read **before** this turn joins it (Story #320, DDR-0113). Answered
    // turns only, stale ones dropped, newest kept to the caps — every rule of that is
    // `rememberedTurns`, which is where a Node-only suite can reach it.
    const history = rememberedTurns(turns, version)
    const id = nextId.current++
    // Newest-first, which is the order `rememberedTurns` reads and the trim drops from — the
    // transcript's own order is produced at the point of drawing (Story #344, DDR-0115).
    // `askedAt` is drawn beside the owner's bubble and goes nowhere near the request.
    setTurns((prev) => [
      {
        id,
        question: asked,
        groundedAt: version,
        askedAt: Date.now(),
        answeredAt: null,
        answer: { kind: 'thinking' },
      },
      ...prev,
    ])
    setQuestion('')
    setPending(true)

    try {
      // Read again, and send *this* reading. The one in state answered the question of whether the
      // box should be open; it is not necessarily what is true now.
      const fresh = await readReports(displayCurrency)
      setReports(fresh)
      const result = await window.api.askAssistant({
        question: asked,
        // Empty since Story #327 — every figure is behind a tool now, and `fresh` is read for the
        // notices beside the box rather than for anything sent. The field and the boundary that
        // bounds it stay, so a story that assembles a section again meets the guard (DDR-0098).
        context: buildAssistantContext(),
        // The app's own selection, sent so a report the model asks for is weighed in the currency
        // on screen (Story #326, DDR-0007). The tools run in main, where no view exists to ask.
        displayCurrency,
        history,
      })
      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === id
            ? { ...turn, answeredAt: Date.now(), answer: answerFromResult(result) }
            : turn,
        ),
      )
    } finally {
      setPending(false)
    }
  }, [displayCurrency, question, reports, turns, version])

  /**
   * Discard the conversation, so the next question starts one (DDR-0113, decision 7).
   *
   * Clearing the turns is the whole of it: the model sees what `rememberedTurns` selects from this
   * list, so an empty list is a model that sees nothing from the discarded conversation. Nothing is
   * stored, so nothing is deleted — ADR-0006 does not reach session state — but the owner's own
   * record of what they asked is gone, which is what the confirmation is for.
   */
  const startFresh = useCallback(async (): Promise<void> => {
    setTurns([])
  }, [])

  const gate = askGate(status, reports)

  // Loading its grounding: `ready` is false and there is nothing to say about why, which is the
  // one state that is a wait rather than a blocker.
  if (!gate.ready && gate.blocker === null) {
    return (
      <div className="assistant-chat-block">
        <StatePanel variant="loading">Reading what the assistant can see…</StatePanel>
      </div>
    )
  }

  const notices = reports === null ? [] : groundingNotices(reports)

  return (
    /* Three bands, and only the middle one scrolls (Story #343, DDR-0115). The card is gone: the
       column *is* the surface now, so a card inside it would be a box drawn around the whole of
       one. What is inside the bands is untouched — the header is still this title, the composer is
       still today's form and submit button, and the transcript is still today's stacked turns.
       #346, #345 and #344 fill each band in turn. */
    <>
      <div className="assistant-chat-head">
        <h2 className="assistant-chat-title">Ask about your portfolio</h2>
      </div>

      {/* Rendered from mount, empty or not. An `aria-live` region that arrives together with its
          first content announces nothing, so the list has to already be here when the first
          question is asked. `aria-atomic="false"` keeps the announcement to what changed — the
          turn just inserted, then that turn's answer — rather than re-reading the transcript on
          every question. Moving it into a scrolling band moved neither the region nor its rules
          (DDR-0107, DDR-0115 decision 9). */}
      <div ref={transcript} className="assistant-transcript">
        {/* Beside the list rather than inside it: the `<ol>` is the live region, so a placeholder
            `<li>` would be announced as though it were a turn. Absent once there is one, which is
            this app's rule for a state (DDR-0038). */}
        {turns.length === 0 && (
          <div className="assistant-transcript-empty">
            <svg
              className="assistant-transcript-empty-glyph"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2a7 7 0 0 1 7 7c0 3.5-2.5 6.5-6 7v2H9v-2c-3.5-.5-6-3.5-6-7a7 7 0 0 1 7-7z" />
            </svg>
            <p className="assistant-transcript-empty-heading">{EMPTY_TRANSCRIPT_HEADING}</p>
            <p className="assistant-transcript-empty-detail">{EMPTY_TRANSCRIPT_DETAIL}</p>
          </div>
        )}

        <ol className="assistant-turns" aria-live="polite" aria-atomic="false">
          {/* Oldest first. The array behind it is newest-first and stays that way — see the
              module note, and DDR-0115 decision 7 for what reversing the wrong one costs. */}
          {transcriptOrder(turns).map((turn) => (
            <li key={turn.id} className="assistant-turn">
              <TurnBody turn={turn} version={version} />
            </li>
          ))}
        </ol>
      </div>

      <div className="assistant-composer">
        {/* What the assistant cannot see, above the box rather than below it — which is where the
            design puts the gateway's own line, and #346 folds this list into it. */}
        {notices.length > 0 && (
          <ul className="assistant-notices">
            {notices.map((notice) => (
              <li key={notice.id} className="assistant-notice">
                {notice.text}
              </li>
            ))}
          </ul>
        )}

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
            {/* The box and the two square controls, on one row (Story #345). No period control,
                deliberately (DDR-0102): a question names its own period, and a picker beside it
                asks for the same fact twice in two vocabularies — one typed, one clicked — with
                the click silently winning whenever they disagree. */}
            <div className="assistant-ask-row">
              {/* The label is `Field`'s, kept and clipped rather than dropped. The design draws
                  none and lets the placeholder name the box, which is a *visible* naming and not
                  an accessible one — so the label joins `.sr-only`'s own rule (Story #343 made the
                  same move for the eyebrow) and `Field` still owns the id through `useId()`, which
                  is the half DDR-0035 exists for. */}
              <Field label="Your question" className="assistant-ask-field">
                {(id) => (
                  <textarea
                    id={id}
                    className={controlClassName('prose')}
                    value={question}
                    rows={3}
                    disabled={pending}
                    placeholder={COMPOSER_PLACEHOLDER}
                    onChange={(event) => setQuestion(event.target.value)}
                    onKeyDown={(event) => {
                      if (!sendsOnEnter(event.nativeEvent)) return
                      // Through the form's own submit, never straight to `ask()`: the button and
                      // the key press must be one path with one set of guards, or a later story
                      // adding a check to one leaves the other behind. `preventDefault` is
                      // load-bearing — without it the newline lands as well as the question.
                      event.preventDefault()
                      event.currentTarget.form?.requestSubmit()
                    }}
                  />
                )}
              </Field>

              {/* Stacked to the right of the box, at the design's 44px square. Both are named:
                  `size="icon"` is a shape, not an exemption from having a name (DDR-0032), and
                  neither declares a focus ring — the `:where()` base rings them (DDR-0026). */}
              <div className="assistant-composer-actions">
                <Button
                  type="submit"
                  variant="primary"
                  aria-label={askLabel(pending)}
                  title={askLabel(pending)}
                  disabled={pending || !isAskable(question)}
                >
                  <SendGlyph />
                </Button>
                {/* Inert until #348 gives it chips to open, and `disabled` is the honest form of
                    that: the one state a control can be in that does not invite a click it will
                    not answer. #348 removes the attribute and nothing else. */}
                <Button
                  variant="secondary"
                  aria-label={SUGGESTIONS_LABEL}
                  title={SUGGESTIONS_LABEL}
                  disabled
                >
                  <SuggestionsGlyph />
                </Button>
              </div>
            </div>

            <div className="assistant-ask-actions">
              {/* Only once there is a conversation to discard — a control that clears nothing
                  says the transcript is a thing to manage before the owner has one (DDR-0113).
                  #346 moves it into the chat header's chip row; until then it sits under the box
                  rather than beside a send control that is now a 44px glyph. */}
              {turns.length > 0 && (
                <ConfirmAction
                  label={NEW_CONVERSATION_LABEL}
                  confirmLabel={NEW_CONVERSATION_CONFIRM_LABEL}
                  busyLabel={NEW_CONVERSATION_BUSY_LABEL}
                  warning={NEW_CONVERSATION_WARNING}
                  onConfirm={startFresh}
                />
              )}
            </div>
          </form>
        )}
      </div>
    </>
  )
}

/**
 * The two composer glyphs, drawn as the design draws them
 * (`figma_design/src/App.tsx:2436` and `2456`).
 *
 * `aria-hidden` and `focusable="false"` on both: the button beside them carries the name, and a
 * glyph that joined the accessibility tree would say it twice. Sized in `em` rather than px, for
 * the reason `.assistant-toggle-glyph` is — an icon picked in px is the one thing that would not
 * move with the type scale (DDR-0048).
 */
function SendGlyph(): React.JSX.Element {
  return (
    <svg
      className="assistant-composer-glyph"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

function SuggestionsGlyph(): React.JSX.Element {
  return (
    <svg
      className="assistant-composer-glyph"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  )
}

/**
 * Everything an answer may be grounded in, read in one go.
 *
 * All four are issued together rather than in sequence: none depends on another, and the slowest
 * is the drift read, which waits on the IBKR gateway's own bounded deadline (DDR-0022). None of
 * them throws — each channel returns its failure as a variant — so there is nothing to catch here
 * and no partial state to invent.
 *
 * The period the owner selected is deliberately **not** part of this: it is a selection over the
 * performance report these calls return, so it reframes an explanation without re-reading anything
 * (Story #285).
 */
async function readReports(displayCurrency: string): Promise<GroundingReports> {
  const [allocation, profile, drift, performance] = await Promise.all([
    window.api.getAllocation(),
    window.api.getInvestorProfile(),
    window.api.getBalanceDrift({ displayCurrency }),
    window.api.getPerformance(),
  ])
  return { allocation, profile, drift, performance }
}

/**
 * One question and its answer, as the design's two bubbles (Story #344, DDR-0115 decision 7).
 *
 * **The role is the marking, and now it is visible.** DDR-0113 made the role the marking in the
 * *message array* — the owner's `user`, the model's `assistant`, the seam being the array's shape
 * rather than a prompt rule. The same marking is on screen here, which is a pleasing symmetry and
 * not a licence to derive one from the other: nothing in `rememberedTurns` knows this exists, and
 * the two clock times drawn below reach no request at all.
 *
 * Nothing about it depends on where in the list it sits. The `<li>` is still the document
 * structure and the live region's child; the alignment is layout on top of it.
 */
function TurnBody({ turn, version }: { turn: Turn; version: number }): React.JSX.Element {
  return (
    <>
      <div className={blockClassName('you')}>
        <p className="assistant-turn-role">{roleLabel('you', turn.askedAt)}</p>
        <div className={bubbleClassName('you')}>{turn.question}</div>
      </div>

      <div className={blockClassName('model')}>
        {/* No time while nothing has come back, which is what the design draws on the waiting
            bubble and the only honest reading: there is no moment to state yet. */}
        <p className="assistant-turn-role">{roleLabel('model', turn.answeredAt)}</p>
        <div className={bubbleClassName('model')}>
          {turn.answer.kind === 'thinking' && (
            // In place of the answer on the turn just asked, never a banner outside the list:
            // the `aria-live` region announces the turn's insertion and then its answer as two
            // changes, and a separate element would collapse those into one (DDR-0107, #344).
            // The dots are `aria-hidden` and the sentence beside them is what is announced —
            // three pulsing circles say nothing without sight.
            <p className="assistant-thinking">
              <span className="sr-only">{THINKING_NOTE}</span>
              <span className="assistant-thinking-dots" aria-hidden="true">
                <span className="assistant-thinking-dot" />
                <span className="assistant-thinking-dot" />
                <span className="assistant-thinking-dot" />
              </span>
            </p>
          )}
          {turn.answer.kind === 'answered' && (
            <>
              {/* Formatted, not marked up (Story #321, DDR-0114). The string itself is untouched —
                  `rememberedTurns` sends this same `text` back under the model's own role, so the
                  markup is a *render* concern and a later turn carries exactly what came back. */}
              <AssistantAnswer text={turn.answer.text} />
              {turn.answer.truncated && <p className="assistant-turn-note">{TRUNCATED_NOTE}</p>}
            </>
          )}
          {turn.answer.kind === 'failed' && (
            // The one state that interrupts, and the only one the primitive paints (DDR-0038).
            <StatePanel variant="error" surface="inline" heading={turn.answer.heading}>
              {turn.answer.text}
            </StatePanel>
          )}
          {/* Inside the bubble, beside the answer it is about — it was true when it was given, and
              this is the sentence saying the store has moved past it (DDR-0027). */}
          {isStale(turn, version) && <p className="assistant-turn-note">{STALE_NOTE}</p>}
        </div>
      </div>
    </>
  )
}
