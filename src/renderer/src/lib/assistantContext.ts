import type { AssistantContext } from '@shared/domain/assistantDisclosure'
import type { AllocationResult } from '@shared/domain/allocation'
import type { PerformanceResult } from '@shared/domain/performance'
import type { BalanceDriftResult } from '@shared/domain/balanceDrift'
import { isProfileEmpty, type InvestorProfile } from '@shared/domain/investorProfileTerms'

/**
 * What the assistant is given without being asked (Story #284, DDR-0098; emptied by Story #327).
 *
 * **The model never produces a figure** (ADR-0009). That sentence is only true if something else
 * produces every one of them, and this module used to be the whole of that something: holdings,
 * weights, the profile, the drift and a period explained, assembled here and sent with every
 * question whatever was asked.
 *
 * **Every one of those sections is a tool now, and this assembles nothing** (Epic #322, DDR-0111).
 * #326 moved the live book, the allocation, the investor profile and the rebalancing gaps into
 * `services/assistant/toolReports.ts`; #327 moved the performance history into
 * `services/assistant/performanceReports.ts`, behind four tools that each return one slice of it.
 * The prose was **moved rather than copied** every time, so there is still exactly one
 * implementation of how this app writes a weight or a return — which is the property DDR-0098's
 * criterion is actually about — and the arithmetic those sections were built on moved to
 * `@shared/domain/standardPeriods`, where main can reach it.
 *
 * ## Why an empty assembly is still assembled
 *
 * `buildAssistantContext` returns `{}` and the mechanism around it is untouched, which is a decision
 * rather than a leftover. `AssistantContext` is keyed by `DISCLOSURE_CATEGORIES`' own ids and
 * `pickDisclosedSections` drops an undeclared key at the IPC boundary — *"an undeclared section
 * cannot be sent"* (DDR-0098, ADR-0011). That is the guard on everything the **renderer** may put in
 * front of the model, and a story that wanted to send a section again would meet it. Deleting it
 * because nothing currently crosses would make the Epic's own criterion vacuous rather than met, and
 * removing `lib/assistantContext.ts` is explicitly not this story's to decide (Epic #322, *Not
 * Included*).
 *
 * What the tools cannot be trusted to carry rides in `BASE_CONTEXT` instead, above every question
 * and whether or not a single report was fetched (Story #325, DDR-0111 decision 6): the absences,
 * the two stores and their two clocks, and ADR-0012's framing. A tool the model may decline to call
 * is not a statement before any figure.
 *
 * It is a pure module for the reason everything in `lib/` is one — Vitest runs Node-only with no
 * jsdom (DDR-0029), so a string built inside a component is a string nothing can assert.
 */

/**
 * What a view has read, in whatever state each read came back in.
 *
 * **Still all four, and none of them builds a section any more**: `askGate` asks whether there is
 * anything at all to ground an answer in, and `groundingNotices` names each gap beside the box — a
 * missing import, an unset profile, a gateway that is not answering. Those are questions about what
 * the *app* can see, and a tool the model may or may not call cannot answer them before a question
 * is typed.
 */
export interface GroundingReports {
  /** Composition from imported Flex history — `needs_import` when the store is empty. */
  allocation: AllocationResult
  /** The owner's own policy. The empty profile when they have never written one. */
  profile: InvestorProfile
  /** How far the live portfolio sits from that policy, or which blocker is in the way. */
  drift: BalanceDriftResult
  /** The performance history the model's period tools read — `needs_import` with no Flex data. */
  performance: PerformanceResult
}

/**
 * Assemble the context: the disclosure's own keys, and **none of them** (Story #327).
 *
 * The keys are the disclosure's ids and nothing else can be added here — `AssistantContext` forbids
 * it at compile time, and the IPC boundary drops it at runtime. What changed across Epic #322 is how
 * many are populated, and the answer is now zero: sending a figure here as well as behind a tool
 * would put it in front of the model twice and spend the round budget the tools need, which is the
 * whole trade the Epic made.
 *
 * **It takes no reports any more**, which is the honest signature: it has nothing left to read one
 * for. {@link GroundingReports} stays, and stays this module's, because the reports themselves stay
 * — they decide whether a question may be asked at all (`askGate`) and what the view says the
 * assistant cannot see (`groundingNotices`), neither of which a tool the model may decline to call
 * could answer before a question is typed.
 */
export function buildAssistantContext(): AssistantContext {
  return {}
}

/** Whether the owner has stated any policy at all — what the view's "no profile" notice asks. */
export function hasProfile(profile: InvestorProfile): boolean {
  return !isProfileEmpty(profile)
}
