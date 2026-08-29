import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Zod never reaches the renderer or the preload bundle (ADR-0002, `CLAUDE.md`).
 *
 * No module under test — the subject is the **shape of the import graph**, in the style of
 * `aiGatewayIsolation.test.ts` and `tabIcons.test.ts`. It guards a rule that has been stated
 * everywhere and enforced nowhere: `contract.ts` says it in its own header ("the renderer and
 * preload import only the *types* from this module (erased at compile time), so Zod never reaches
 * the renderer bundle"), the four-file IPC recipe repeats it, and until now the only thing holding
 * it was that every author happened to write `import type`.
 *
 * **It was broken the first time a story needed a shared constant at runtime** (Story #300,
 * DDR-0105). `MAX_API_KEY_CHARS` was declared in `@shared/domain/assistant` beside the schemas
 * that use it, which reads naturally; the renderer imports it to cap the key field's `maxLength`,
 * which is a *value*, so the whole module — Zod included — was pulled into the bundle. Nothing
 * failed. Lint passed, typecheck passed, 1,986 tests passed, the build passed, and 138 e2e specs
 * passed. The only symptom was one line of Vite output during a manual launch:
 * `new dependencies optimized: zod`.
 *
 * That is precisely the class of regression a structural test exists for: invisible to every other
 * gate, and permanent once shipped.
 *
 * The fix is a rule, not a lint exception: **a constant the renderer needs at runtime does not
 * live in a module that imports Zod.** `@shared/domain/assistantKey` is where that one went;
 * `assistantDisclosure` and `investorProfileTerms` are the same shape and predate it.
 */

/**
 * The repository root. `fileURLToPath`, never `URL.pathname`: the latter percent-encodes, and this
 * checkout lives under a path with a space in it — `Andreu%20Ortega` is not a directory.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url))

/**
 * Every `.ts`/`.tsx` file under a directory that is **shipped** — tests excluded.
 *
 * The exclusion is the rule, not a loophole: the invariant is about a *bundle*, and Vitest files
 * are never in one. Two of them import a schema on purpose — `assistantAsk.test.ts` parses an
 * `aiResultSchema` and `chartTooltip.test.ts` a `compositionBandSchema`, both to assert against
 * the real shape rather than a copy of it, which is exactly what a test should do. Failing those
 * would push a correct test toward a hand-written duplicate of the shape it is checking.
 *
 * It is `.test.` specifically, rather than anything looser, so the exclusion cannot quietly widen
 * into "files that happen to look like helpers".
 */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path)
  }
  return out
}

/**
 * A file's **code**, with its comments removed — the trap this repository keeps walking into
 * (DDR-0042, DDR-0047, DDR-0048, DDR-0058, DDR-0070, DDR-0075, DDR-0105), and one this very file
 * hit on its first run: `assistantKey.ts` explains *in prose* that it exists because
 * `import { z } from 'zod'` sits at the top of its neighbour, and the unstripped read then
 * reported the dependency-free module as importing Zod.
 *
 * Conservative on purpose. Block comments go wholesale; a line comment is dropped only where the
 * line **begins** with `//`, so a `https://` inside a string cannot take the rest of its line —
 * and an import always sits on a line of its own.
 */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')
}

