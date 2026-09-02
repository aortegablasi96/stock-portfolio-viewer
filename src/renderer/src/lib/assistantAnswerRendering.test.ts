import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { stripComments } from './cssDeclarations'
import { isFigureSelector } from './figureRole'

/**
 * How a formatted answer is drawn, and the one rule it may never break (Story #321, DDR-0114).
 *
 * No module under test. `assistantMarkdown.test.ts` owns the parse; this file owns the half that
 * lives in a component and a stylesheet, which a Node-only suite can only read as text (DDR-0029).
 * Three things are pinned here and each fails for its own reason.
 *
 * **The answer never reaches `innerHTML`.** That is asserted over the whole of `src/` rather than
 * over this component, because the risk is not that someone rewrites `AssistantAnswer` — it is that
 * a later story reaches for the same shortcut two directories away, on a string that came from the
 * same place. There is no sanitiser in this app and no reason to acquire one.
 *
 * **Every block the parser can produce has a branch that draws it.** A block kind added without a
 * branch renders as nothing at all, which is a silently shortened answer — the failure mode this
 * whole story is against.
 *
 * **Every class and element the component emits has a rule.** A text scan is the only thing that
 * can see an orphaned selector, and DDR-0075's trap applies: comments are stripped first, because
 * `app.css` quotes its own class names in prose.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

const CSS = stripComments(readFileSync(new URL('../app.css', import.meta.url), 'utf8'))
const RAW_CSS = readFileSync(new URL('../app.css', import.meta.url), 'utf8')
const ANSWER = code(readFileSync(new URL('../components/AssistantAnswer.tsx', import.meta.url), 'utf8'))
const CONVERSATION = code(
  readFileSync(new URL('../components/AssistantConversation.tsx', import.meta.url), 'utf8'),
)
const PARSER = readFileSync(new URL('./assistantMarkdown.ts', import.meta.url), 'utf8')

/**
 * A source file with its prose removed.
 *
 * Both directions of DDR-0075's trap bite in this file. A *positive* assertion can pass off a
 * comment quoting the string it looks for; a *negative* one — the escape hatch below — fails
 * because the components explain in prose why they do not use it. Stripping first is what makes
 * either assertion about the code.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')
}

/** Every `.ts`/`.tsx` file under `src/`, tests included — a shortcut in a test is still a shortcut. */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry)) out.push(path)
  }
  return out
}

/**
 * Every declaration block whose selector list contains `selector`.
 *
 * Plural because one selector legitimately appears in two rules: `.assistant-answer code` is in the
 * figure role for its family and in its own rule for the chip. A helper returning the first match
 * would assert against whichever came earlier in the file, which is not a fact about the design.
 */
