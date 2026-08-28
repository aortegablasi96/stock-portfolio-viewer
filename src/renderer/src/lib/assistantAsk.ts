import { gateKind, type GateKind } from './assistantGate'
import { hasProfile, selectedPeriod } from './assistantContext'
import type { AssistantStatus, AssistantAskResult } from '@shared/domain/assistant'
import type { GroundingInputs } from './assistantContext'

/**
 * What the question box may do, what it must say instead, and what came back (Story #284,
 * DDR-0098).
 *
 * The story's rule is that **every blocking state is named specifically and calmly, and none is
 * presented as an error**. There are more of them here than an analytics view has: consent absent,
 * consent stale, no key, nothing to read, and then five ways one bounded request can end. That
 * count is the reason this view sits beside `AnalyticsShell` rather than inside it — the shell's
 * whole shape is four branches and no state (DDR-0043, DDR-0058), and a fifth, sixth and seventh
 * branch would not extend it so much as replace it.
 *
 * A Node-only test suite is why the states live here rather than in the component (DDR-0029). What
 * they mostly are is *wording*, and wording is the part of a state that goes wrong.
 *
 * ## Blocking and not blocking are different things
 *
 * Consent and the key **block**: without either, nothing may be asked, and the panel above the box
 * already says so in the gate's own words. A missing profile and an empty Flex store do **not** —
 * they are gaps in what an answer can be grounded on, and a question the remaining sections can
 * answer is still worth asking. They are named beside the box as notices, so the owner learns what
 * the assistant cannot see *before* reading an answer shaped by its absence rather than after.
 *
 * The one case where a gap does block is when **every** gap is present at once: nothing imported,
 * no live reading, no profile. There is then no context at all, and a question would be answered
 * from the model's training data alone — which is the one thing ADR-0009 says an answer must never
 * quietly be.
 */

/** Why the box is unusable, or that it is not. */
export type AskGateKind = GateKind | 'no_grounding'

/** What the box is allowed to do right now, and what to say where it is not. */
export interface AskGate {
  kind: AskGateKind
  /** Whether a question may be sent at all. */
  ready: boolean
  /** What stands in the way, in one sentence. `null` when nothing does. */
  blocker: string | null
}

/**
 * The one sentence each blocker says.
 *
 * Consent and the key defer to the panel above rather than restating it — two statements of the
 * same fact on one page is how they drift — so what they say here is where the answer is, not
 * what it is.
 */
export const ASK_BLOCKERS: Record<AskGateKind, string | null> = {
  first_consent: 'Allow the assistant above before asking it anything.',
  re_consent: 'What would be sent has changed. Read the list above and decide again before asking.',
  not_configured: 'There is no API key for the assistant to send with, so a question cannot go anywhere yet.',
  ready: null,
  no_grounding:
    'There is nothing for an answer to be grounded in yet: no Flex statements imported, no live reading from the gateway, and no investor profile. Import a statement, start the IBKR gateway, or set a profile.',
}

/**
 * Whether a question may be asked, and if not, which of the four facts is why.
 *
 * Order matters and is the same order the gate panel uses: a decision the owner has not made comes
 * before a key they have not pasted, which comes before data they have not imported. Telling
 * someone to import a statement while they have not agreed to the feature answers a question they
 * did not ask (DDR-0097).
 */
export function askGate(status: AssistantStatus, grounding: GroundingInputs | null): AskGate {
  const kind = gateKind(status)
  if (kind !== 'ready') return { kind, ready: false, blocker: ASK_BLOCKERS[kind] }

  // Still loading its grounding: not a blocker, and not yet askable either. Reported as `ready`
  // being false with nothing to say, because "we are reading" is the view's spinner, not a state.
  if (grounding === null) return { kind: 'ready', ready: false, blocker: null }

  if (!hasAnyGrounding(grounding)) {
    return { kind: 'no_grounding', ready: false, blocker: ASK_BLOCKERS.no_grounding }
  }
  return { kind: 'ready', ready: true, blocker: null }
}

/** Whether anything at all was readable — the condition `no_grounding` is the absence of. */
export function hasAnyGrounding(grounding: GroundingInputs): boolean {
  return (
    grounding.allocation.status === 'ok' ||
    grounding.performance.status === 'ok' ||
    grounding.drift.status === 'ok' ||
    hasProfile(grounding.profile)
  )
}

/** A gap in what an answer can be grounded on. Named, never silently worked around. */
export interface GroundingNotice {
  id: 'no_import' | 'no_profile' | 'no_live' | 'empty_period'
  text: string
}

/**
 * What the assistant cannot see, said before the answer rather than after it.
 *
 * Each is derived from a report's own variant rather than guessed at, and each names the recovery
 * — which is the difference between a notice and a shrug. The live one folds `not_connected` and
 * `not_responding` into one sentence deliberately: DDR-0022 keeps them apart because their
 * *recovery* differs, and here the recovery is the same either way — the drift section is simply
 * not in front of the model, whichever of the two is true. The Portfolio view is where the gateway
 * states are reported in their own right.
 */
