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

/** Every `.ts`/`.tsx` file under a directory, tests included — a leak in a test is still a leak. */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry)) out.push(path)
  }
  return out
}

const read = (path: string): string => readFileSync(path, 'utf8')

describe('the key never reaches the renderer or the preload bridge', () => {
  /**
   * The renderer bundle is shipped to disk and the preload bundle runs in the sandbox; neither
   * has any business naming the variable, let alone reading it. Asserted on the **variable name**
   * rather than on a key-shaped string, because the name is what a mistaken `RENDERER_VITE_`
   * prefix or a stray `process.env` read would put there — the value never appears in source at
   * all, so searching for one would be a test that can never fail.
   */
  it.each(['src/renderer', 'src/preload'])('%s mentions no OPENAI_ variable', (dir) => {
    const offenders = sourceFiles(join(root, dir)).filter((path) => /\bOPENAI_/.test(read(path)))
    expect(offenders).toEqual([])
  })

  /** The gateway is main-process code. Nothing outside main and the services may import it. */
  it('is imported only from the main process side of the app', () => {
    const importers = sourceFiles(join(root, 'src'))
      .filter((path) => /aiGateway/.test(read(path)))
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
