import type { AssistantStatus } from '@shared/domain/assistant'
import { MAX_API_KEY_CHARS } from '@shared/domain/assistantKey'

/**
 * The wording of the API key surface (Story #300, DDR-0105; reshaped by Story #309, ADR-0011).
 *
 * Here rather than in the component for the reason everything in `lib/` is here: Vitest runs
 * Node-only with no jsdom (DDR-0029), so a string inside a component is a string nothing can
 * assert — and the strings *are* the feature here.
 *
 * **#300's four panel kinds are two, and one of them draws nothing.** The key is now the whole of
 * the setup: it is shown when there is no working key and not shown once there is one, with no
 * activate, deactivate or rotate (ADR-0011). `stored` and `environment` therefore have nothing to
 * say — the assistant is running, and the page is the chat — so the heading, body and label they
 * each carried collapse to the one state that still asks the owner for something.
 *
 * **The exception is a saved key the environment shadows**, and it is the one rule that survived
 * intact. The order between the two sources is *reported, never silent* (DDR-0105): an owner who
 * saved a key and later exported `OPENAI_API_KEY` would otherwise watch their key be quietly
 * ignored. That is a sentence, not a control — there is nothing here to press.
 */

/** What the view draws about the key: the field, a note about precedence, or nothing at all. */
export type KeySurface = 'field' | 'shadowed' | 'none'

/**
 * Which of the three applies.
 *
 * `state` is read rather than `keySource !== 'none'` being re-derived: the service already names
 * the fact, and a view computing its own copy of it is the second definition that drifts.
 */
export function keySurface(status: AssistantStatus): KeySurface {
  if (status.state === 'not_configured') return 'field'
  return status.keySource === 'environment' && status.keyStored ? 'shadowed' : 'none'
}

/** The heading over the field. One state, so one string. */
export const KEY_HEADING = 'No OpenAI API key'

/**
 * The body above the field.
 *
 * It names what supplying the key *does*, because after ADR-0011 that is the whole of the
 * authorization: there is no separate decision to send, and pasting a key is the act that starts
 * questions going to OpenAI. Saying it here is the app's remaining statement of the fact, and the
 * ADR accepts the loss of the panel that used to say it at length.
 */
export const KEY_BODY =
  'Paste an OpenAI key below to use the assistant. It is kept on this computer, and from then on the questions you ask are sent to OpenAI with the figures they are grounded in. Setting OPENAI_API_KEY in your environment or your .env file works too, and takes precedence over a key saved here.'

/**
 * Where the key is kept, stated on the panel that asks for it.
 *
 * The app's database is not encrypted — no table in it is — and neither is `.env`, so storing a
 * key here is no worse than the two places it could already live. That is a fair claim and a
 * *checkable* one, which is why it is on screen rather than only in the record.
 */
export const KEY_STORAGE_NOTE =
  'Saved in this app’s local database on this computer, unencrypted, like everything else it stores. It is never shown again once saved, and never sent anywhere except to OpenAI as the credential on a question you ask.'

/**
 * The one thing said about a key that is present: that the environment's is winning.
 *
 * It names the variable and what to do, and offers nothing to press — removing the saved key is
 * not something this app does any more (ADR-0011).
 */
export const KEY_SHADOWED_NOTE =
  'OPENAI_API_KEY is set in your environment or your .env file, and that takes precedence over the key you saved here. Your saved key is kept and is not being used. Remove OPENAI_API_KEY and restart the app to use it instead.'

/** The label the save control carries. There is no replacement, so it never claims to be one. */
export function saveKeyLabel(busy: boolean): string {
  return busy ? 'Saving…' : 'Save key'
}

/**
 * Whether the typed value is worth sending.
 *
 * Deliberately only "not blank and not absurdly long" — the same shape `isAskable` has. Everything
 * else about a key is `apiKeyService.describeKeyProblem`'s to say, in main, once, with wording the
 * owner can act on; duplicating the character rule here would be two rules for one fact, and the
 * one the owner hit would depend on which check ran first.
 */
export function isSavableKey(value: string): boolean {
  const key = value.trim()
  return key.length > 0 && key.length <= MAX_API_KEY_CHARS
}