function rules(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(^|,)\\s*${escaped}\\s*(,[^{]*)?\\{([^}]*)\\}`, 'gm')
  return [...CSS.matchAll(pattern)].map((match) => match[3]!)
}

/** Whether any rule for `selector` declares what `pattern` describes. */
function declares(selector: string, pattern: RegExp): boolean {
  return rules(selector).some((block) => pattern.test(block))
}

describe('model output never becomes markup', () => {
  it('names React’s innerHTML escape hatch nowhere in src/', () => {
    // Assembled rather than written, so this file is not its own first offender.
    const hatch = `dangerously${'SetInnerHTML'}`
    const offenders = sourceFiles(join(ROOT, 'src')).filter((path) =>
      code(readFileSync(path, 'utf8')).includes(hatch),
    )
    expect(offenders.map((path) => path.slice(ROOT.length))).toEqual([])
  })

  it('passes the answer through the parser rather than into the DOM', () => {
    expect(ANSWER).toContain('parseAnswer(text)')
    // Every child below is a string or an element the switch chose. A `ref` here would be the other
    // way to reach the DOM, and there is no reason for one in a component that renders a tree.
    expect(ANSWER).not.toMatch(/\bref=|innerHTML|createElement\(/)
  })

  it('renders a link as text, since the app has no policy for opening one (ADR-0010)', () => {
    expect(ANSWER).not.toMatch(/<a[\s>]/)
    expect(ANSWER).not.toContain('href')
    // The parser is where a link becomes its label and its URL, and it never emits a mark for one.
    expect(PARSER).toContain("Mark = 'strong' | 'em' | 'code' | 'strike'")
  })
})

describe('the component draws every block the parser can produce', () => {
  /** The `kind` of every variant in the `Block` union, read off the parser's own declaration. */
  const KINDS = [...PARSER.matchAll(/readonly kind: '(\w+)'/g)].map((match) => match[1]!)

  it('finds the union it is meant to be checking', () => {
    expect(new Set(KINDS)).toEqual(
      new Set(['paragraph', 'heading', 'list', 'quote', 'code', 'table', 'rule']),
    )
  })

  it.each([...new Set(KINDS)])('has a branch for a %s block', (kind) => {
    expect(ANSWER).toContain(`case '${kind}':`)
  })

  it('steps a model-authored heading down to where a card’s content sits', () => {
    // The view's own heading is the `<h1>` and the card's title the `<h2>`, so an answer cannot
    // restructure the page outline by writing a hash.
    expect(ANSWER).toContain("const HEADING_TAGS = ['h3', 'h4', 'h5', 'h6', 'h6', 'h6'] as const")
  })
})

describe('the transcript renders it, and remembers the string unchanged', () => {
  it('draws the answer with the component rather than printing the text', () => {
    expect(CONVERSATION).toContain('<AssistantAnswer text={turn.answer.text} />')
    expect(CONVERSATION).not.toContain('className="assistant-answer">{turn.answer.text}')
  })

  it('leaves the failed and thinking states as they were (DDR-0038)', () => {
    // Neither is model markup: one is the gateway's own sentence and the other is the app's.
    expect(CONVERSATION).toContain('<p className="assistant-thinking">')
    expect(CONVERSATION).toContain('<StatePanel variant="error"')
  })
})

describe('every selector the component emits is styled', () => {
  it('spaces the answer as one column, with pre-wrap kept for a line break', () => {
    expect(rules('.assistant-answer')).not.toHaveLength(0)
    expect(declares('.assistant-answer', /display:\s*flex/)).toBe(true)
    expect(declares('.assistant-answer', /gap:\s*var\(--space-\d\)/)).toBe(true)
    expect(declares('.assistant-answer', /white-space:\s*pre-wrap/)).toBe(true)
    // The measure and the type step the answer had before this story, unchanged.
    expect(declares('.assistant-answer', /max-width:\s*68ch/)).toBe(true)
    expect(declares('.assistant-answer', /font-size:\s*var\(--text-sm\)/)).toBe(true)
  })

  it.each([
    '.assistant-answer p',
    '.assistant-answer h3',
    '.assistant-answer ul',
    '.assistant-answer ol',
    '.assistant-answer blockquote',
    '.assistant-answer pre',
    '.assistant-answer code',
    '.assistant-answer table',
    '.assistant-answer th',
    '.assistant-answer hr',
    '.assistant-table',
    '.assistant-code',
    '.assistant-code-language',
  ])('declares a rule for %s', (selector) => {
    expect(rules(selector), `${selector} has no rule in app.css`).not.toHaveLength(0)
  })

  it('sizes the two levels the prompt’s own register produces as headings', () => {
    // `SYSTEM_PROMPT_SECTIONS` is written in `##` and `###` (DDR-0110) and the answers mirror it,
    // so those arrive as `h4` and `h5`. The step has to fall between *those two*, not between the
    // tags that read as first and second — otherwise the app's most common heading is body text.
    expect(declares('.assistant-answer h4', /font-size:\s*var\(--text-md\)/)).toBe(true)
    expect(declares('.assistant-answer h5', /font-size:\s*var\(--text-sm\)/)).toBe(true)
  })

  it('zeroes each block’s own margin, so the column’s gap is the only spacing', () => {
    for (const selector of ['.assistant-answer p', '.assistant-answer ul', '.assistant-answer h3']) {
      expect(declares(selector, /margin:\s*0/), `${selector} keeps a margin`).toBe(true)
    }
  })

  it('scrolls a wide table inside the answer rather than widening the card', () => {
    expect(declares('.assistant-table', /overflow-x:\s*auto/)).toBe(true)
    expect(ANSWER).toContain('className="assistant-table"')
  })

  it('scopes the alignment classes, or a header cell out-specifies them', () => {
    // `.assistant-answer th` is a class *and* a type; an unscoped `.assistant-cell-right` is one
    // class and loses, silently reading every column as left (DDR-0039's trap).
    for (const alignment of ['center', 'right']) {
      expect(CSS).toContain(`.assistant-answer .assistant-cell-${alignment}`)
      expect(CSS).not.toMatch(new RegExp(`(^|[,}])\\s*\\.assistant-cell-${alignment}\\s*\\{`, 'm'))
    }
  })

  it('lets a code listing scroll rather than re-wrap', () => {
    expect(declares('.assistant-answer pre', /white-space:\s*pre;/)).toBe(true)
    expect(declares('.assistant-answer pre', /overflow-x:\s*auto/)).toBe(true)
  })
})

describe('the mono face', () => {
  it('puts the model’s code spans in the figure role rather than beside it', () => {
    // Membership, not a family of its own: a second rule applying `--font-figure` is what
    // `figureRole.ts` throws on (DDR-0053), so the chip's own rule declares everything *but* it.
    expect(isFigureSelector(RAW_CSS, '.assistant-answer code')).toBe(true)
    expect(rules('.assistant-answer code').filter((block) => /font-family/.test(block))).toHaveLength(
      1,
    )
  })

  it('keeps the prose out of it, which is what the role means', () => {
    expect(isFigureSelector(RAW_CSS, '.assistant-answer')).toBe(false)
    expect(isFigureSelector(RAW_CSS, '.assistant-answer p')).toBe(false)
  })

  it('sizes the chip itself, since the role declares no font-size (DDR-0018)', () => {
    expect(declares('.assistant-answer code', /font-size:\s*var\(--text-xs\)/)).toBe(true)
  })

  it('takes the chip’s box back off a listing’s code', () => {
    expect(declares('.assistant-answer pre code', /border:\s*0/)).toBe(true)
    expect(declares('.assistant-answer pre code', /padding:\s*0/)).toBe(true)
  })
})
