/**
 * The API key's one shared constant, with **no dependencies** (Story #300, DDR-0105).
 *
 * It sits in its own module for the reason `assistantDisclosure.ts` does, and the reason is a
 * mistake this story made and had to undo. `MAX_API_KEY_CHARS` began life in
 * `@shared/domain/assistant`, beside the schemas that use it — which reads naturally and is wrong:
 * that module opens with `import { z } from 'zod'`, and the renderer needs this value at
 * **runtime**, to cap the key field's `maxLength`.
 *
 * Every other renderer import from a schema module is `import type`, so Zod is erased at compile
 * time and never reaches the bundle (ADR-0002, and `CLAUDE.md`'s "renderer and preload import
 * types only"). One value import breaks that for the whole module graph, silently — the only
 * symptom was Vite announcing `new dependencies optimized: zod` while the app was being launched
 * for review.
 *
 * So the rule this file exists to keep: **a constant the renderer needs at runtime does not live
 * in a module that imports Zod.** `zodIsolation.test.ts` now fails when one does.
 */

/**
 * The longest key the app will accept, store, or carry across IPC.
 *
 * Not a format check — the app never validates that a key is OpenAI-shaped, because
 * `OPENAI_BASE_URL` can point the gateway at a compatible endpoint whose credentials look like
 * something else. This is only the bound that stops a paste of a whole file being written into
 * `app_meta`, in the same register as `MAX_QUESTION_CHARS`.
 */
export const MAX_API_KEY_CHARS = 512
