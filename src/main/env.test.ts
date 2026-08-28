import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadEnvFile, parseEnvFile } from './env'

/**
 * `.env` reaching `process.env` (Bug #297).
 *
 * **This suite exists because two tests already looked like they covered this and did not.**
 * `e2e/assistant-consent.spec.ts` passes the key through `electron.launch({ env })` and
 * `ibkrGateway.test.ts` writes `process.env` directly — both exercise a variable being *read*,
 * neither exercises one being *loaded*. The gap let an unprefixed variable be documented in
 * `.env.example`, chosen deliberately in ADR-0010, described in `CLAUDE.md`, and never actually
 * delivered to the running app.
 *
 * So every test below goes through a **real file on disk**. Parsing is asserted separately because
 * the grammar is where the surprises are, but nothing here mocks the read: the defect was in the
 * step between the file and the environment, and a mock at that seam would have passed while the
 * app stayed broken.
 */

/** A throwaway directory with a `.env` in it. */
function envDir(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'spv-env-'))
  writeFileSync(join(dir, '.env'), contents, 'utf8')
  return dir
}

describe('parseEnvFile', () => {
  it('reads plain assignments', () => {
    expect(parseEnvFile('FOO=bar\nBAZ=qux')).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  it('skips blank lines and comments', () => {
    expect(parseEnvFile('\n# a comment\n\nFOO=bar\n   # indented\n')).toEqual({ FOO: 'bar' })
  })

  it('accepts a leading export, rather than dropping the value', () => {
    expect(parseEnvFile('export FOO=bar')).toEqual({ FOO: 'bar' })
  })

  it('strips one matching pair of surrounding quotes', () => {
    expect(parseEnvFile('A="bar"\nB=\'baz\'\nC="mixed\'')).toEqual({
      A: 'bar',
      B: 'baz',
      C: '"mixed\'',
    })
  })

  /**
   * The key is everything before the **first** `=`. A secret is frequently base64-ish and carries
   * its own, and splitting on the last one (or on every one) would hand the gateway a truncated
   * key that fails authentication with no hint as to why.
   */
  it('keeps every equals sign after the first inside the value', () => {
    expect(parseEnvFile('OPENAI_API_KEY=sk-a=b==c')).toEqual({ OPENAI_API_KEY: 'sk-a=b==c' })
  })

  /**
   * No inline-comment stripping and no `${}` expansion, both deliberately. They are guesses about
   * the inside of a value, and these values are secrets and URLs.
   */
  it('leaves the inside of a value alone', () => {
    expect(parseEnvFile('K=abc#def\nU=https://h/p?x=1#frag')).toEqual({
      K: 'abc#def',
      U: 'https://h/p?x=1#frag',
    })
    expect(parseEnvFile('K=${OTHER}')).toEqual({ K: '${OTHER}' })
  })

  it('ignores a line that is not an assignment, and a key that is not a name', () => {
    expect(parseEnvFile('just a line\n=novalue\n9BAD=x\nWITH SPACE=x\nOK=1')).toEqual({ OK: '1' })
  })

  it('keeps an explicitly empty value', () => {
    expect(parseEnvFile('EMPTY=')).toEqual({ EMPTY: '' })
  })
})

describe('loadEnvFile', () => {
  /** The whole point of the bug: an unprefixed variable in the file reaches the environment. */
  it('sets an unprefixed variable from the file', () => {
    const env: NodeJS.ProcessEnv = {}
    const loaded = loadEnvFile(envDir('OPENAI_API_KEY=sk-from-file\nIBKR_GATEWAY_URL=https://h:1'), env)

    expect(env['OPENAI_API_KEY']).toBe('sk-from-file')
    expect(env['IBKR_GATEWAY_URL']).toBe('https://h:1')
    expect(loaded).toEqual(['OPENAI_API_KEY', 'IBKR_GATEWAY_URL'])
  })

  /**
   * The precedence rule, and the one with teeth. `e2e/assistant-consent.spec.ts` passes a key
   * through `electron.launch({ env })`; a developer's own `.env` overriding it would make that
   * suite assert against a value it never chose. It is also the right order for a human: an OS
   * variable is a deliberate act, the file is a default sitting in a working copy.
   */
  it('never overwrites a variable the environment already carries', () => {
    const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'sk-from-os' }
    const loaded = loadEnvFile(envDir('OPENAI_API_KEY=sk-from-file\nOTHER=x'), env)

    expect(env['OPENAI_API_KEY']).toBe('sk-from-os')
    expect(loaded).toEqual(['OTHER'])
  })

  /** An empty string is a shell's way of saying "unset this". The file must not undo it. */
  it('treats an empty environment value as set', () => {
    const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: '' }
    loadEnvFile(envDir('OPENAI_API_KEY=sk-from-file'), env)

    expect(env['OPENAI_API_KEY']).toBe('')
  })

  /**
   * A packaged build has no `.env` beside its binary and a fresh CI checkout has none either.
   * Both must start: a missing key is already a state the owner can read (DDR-0096), and turning
   * it into a startup failure would replace a legible state with a crash.
   */
  it('is a no-op when there is no file, rather than an error', () => {
    const env: NodeJS.ProcessEnv = {}
    const empty = mkdtempSync(join(tmpdir(), 'spv-env-none-'))

    expect(loadEnvFile(empty, env)).toEqual([])
    expect(env).toEqual({})
  })

  /** Names, never values: a launch log may be pasted into an issue. */
  it('reports the names it set and never the values', () => {
    const loaded = loadEnvFile(envDir('OPENAI_API_KEY=sk-secret-value'), {})
    expect(loaded.join(' ')).not.toContain('sk-secret-value')
  })
})

/**
 * The wiring, which is the half a unit test cannot reach.
 *
 * `loadEnvFile` being correct is worth nothing if `main/index.ts` stops calling it, or calls it
 * after something has already read `process.env`. Vitest runs Node-only with no Electron, so the
 * entry point cannot be imported — this reads it as text, the way several `lib/*.test.ts` guards
 * read `app.css` and the components.
 */
describe('main/index.ts loads the file before anything reads it', () => {
  const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')

  it('calls loadEnvFile', () => {
    expect(source).toContain('loadEnvFile(app.getAppPath())')
  })

  /**
   * Above the single-instance lock and above every other statement. The lock's own rule is that
   * the losing process quits without migrating, capturing or opening the database (DDR-0025);
   * reading one text file is none of those, and doing it here means a consumer that stops reading
   * its variable lazily still finds it.
   */
  it('does so before the single-instance lock and before the first service call', () => {
    const load = source.indexOf('loadEnvFile(app.getAppPath())')
    const lock = source.indexOf('app.requestSingleInstanceLock()')
    const migrations = source.indexOf('runMigrations()')

    expect(load).toBeGreaterThan(-1)
    expect(load).toBeLessThan(lock)
    expect(load).toBeLessThan(migrations)
  })

  /**
   * The log line is built from the returned **names**. A value in it would defeat the point of
   * the file, and a launch log is exactly the thing that gets pasted into an issue.
   */
  it('logs only the names it loaded', () => {
    const logLine = /console\.log\(`\[env\][^`]*`\)/.exec(source)?.[0] ?? ''
    expect(logLine).toContain('loadedFromEnvFile')
    // Nothing that could resolve to a value: not the environment, not the parsed map.
    expect(logLine).not.toContain('process.env')
    expect(logLine).not.toMatch(/\bvalue/i)
  })
})
