import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Load `.env` into `process.env` for the main process (Bug #297).
 *
 * **This is the step everything assumed was already happening.** `.env.example` documents
 * `OPENAI_API_KEY` and `IBKR_GATEWAY_URL` without a prefix, ADR-0010 chose that on purpose so the
 * key can never be inlined into a renderer bundle, and `CLAUDE.md` told readers the value "stays
 * in `process.env`". Nothing put it there: electron-vite's `loadEnv` reads only the `VITE_` /
 * `MAIN_VITE_` / `PRELOAD_VITE_` / `RENDERER_VITE_` prefixes, and uses them solely to decide what
 * Vite inlines into the bundles. So an unprefixed variable reached the app only if the operating
 * system already carried it, and an owner who pasted their key into `.env` got an assistant that
 * was permanently `not_configured` with no way to tell why.
 *
 * It is deliberately **not** `dotenv`. The rule in `CLAUDE.md` is to avoid dependencies without
 * clear long-term value, and what is needed here is forty lines with no variable expansion, no
 * multiline values and no `.env.local` cascade — features whose absence is a property worth having
 * in a file that holds a secret.
 *
 * ## Three rules, and the first is the important one
 *
 * **The real environment always wins.** A variable already present in `process.env` is never
 * overwritten. That is what keeps `e2e/assistant-api-key.spec.ts` honest — it passes a key through
 * `electron.launch({ env })`, and a developer's own `.env` must not silently replace the value a
 * test is asserting about. It is also the right precedence for a human: an OS variable is the
 * deliberate, per-session act; the file is the default sitting in a working copy.
 *
 * **A missing file is a no-op, never an error.** A packaged build has no `.env` beside its binary
 * and a fresh CI checkout has none either. Both must start normally — the app already reports a
 * missing key as `not_configured`, which is a state the owner can read (DDR-0096), and turning it
 * into a startup failure would replace a legible state with a crash.
 *
 * **A value is never logged, returned, or put in a message.** {@link loadEnvFile} returns the
 * *names* it set, so a launch can say what it loaded without printing a secret into a log file
 * that may be pasted into an issue.
 */

/**
 * Parse `.env` text into key/value pairs.
 *
 * Pure, so the whole grammar is testable without a filesystem. What it accepts is the intersection
 * of what every `.env` file in the wild looks like:
 *
 * - blank lines and `#` comment lines are skipped;
 * - `export FOO=bar` is accepted, because a file that has been `source`d at some point often keeps
 *   the prefix and silently dropping the value would be the worst outcome;
 * - the key is everything before the **first** `=`, so a value may contain as many as it likes —
 *   which base64-ish secrets frequently do;
 * - one matching pair of surrounding quotes is stripped.
 *
 * What it deliberately does **not** do is expand `${OTHER}` references or strip inline comments.
 * Both are guesses about the *inside* of a value, and this file's values are secrets and URLs: a
 * key containing `#` that arrived truncated would fail authentication with no hint as to why,
 * which is a far worse failure than having to quote a value.
 */
export function parseEnvFile(contents: string): Record<string, string> {
  const parsed: Record<string, string> = {}

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue

    const withoutExport = line.startsWith('export ') ? line.slice('export '.length).trim() : line
    const equals = withoutExport.indexOf('=')
    if (equals <= 0) continue

    const key = withoutExport.slice(0, equals).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue

    parsed[key] = unquote(withoutExport.slice(equals + 1).trim())
  }

  return parsed
}

/** Strip one matching pair of surrounding quotes, and nothing else. */
function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/s.exec(value)
  return quoted ? quoted[2]! : value
}

/**
 * Read `<directory>/.env` and set anything the environment does not already carry.
 *
 * Returns the **names** it set, in file order — never the values. A caller may log the result.
 *
 * `env` is a parameter rather than a hard reference to `process.env` so a test can assert the
 * precedence rule against an object it owns; production passes the real one.
 */
export function loadEnvFile(
  directory: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  let contents: string
  try {
    contents = readFileSync(join(directory, '.env'), 'utf8')
  } catch {
    // Absent, unreadable, or a directory. None of them is a reason not to start: the variables
    // are optional, and every consumer already reports its own absence as a state.
    return []
  }

  const loaded: string[] = []
  for (const [key, value] of Object.entries(parseEnvFile(contents))) {
    // The environment wins. An empty string counts as set — that is a deliberate "unset this"
    // in every shell, and the file must not override the decision.
    if (env[key] !== undefined) continue
    env[key] = value
    loaded.push(key)
  }

  return loaded
}
