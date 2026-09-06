/**
 * The four suggested questions, and how clicking one asks it (Story #348, DDR-0115).
 *
 * The design puts a wrapping row of chips directly above the composer
 * (`figma_design/src/App.tsx:1692-1697`, `2335-2361`), opened by focusing the box or by the toggle
 * beside the send control. What it is *for* is the thing a fresh clone has no other way to learn:
 * which questions this assistant can actually answer. An owner guessing at that finds the edges by
 * hitting them — a benchmark comparison, an annualised return, a tax figure — and every one of
 * those is a question `BASE_CONTEXT` makes the model decline, correctly and unhelpfully.
 *
 * ## The list is the app's own words, and it is a pure module for that reason
 *
 * Nothing here is generated, and nothing here varies with the portfolio, the profile or the
 * conversation. It is four sentences the app says about itself, so it lives where a Node-only suite
 * can read it (DDR-0029) — the same split every other decision in this view takes. What
 * `assistantSuggestions.test.ts` holds is the constraint that makes the list safe rather than
 * merely short:
 *
 * **Each is answerable from a report the app already computes.** `get_position` and
 * `get_allocation` for the largest holding, `get_rebalance_gaps` for the sector distances and the
 * currency concentration, `get_dividend_income` for the income side (DDR-0111, DDR-0112). None asks
 * for a cause, a benchmark, a risk statistic, an annualised figure or tax — the five things
 * `assistantAbsences.ts` states the app does not compute. A suggestion that named one would teach
 * the owner to expect an answer the app is right to refuse.
 *
 * **A suggested question is not a suggested policy.** ADR-0009 forbids the app proposing a target
 * for the owner to set; a question the owner chooses to ask *about* their own stated targets is the
 * opposite of that. Two of the four read against a profile that may be empty, and they still have
 * honest answers there: where the owner has stated nothing the app's own baseline answers and says
 * whose standard it is (ADR-0012, DDR-0109).
 *
 * ## Clicking a chip is not a second way of asking
 *
 * It is the **same form submission** a typed question is, and that is a property of the markup
 * rather than of a promise: each chip is a `type="submit"` `<button>` owned by the composer's form
 * through the `form` attribute, carrying its own text as the submitter's `value`. So `ask` keeps
 * one call site — the form's `onSubmit` — and one set of guards, which is exactly what Story #345
 * built when it routed Enter through `requestSubmit()` rather than calling `ask` directly. A story
 * that adds a check to the composer cannot leave the chips behind, because there is nothing to
 * leave behind.
 *
 * {@link submittedQuestion} is the one piece of that with a decision in it, and it is here rather
 * than in the component for the usual reason: which of two strings a submit event carries is not
 * something a jsdom-free suite could otherwise assert.
 */

/**
 * The four questions, exactly as the design draws them (`figma_design/src/App.tsx:1692-1697`).
 *
 * **Four is the number, and the list is the one place it is decided.** A fifth is a decision about
 * what this app claims it can answer, not a paste — which is the whole argument for a named
 * constant over four literals in a component.
 *
 * They are deliberately not a menu of *periods* (DDR-0102). A suggestion naming one would be fine —
 * free text names periods, that is the point of having no picker — but none of these does, and the
 * row must not grow into the control DDR-0102 removed.
 *
 * **A chip's text is an accessible name, and it collides.** Playwright matches a name by
 * *substring*, so `getByRole('button', { name: 'Dividend income' })` — the profile column's style
 * tag, one column over and in the same panel — matched *"Summarise my dividend income vs. growth
 * balance."* the moment this row shipped, and five e2e specs went to `exact: true` for it. Adding a
 * fifth question means reading the other controls on this view first: the row is four buttons whose
 * names are whole sentences, which is a much larger surface for that collision than anything else
 * the app draws.
 */
export const SUGGESTED_QUESTIONS: readonly string[] = [
  'What is my largest position, and how does it sit against my profile?',
  'Which holdings are furthest from my target sector weights?',
  'Summarise my dividend income vs. growth balance.',
  'Am I over-concentrated in any single currency?',
]

/**
 * What names the row for a screen reader.
 *
 * The chips are four buttons in a row with nothing above them saying what they are, and their own
 * text does not say it — each reads as a question, not as an offer of one. A `role="group"` with
 * this name is the smallest thing that answers "what are these four?", and it is the same name the
 * toggle carries, so the control and what it opens are named alike.
 */
export const SUGGESTIONS_ROW_LABEL = 'Suggested questions'

/**
 * The submitter's `name`, which is how the form tells a chip from the send button.
 *
 * A constant rather than a literal in two files: the component writes it onto four buttons and
 * {@link submittedQuestion} reads it back, and a typo in either half would silently send the typed
 * question instead of the clicked one — which looks exactly like nothing having been clicked.
 */
export const SUGGESTION_FIELD = 'suggestion'

/** The classes a chip wears: #346's own chip, reused a band lower, plus what makes it wrap. */
export const SUGGESTION_CHIP_CLASS = 'assistant-chip assistant-chip-action assistant-suggestion'

/** The class the toggle wears, so its open state has a hook that is not a `variant`. */
export const SUGGESTIONS_TOGGLE_CLASS = 'assistant-suggestions-toggle'

/** What a submit event carries about the control that started it. */
export interface SubmitSource {
  readonly name: string
  readonly value: string
}

/**
 * Which question a submission is for: a chip's own text, or whatever is in the box.
 *
 * `null` is a submission with no submitter at all, which is what `requestSubmit()` produces — the
 * Enter key's path (Story #345). The send button submits with an empty `name`, so it lands in the
 * same branch as Enter and neither needs to know this function exists.
 *
 * The `name` is what is tested rather than the class or the element, because `name` is the only
 * part of a submit button the *platform* treats as its identity, and it is what survives the button
 * being restyled, moved out of the form, or wrapped in a primitive.
 */
export function submittedQuestion(submitter: SubmitSource | null, typed: string): string {
  return submitter !== null && submitter.name === SUGGESTION_FIELD ? submitter.value : typed
}

/**
 * What the box holds once a question has gone: emptied when it is what was asked, kept otherwise.
 *
 * The design clears the box on every send, including a chip's (`sendMessage` sets `input` to `""`
 * unconditionally). That is right for the typed case and wrong for the other one: the row opens
 * when the box takes focus, so a half-written question is exactly what is on screen when a chip is
 * clicked, and discarding it would make the chips a hazard for anyone who opened them by typing.
 *
 * It is not a second path — the submission, the guards and the request are identical either way.
 * What differs is what the *box* is left holding, which is a fact about the box and not about the
 * question, and it is decided here so a Node-only suite can hold it (DDR-0029).
 */
export function boxAfterAsking(typed: string, asked: string): string {
  return asked === typed.trim() ? '' : typed
}
