import { groundingNotices, type GroundingNotice } from './assistantAsk'
import { hasProfile, type GroundingReports } from './assistantContext'
import type { BalanceDriftResult } from '@shared/domain/balanceDrift'

/**
 * The chat column's header, and the one line above the composer (Story #346, DDR-0115 amendments
 * 3, 5 and 6).
 *
 * The design draws the same set of facts twice and this app used to draw it three times. A chip
 * row in the header says **what state each source is in**; a line with an info glyph directly above
 * the composer says **what that costs an answer**; and until this story a third wording — the
 * `assistant-notices` `<ul>` under the box, straight from `groundingNotices` — said both again in
 * its own voice. Three wordings for one set of facts is one too many, so the list goes and its
 * facts land in the two surfaces the design has for them.
 *
 * **Nothing here is a second source.** Every state below is derived from the same
 * {@link GroundingReports} the gate and the notices are computed from — `groundingNotices` is
 * called outright to build the line, rather than the gaps being re-detected beside it. That is the
 * property that keeps the chip and the line from ever disagreeing: they are two renderings of one
 * computation, which is exactly the redundancy DDR-0115 amendment 3 sanctions and DDR-0102 was
 * never about.
 *
 * **The gateway reading is the drift report's, and it is not the sidebar's.** The rail's badge is
 * derived from the last `portfolio:getOverview` (DDR-0056) and this view never makes that call; the
 * reading here comes from `profile:getBalanceDrift`, the one `profile:*` channel carrying gateway
 * states (DDR-0095). The two can legitimately differ — a rail saying `Live · 14:32` beside a chip
 * saying `IBKR offline` is two clocks, each right about its own reading — and **neither may be
 * made to read the other**. Nothing polls in either case: both are whatever the standing read
 * returned.
 *
 * It is a pure module for the reason every decision in this view is one: Vitest runs Node-only with
 * no jsdom (DDR-0029), so a chip's wording, its tone or the sentence above the box would be
 * unassertable inside a component.
 */

/** The design's own title (`figma_design/src/App.tsx:2139`). */
export const CHAT_TITLE = 'Ask about your portfolio'

/**
 * The subtitle, and **the one sentence of the design this app does not take** (DDR-0115 amendment
 * 10).
 *
 * The design reads *"Portfolio data + your investor profile are included with every question"*
 * (`figma_design/src/App.tsx:2140`). That was true when the file was drawn and stopped being true
 * at #327: the assembled context is empty and the model fetches what it needs through tools, one
 * computed report at a time (DDR-0111). The slot, the size and the register are the design's; the
 * sentence is corrected, and it is recorded as a correction of fact rather than a preference so
 * that nobody reconciles the app back to the Figma text later.
 */
export const CHAT_SUBTITLE = 'The assistant fetches your figures and your profile as it needs them'

/**
 * A chip's tone, and the app's existing three-tone vocabulary rather than a fourth.
 *
 * The same names the sidebar's gateway badge wears (`gateway-badge-live | -idle | -warn`), because
 * they mean the same three things and a second vocabulary for one set of states is how two
 * surfaces start disagreeing about what "quiet" looks like. What is deliberately *not* shared is
 * the reading behind them — see the module note.
 */
export type ChipTone = 'live' | 'idle' | 'warn'

/** One state chip: what it says, and how loudly. Never a control — see {@link headerChips}. */
export interface HeaderChip {
  id: 'gateway' | 'profile'
  tone: ChipTone
  label: string
}

/**
 * What each gateway state is called, one per variant of the drift result.
 *
 * Written as a total record so a state added to `balanceDriftResultSchema` without a name here is
 * a compile error rather than a chip rendering `undefined`. `not_connected` and `not_responding`
 * are named apart, as DDR-0022 requires: they differ by what the owner does next, and folding them
 * into "offline" would tell someone whose gateway is *stalling* to go and start it.
 *
 * `IBKR offline` is the design's own wording for the state its mock is in
 * (`figma_design/src/App.tsx:2161`); the other four are this app's, because the design draws only
 * the one.
 */
export const GATEWAY_CHIP_LABELS: Record<BalanceDriftResult['status'], string> = {
  ok: 'IBKR live',
  no_data: 'IBKR: no live positions',
  not_connected: 'IBKR offline',
  not_responding: 'IBKR not responding',
  error: 'IBKR read failed',
}

/**
 * How each gateway state is toned, and **a merely quiet state is not painted as a failure**.
 *
 * `no_data` is the one worth reading twice: the gateway answered perfectly well and there was
 * nothing to value — an empty account, or one whose rows are all unconvertible in the display
 * currency (DDR-0007). Toning that `warn` would report a working gateway as broken, so it is
 * `idle`, which is the tone for *nothing to say* rather than for *something went wrong*.
 *
 * `error` is `warn` rather than a fourth tone of its own: what the chip has to carry is whether the
 * live reading is in the answer, and it is not, whichever of the three ways it failed. The wording
 * is where they are told apart (DDR-0038).
 */