export function groundingNotices(grounding: GroundingInputs): GroundingNotice[] {
  const notices: GroundingNotice[] = []

  if (grounding.allocation.status !== 'ok') {
    notices.push({
      id: 'no_import',
      text: 'No Flex statements are imported, so the assistant cannot see what you hold, how it is divided, or how it has performed. Import one from the Portfolio view.',
    })
  } else {
    // Only where there *is* a history to window: with nothing imported, "your period is empty"
    // would be the second sentence about the same absence, and the first one already names the
    // recovery. A period that resolves to no day at all is a different fact and needs saying —
    // a custom window can land outside the history entirely (Story #285).
    const period = selectedPeriod(grounding)
    if (period !== null && period.days === 0) {
      notices.push({
        id: 'empty_period',
        text: 'The period selected above holds no day of imported history, so an explanation of it has nothing to be grounded in. Choose another period.',
      })
    }
  }

  if (!hasProfile(grounding.profile)) {
    notices.push({
      id: 'no_profile',
      text: 'No investor profile is set, so the assistant has no standard of yours to judge balance against. Set one on the Profile view.',
    })
  } else if (grounding.drift.status === 'not_connected' || grounding.drift.status === 'not_responding') {
    notices.push({
      id: 'no_live',
      text: 'The IBKR gateway is not answering, so how far your live portfolio sits from your profile is not part of this answer.',
    })
  }

  return notices
}

/** One question and whatever became of it. */
export interface Turn {
  /** Monotonic within the session; the key a list renders on. */
  id: number
  question: string
  /** The value `lib/dataVersion` held when this turn was grounded (DDR-0027). */
  groundedAt: number
  answer: TurnAnswer
}

/** A turn's outcome: waiting, answered, or ended in one of the five ways it can. */
export type TurnAnswer =
  | { kind: 'thinking' }
  | { kind: 'answered'; text: string; truncated: boolean }
  | { kind: 'failed'; heading: string; text: string }

/**
 * The heading each failure carries.
 *
 * One per gateway variant, and the pairs stay apart for the reason DDR-0096 put them there.
 * `too_large` is the one worth naming precisely: it means **nothing was sent**, and calling it a
 * refusal would tell the owner OpenAI rejected their portfolio when in fact it never left the
 * machine — the one distinction ADR-0010 exists to keep clear.
 */
export const FAILURE_HEADINGS: Record<FailureStatus, string> = {
  needs_consent: 'Nothing was sent',
  not_configured: 'No API key',
  too_large: 'Too large to send — nothing left this machine',
  refused: 'OpenAI declined the request',
  not_responding: 'No answer came back',
  invalid: 'The answer did not arrive in a usable shape',
  error: 'Something went wrong',
}

/** Every status that is not an answer. */
export type FailureStatus = Exclude<AssistantAskResult['status'], 'ok'>

/**
 * Turn a result into what the view shows.
 *
 * The gateway's own `message` is carried through rather than replaced: it is written for the owner
 * already, and a refusal has been redacted before it reached this process (DDR-0096). What is added
 * is the heading, because a bare sentence gives a reader no way to tell a stall from a rejection at
 * a glance.
 *
 * An `ok` answer whose text is empty is **not** an answer. The gateway maps a 200 with no content
 * to `invalid`, and this is the second guard on the same claim: an empty bubble under a question
 * reads as the assistant having nothing to say rather than as a failure.
 */
export function answerFromResult(result: AssistantAskResult): TurnAnswer {
  if (result.status === 'ok') {
    const text = result.answer.text.trim()
    if (text === '') {
      return {
        kind: 'failed',
        heading: FAILURE_HEADINGS.invalid,
        text: 'The request succeeded but came back with no answer in it.',
      }
    }
    return { kind: 'answered', text, truncated: result.answer.truncated }
  }
  return { kind: 'failed', heading: FAILURE_HEADINGS[result.status], text: result.message }
}

/**
 * Whether a turn was grounded in figures a Flex write has since replaced (DDR-0027).
 *
 * The view stays mounted, so a transcript outlives the import that invalidates it. The answer is
 * not withdrawn — it was true when it was given, and deleting it would be a stranger thing to do
 * than labelling it — but it stops being presented as current.
 */
export function isStale(turn: Turn, version: number): boolean {
  return turn.groundedAt < version
}

/** What a stale turn says about itself, beside the answer rather than instead of it. */
export const STALE_NOTE =
  'Your imported history changed after this answer, so the figures in it are no longer current. Ask again for an answer grounded in what is there now.'

/** The note under an answer the model was cut off in the middle of. */
export const TRUNCATED_NOTE = 'The answer reached its length limit and stops mid-thought.'

/** Whether a typed question is worth sending. Whitespace is not a question. */
export function isAskable(question: string): boolean {
  return question.trim() !== ''
}

/** The send button's label, which reports the request it started. */
export function askLabel(pending: boolean): string {
  return pending ? 'Asking…' : 'Ask'
}
