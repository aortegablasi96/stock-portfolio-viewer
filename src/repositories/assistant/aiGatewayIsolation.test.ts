import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The assistant's key and its gateway stay in the main process (Story #282, ADR-0010, DDR-0096).
 *
 * No module under test — the subject is the **shape of the tree**, in the style of
 * `tabIcons.test.ts` and `profileView.test.ts`. It is a text guard because the thing being
 * protected is a negative: that a secret and an HTTP client are *absent* from two bundles, which
 * nothing in the toolchain will complain about if one day they are not.
 *
 * Three mechanisms already stand between the key and the renderer, and this guards all three
 * rather than trusting any one:
 *
 * 1. **`OPENAI_API_KEY` is unprefixed**, so electron-vite leaves it in `process.env` and never
 *    inlines it. A `RENDERER_VITE_` prefix would ship the secret (ADR-0010) — and would still not
 *    work, because of (3), so the result would be a leaked key attached to a blocked call.
 * 2. **ESLint's layer boundaries** stop the renderer importing `@repositories`. That is enforced
 *    on every run; what it does not stop is a renderer module reading `process.env` by hand.
 * 3. **The renderer's CSP** admits `api.mapbox.com` and nothing else (ADR-0007), so the renderer
 *    could not reach OpenAI even holding the key. This story must not change it.
 */

/**
 * The repository root. `fileURLToPath`, never `URL.pathname`: the latter percent-encodes, and
 * this checkout lives under a path with a space in it — `Andreu%20Ortega` is not a directory.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url))

/**
 * Every `.ts`/`.tsx` file under a directory, tests included — a leak in a test is still a leak.
 *
 * **This file excepted**, and for the reason a text guard always has to strip comments first
 * (DDR-0042, DDR-0047, DDR-0075): a file that searches for a forbidden string necessarily
 * contains it. Caught on the first run, by this very assertion reporting itself. The exception is
 * one named file rather than a pattern, so it cannot quietly widen.
 */
const SELF = fileURLToPath(import.meta.url)

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry) && path !== SELF) out.push(path)
  }
  return out
}

const read = (path: string): string => readFileSync(path, 'utf8')

/**
 * The same file with its comments removed — **the trap this repository has now walked into six
 * times** (DDR-0042, DDR-0047, DDR-0048, DDR-0058, DDR-0070, DDR-0075), and a seventh here: the
 * import guard below reads for the string `aiGateway`, and Story #300's key panel *explains in
 * prose* that the gateway redacts key fragments. A renderer component that names the module in a
 * sentence is the opposite of one that imports it, and the unstripped read could not tell the two
 * apart.
 *
 * Conservative on purpose. Block comments go wholesale; a line comment is dropped only where the
 * line **begins** with `//`, so a `https://` inside a string literal cannot take the rest of its
 * line — and an import, which is what is actually being hunted, always sits on a line of its own.
 */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')
}

