import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The `CLAUDE.md` session budget.
 *
 * There is no module under test here. `CLAUDE.md` is loaded into every Claude Code session, so
 * its size is paid before any work starts — which makes it the one file in the repo whose *cost*
 * is worth pinning rather than its contents.
 *
 * It declared a ceiling from the start and nothing enforced it. Nine consecutive stories landed
 * within 30 bytes of the old 36 KB limit, then six more sailed past it unnoticed (36,860 →
 * 38,965) because the only thing holding the line was a sentence asking the next reader to
 * remember. Every other invariant in this repo is a test that fails loudly; this is that test.
 *
 * When it fails, read the budget note at the top of `CLAUDE.md` before reaching for the number.
 * The cheap bytes are the ones restating something a machine already knows — `package.json`, a
 * directory listing — not the traps, each of which stands in for a 15 KB DDR.
 */

/** Matches `wc -c CLAUDE.md`. `.gitattributes` pins `eol=lf`, so this is stable across platforms. */
const CLAUDE_MD = readFileSync(join(process.cwd(), 'CLAUDE.md'))

/** 44 KB. Raised once from 36864, deliberately — see the budget note in the file itself. */
const BUDGET_BYTES = 45056

describe('CLAUDE.md session budget', () => {
  it('stays within the budget', () => {
    expect(CLAUDE_MD.byteLength).toBeLessThanOrEqual(BUDGET_BYTES)
  })

  it('states the budget it is actually held to', () => {
    // The prose and this test are one decision; a raised ceiling that updates only the number
    // here leaves the file telling the next session something false.
    const text = CLAUDE_MD.toString('utf8')
    expect(text).toContain(`≤ ${BUDGET_BYTES}`)
    expect(text).toContain('src/claudeMdBudget.test.ts')
  })
})
