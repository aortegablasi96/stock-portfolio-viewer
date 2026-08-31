import { APP_LOCALE } from '@shared/format'
import { aiGateway } from '@repositories/assistant/aiGateway'
import { MAX_API_KEY_CHARS } from '@shared/domain/assistantKey'

/**
 * The owner's own OpenAI key, set from inside the app (Story #300, DDR-0105).
 *
 * **The store is not here.** The key is read, written and used in exactly one module —
 * `aiGateway` — and this service is the rule about what may go into it. Keeping the material in the
 * module that spends it is what makes "the key exists in one place" a property a test can point at
 * rather than a habit: `aiGatewayIsolation.test.ts` fails if `'openai_api_key'` is spelled in a
 * second file.
 *
 * **There is no `clear`** (Story #309, ADR-0011). #300 had one behind a Remove control beside the
 * field; the field is now shown only when there is no working key, so there is no activate,
 * deactivate or rotate, and a service method reachable over IPC would be that control under another
 * name. `aiGateway.clearStoredKey` stays where it is — the store's own lifecycle, and what a future
 * rotate would build on.
 *
 * What is left here is validation, and it is small on purpose. **There is no format check.** A key
 * is opaque, and `OPENAI_BASE_URL` can point the gateway at a compatible endpoint whose
 * credentials are shaped differently, so asserting a `sk-` prefix would reject a working setup to
 * catch a typo the provider reports better anyway — as `refused`, in the provider's own words
 * (DDR-0096).
 */

/**
 * What is wrong with a pasted key, or `null` when nothing is.
 *
 * Pure, so the rule is testable without a store, and exported so the wording is asserted rather
 * than inspected.
 *
 * The character rule is the one worth reading. After trimming, anything outside printable ASCII is
 * refused: a space, a tab, a newline, a smart quote a document viewer substituted. Every one of
 * those is a paste accident rather than a key, and a control character in particular would make
 * `node:http` **throw** on `Authorization: Bearer …` — turning a bad paste into an exception in
 * the one module whose whole design is that every outcome is a state (DDR-0022, DDR-0096). Refusing
 * it here keeps that promise intact and tells the owner what to fix.
 */
export function describeKeyProblem(raw: string): string | null {
  const key = raw.trim()

  if (key === '') return 'Paste a key before saving.'
  if (key.length > MAX_API_KEY_CHARS) {
    return `That is longer than ${MAX_API_KEY_CHARS.toLocaleString(APP_LOCALE)} characters, which is longer than any API key. Check what was pasted.`
  }
  if (/[^\x21-\x7e]/.test(key)) {
    return 'That contains a space or a character an API key cannot hold. Paste the key on its own, with nothing around it.'
  }

  return null
}

export type SaveKeyOutcome = { status: 'saved' } | { status: 'invalid'; message: string }

export const apiKeyService = {
  /**
   * Store the key, or report what is wrong with it.
   *
   * Nothing about the value is echoed back — not the key, not its length, not a fragment. The
   * caller learns that it was saved and reads {@link aiGateway.keySource} for what is now in force.
   */
  save(raw: string): SaveKeyOutcome {
    const problem = describeKeyProblem(raw)
    if (problem !== null) return { status: 'invalid', message: problem }

    aiGateway.storeKey(raw.trim())
    return { status: 'saved' }
  },
}