describe('the key never reaches the renderer or the preload bridge', () => {
  /**
   * **Reading it, not naming it.** The first version of this guard forbade the string `OPENAI_`
   * anywhere in those trees and immediately caught the one place it belongs: the assistant's
   * "no API key" copy has to say *"add `OPENAI_API_KEY` to the .env file"*, or the state names a
   * problem without naming its fix (Story #283). Naming a variable in prose the owner reads is
   * the opposite of leaking it.
   *
   * So what is forbidden is an **access**, in either of the two forms that could produce one —
   * `process.env` for a variable that survived to runtime, `import.meta.env` for one electron-vite
   * inlined at build time. The value itself never appears in source, so searching for a key-shaped
   * string would be a test that can never fail.
   */
  const READS_THE_KEY = /(?:process\.env|import\.meta\.env)\s*(?:\.\s*OPENAI_|\[\s*['"`]OPENAI_)/

  it.each(['src/renderer', 'src/preload'])('%s reads no OPENAI_ variable', (dir) => {
    const offenders = sourceFiles(join(root, dir)).filter((path) => READS_THE_KEY.test(read(path)))
    expect(offenders).toEqual([])
  })

  /**
   * The other half, and the one a prose exception must not open up: a prefix is what would make
   * electron-vite inline the secret into a shipped bundle, and no prefixed form of the variable
   * has any legitimate use anywhere in the repository (ADR-0010).
   */
  it.each(['src/renderer', 'src/preload', 'src/main', 'src/services', 'src/repositories'])(
    '%s carries no build-inlined form of the key',
    (dir) => {
      const offenders = sourceFiles(join(root, dir)).filter((path) =>
        /(?:RENDERER_VITE|PRELOAD_VITE|MAIN_VITE)_OPENAI/.test(read(path)),
      )
      expect(offenders).toEqual([])
    },
  )

  /**
   * The store the owner's own key lives in, spelled in exactly one place (Story #300, DDR-0105).
   *
   * The story adds a second source for the key, and with it a second way for the value to spread:
   * any module that knows the `app_meta` row can read it straight out of the database, and a
   * renderer module cannot, but a *service* could — and would then be a second place holding key
   * material, a second place to forget the trim, and a second place a fragment could escape from.
   *
   * So the row name is the guard. `aiGateway` exports it and is the only file that spells it;
   * everything else asks the gateway. Phrased as "which files contain this string" rather than as
   * an import rule, because reading `metaRepository.get('openai_api_key')` needs no import of the
   * gateway at all — which is exactly how this would be worked around by accident.
   */
  it('names the key’s storage row in exactly one file', () => {
    const holders = sourceFiles(join(root, 'src'))
      .filter((path) => /'openai_api_key'/.test(code(path)))
      .map((path) => path.slice(root.length).replace(/\\/g, '/'))

    expect(holders).toEqual(['src/repositories/assistant/aiGateway.ts'])
  })

  /** The gateway is main-process code. Nothing outside main and the services may import it. */
  it('is imported only from the main process side of the app', () => {
    const importers = sourceFiles(join(root, 'src'))
      .filter((path) => /aiGateway/.test(code(path)))
      .map((path) => path.slice(root.length).replace(/\\/g, '/'))
      .filter((path) => !path.startsWith('src/repositories/assistant/'))

    for (const path of importers) {
      expect(path.startsWith('src/renderer/'), `${path} must not reach the gateway`).toBe(false)
      expect(path.startsWith('src/preload/'), `${path} must not reach the gateway`).toBe(false)
    }
  })
})

describe('the renderer’s network policy is unchanged', () => {
  /**
   * Comments stripped first — the trap DDR-0042, DDR-0047, DDR-0048, DDR-0058, DDR-0070 and
   * DDR-0075 each record, walked into on the first run of this very file: the markup explains at
   * length that `events.mapbox.com` is omitted **on purpose**, so an unstripped read fails on the
   * sentence saying the origin is absent.
   */
  const html = read(join(root, 'src/renderer/index.html')).replace(/<!--[\s\S]*?-->/g, '')

  /**
   * Pinned as the **whole `connect-src` list**, not as "does not contain openai". A guard phrased
   * as an absence passes for every origin nobody thought to name; this one fails on any addition
   * at all, which is the promise ADR-0007 actually makes.
   *
   * `events.mapbox.com` stays omitted on purpose, so the platform blocks Mapbox telemetry however
   * the library is configured.
   */
  it('still admits exactly one external origin', () => {
    expect(html).toContain("connect-src 'self' https://api.mapbox.com")
    expect(html).not.toContain('openai')
    expect(html).not.toContain('events.mapbox.com')
  })

  /**
   * The CSP is why a leaked key would still be a blocked call, so its absence is worth failing on
   * as loudly as a bad value: a deleted meta tag is a passing "does not contain openai" test.
   */
  it('still declares a CSP at all', () => {
    expect(html).toContain('http-equiv="Content-Security-Policy"')
  })
})

describe('.env.example documents the key as unprefixed', () => {
  const env = read(join(root, '.env.example'))

  it('names all three variables', () => {
    for (const name of ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_TIMEOUT_MS']) {
      expect(env).toContain(name)
    }
  })

  /**
   * The prefix is the whole mechanism, so the file has to say why rather than merely omit one —
   * an unprefixed variable looks like an oversight to the next person adding a setting.
   */
  it('says the key is unprefixed on purpose', () => {
    expect(env).toContain('DELIBERATELY UNPREFIXED')
    expect(env).not.toContain('RENDERER_VITE_OPENAI')
  })
})