export const GATEWAY_CHIP_TONES: Record<BalanceDriftResult['status'], ChipTone> = {
  ok: 'live',
  no_data: 'idle',
  not_connected: 'warn',
  not_responding: 'warn',
  error: 'warn',
}

/** What the profile chip says in each of its two states (`figma_design/src/App.tsx:2181`). */
export const PROFILE_CHIP_LABELS = {
  stated: 'Profile active',
  absent: 'Profile not saved',
} as const

/**
 * The two state chips, or none at all while the reading is still in flight.
 *
 * **Absent, never guessed.** Before the four reports land there is no state to report, and a chip
 * reading `IBKR offline` because nothing has answered *yet* would be the view inventing a fact it
 * does not have. A state that is not known is not drawn, which is this app's rule for a state
 * everywhere else (DDR-0038) — the controls beside them still render, because *clear this
 * conversation* and *reopen the profile* are true things to offer whatever the gateway is doing.
 *
 * The controls are not in this list on purpose: **a chip that is a control is a `<button>`**
 * (DDR-0115 amendment 6), and mixing the two into one array is how one ends up as the other.
 */
export function headerChips(reports: GroundingReports | null): HeaderChip[] {
  if (reports === null) return []

  const stated = hasProfile(reports.profile)
  return [
    {
      id: 'gateway',
      tone: GATEWAY_CHIP_TONES[reports.drift.status],
      label: GATEWAY_CHIP_LABELS[reports.drift.status],
    },
    {
      id: 'profile',
      tone: stated ? 'live' : 'idle',
      label: stated ? PROFILE_CHIP_LABELS.stated : PROFILE_CHIP_LABELS.absent,
    },
  ]
}

/** The chip's classes: a base for the box, a modifier carrying the tone's two custom properties. */
export function chipClassName(tone: ChipTone): string {
  return `assistant-chip assistant-chip-${tone}`
}

/**
 * The label the design's Clear chat button carries (`figma_design/src/App.tsx:2210`).
 *
 * It replaces `New conversation`, and the `ConfirmAction` behind it, at the design's word
 * (DDR-0115 amendment 5). Nothing stored is touched — the transcript is a React array and ADR-0006
 * governs rows in a database — so the confirm this app puts in front of a destructive action is not
 * what is being waived here; `Clear the profile` keeps it in #347, and that is the line between the
 * two.
 */
export const CLEAR_CHAT_LABEL = 'Clear chat'

/**
 * What Clear chat says on hover, and it is where a real fact came to live.
 *
 * `NEW_CONVERSATION_WARNING` said two things: the transcript goes, **and** the assistant stops
 * remembering it. Only the first is visible when the button is pressed; the second is the one that
 * changes what the next answer can refer to (DDR-0113), and it lost its only home when the confirm
 * went. DDR-0115 amendment 5 leaves it to this story whether the `title` carries it. It does.
 */
export const CLEAR_CHAT_TITLE =
  'Clear the conversation. The assistant stops remembering it, and your next question starts a fresh one.'

/** The design's second header control, drawn only while the profile column is folded away. */
export const EDIT_PROFILE_LABEL = 'Edit profile'

/**
 * What each gap costs an answer, in the design's own register: a state, then its consequence.
 *
 * Keyed by `GroundingNotice['id']`, so a notice added to `groundingNotices` without a consequence
 * here is a compile error. Each clause is written to be **read mid-sentence**, which is what lets
 * two of them share one line without either being restated.
 */
const CONSEQUENCES: Record<GroundingNotice['id'], string> = {
  no_import:
    'no Flex statements are imported, so your holdings, allocation and performance are not in answers',
  no_profile:
    'no investor profile is set, so answers are judged against the app’s own baseline rather than a standard of yours',
  no_live: 'the IBKR gateway is not answering, so live portfolio drift is not in answers',
}

/**
 * The one line above the composer: what an answer will be missing, before it is read.
 *
 * `null` when nothing is missing, and **absent rather than empty** on screen — a line saying
 * everything is fine is a line the eye learns to skip, which is the one thing this sentence cannot
 * afford to become.
 *
 * It is built from `groundingNotices` rather than beside it. That is the whole of why the fold is
 * safe: the chip, the gate and this line read one computation over one reading, so the header
 * cannot say the gateway is answering while the line says its figures are missing.
 *
 * Two gaps share one line rather than becoming two lines, because two lines with a glyph each is
 * the `<ul>` this story removed, drawn one band lower.
 */
export function groundingLine(reports: GroundingReports | null): string | null {
  if (reports === null) return null

  const clauses = groundingNotices(reports).map((notice) => CONSEQUENCES[notice.id])
  if (clauses.length === 0) return null

  const sentence = clauses.join('; ')
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
}