/** Whether a module pulls Zod in when it is evaluated. */
function importsZod(path: string): boolean {
  return /from ['"]zod['"]/.test(code(path))
}

/**
 * Every `@shared/...` specifier a file imports **at runtime**, with the type-only ones removed.
 *
 * Two forms are erased at compile time and neither counts:
 *
 * - `import type { A, B } from '…'` — the whole statement;
 * - `import { type A, type B } from '…'` — every specifier individually, which TypeScript also
 *   erases entirely. A statement mixing the two (`import { VALUE, type T }`) **does** count, and
 *   that mixed form is exactly what broke the rule, so it is the case worth getting right.
 */
function runtimeSharedImports(source: string): string[] {
  const specifiers: string[] = []

  // The clause may span lines — most real ones here do — but it may contain **no brace and no
  // quote**. Written lazily and without those exclusions, the first version matched from one
  // statement's `{` across two intervening lines to a *later* statement's specifier, and reported
  // `periodSet.ts` (whose only shared import is `import type`) as a runtime importer. A guard
  // that names innocent files is one whose next real finding gets waved through.
  for (const match of source.matchAll(
    /^import\s+(type\s+)?(\{[^{}'"]*\}|[\w*\s,]+?)\s+from\s+['"](@shared\/[^'"]+)['"]/gm,
  )) {
    const [, typeOnly, clause, specifier] = match
    if (typeOnly !== undefined) continue

    const braced = clause?.startsWith('{') === true
    if (braced) {
      const names = clause!
        .slice(1, -1)
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== '')
      // Every name written `type X` is erased; a statement of nothing but those imports nothing.
      if (names.every((name) => /^type\s/.test(name))) continue
    }

    specifiers.push(specifier!)
  }

  return specifiers
}

/** `@shared/domain/x` → the file it resolves to. The alias has exactly one root. */
function resolveShared(specifier: string): string {
  return join(root, 'src', 'shared', `${specifier.slice('@shared/'.length)}.ts`)
}

describe.each(['src/renderer', 'src/preload'])('%s never pulls Zod into its bundle', (dir) => {
  const files = sourceFiles(join(root, dir))

  /**
   * The guard itself. Reported as the offending pairs rather than a count, because the fix depends
   * on *which* constant is being reached for: it moves to a dependency-free module, and knowing
   * which one is half the work.
   */
  it('imports no runtime value from a module that imports Zod', () => {
    const offenders = files.flatMap((path) =>
      runtimeSharedImports(code(path))
        .filter((specifier) => importsZod(resolveShared(specifier)))
        .map((specifier) => `${path.slice(root.length).replace(/\\/g, '/')} → ${specifier}`),
    )

    expect(offenders).toEqual([])
  })

  /** The blunt half: nothing on that side may name the package directly either. */
  it('imports Zod from nowhere at all', () => {
    const offenders = files
      .filter((path) => importsZod(path))
      .map((path) => path.slice(root.length).replace(/\\/g, '/'))

    expect(offenders).toEqual([])
  })
})

/**
 * The detector's own blind spots, pinned — a guard whose parser is wrong is worse than none, and
 * the mixed `{ VALUE, type T }` form is the one that actually shipped.
 */
describe('what counts as a runtime import', () => {
  it.each([
    ["import type { A } from '@shared/domain/assistant'", []],
    ["import { type A, type B } from '@shared/domain/assistant'", []],
    ["import { VALUE } from '@shared/domain/assistant'", ['@shared/domain/assistant']],
    ["import { VALUE, type A } from '@shared/domain/assistant'", ['@shared/domain/assistant']],
    ["import { A } from '@shared/ipc/channels'", ['@shared/ipc/channels']],
  ])('reads %s as %j', (source, expected) => {
    expect(runtimeSharedImports(source)).toEqual(expected)
  })

  /** A multi-line clause is the shape almost every real import in this codebase takes. */
  it('reads a multi-line type-only clause as importing nothing', () => {
    const source = [
      'import {',
      '  type AllocationReport,',
      '  type AllocationResult,',
      "} from '@shared/domain/allocation'",
    ].join('\n')

    expect(runtimeSharedImports(source)).toEqual([])
  })

  it('reads a multi-line clause with one value in it as a runtime import', () => {
    const source = [
      'import {',
      '  DISCLOSURE_CATEGORIES,',
      '  type AssistantContext,',
      "} from '@shared/domain/assistantDisclosure'",
    ].join('\n')

    expect(runtimeSharedImports(source)).toEqual(['@shared/domain/assistantDisclosure'])
  })

  /**
   * And the guard is only worth anything if it can see a violation. This is the exact import that
   * shipped, resolved against the real tree: `@shared/domain/assistant` must still import Zod, or
   * the test above passes because its subject moved rather than because the rule holds.
   */
  it('would still catch the import that broke the rule', () => {
    expect(importsZod(resolveShared('@shared/domain/assistant'))).toBe(true)
    expect(importsZod(resolveShared('@shared/domain/assistantKey'))).toBe(false)
  })
})
