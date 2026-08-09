/**
 * A minimal CSS declaration scanner (Story #151), used only by tests.
 *
 * Nothing imports this at runtime — it exists so `tokenAdoption.test.ts` can ask what `app.css`
 * actually declares, rather than trusting a regex per assertion. It is deliberately *not* a CSS
 * parser: `postcss` would be more correct in the abstract and is a dependency in a project with
 * seven runtime ones, for a single stylesheet this project writes by hand (ADR-0008).
 *
 * The scan is character-level rather than line-level for two reasons found in the real file: a
 * selector may span lines (`.country-mark-slice,\n.country-mark-dot {`), and a comment may quote a
 * length in prose — `app.css` line 904 reads "Was a hand-picked 0.7rem; `--space-4` is the step it
 * always meant" — which a line scan reports as a violation the reader cannot act on. Comments are
 * blanked *in place*, so every line number stays true for the failure message.
 *
 * A declaration is keyed by the brace stack that encloses it plus its property, e.g.
 * `.dashboard-header | gap`, or `@media (max-width: 720px) >> .snapshot-item | gap`. Measured
 * across `app.css`: 110 guarded declarations produce 110 distinct keys. The at-rule prefix is what
 * keeps a rule and its media-query override apart, and line numbers were rejected because #152
 * shifts them in every commit.
 */

/** One declaration, with the context needed to name it in a failure message. */
export interface CssDeclaration {
  /** The enclosing brace stack joined with ` >> `, e.g. `@media (…) >> .snapshot-item`. */
  readonly context: string
  /** The property as written, longhand included (`margin-top`, not `margin`). */
  readonly property: string
  /** The declared value, trimmed, with `!important` left on. */
  readonly value: string
  /** 1-indexed line the declaration's value ends on — where a reader should look. */
  readonly line: number
  /** `context | property` — stable across edits elsewhere in the file. */
  readonly key: string
}

/**
 * Blank every comment, preserving newlines so line numbers survive.
 *
 * Replacing with `''` would be simpler and would shift every subsequent line, which matters
 * because the whole point of reporting a line is that someone can go and look at it.
 */
export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
}

/** Collapse a multi-line selector or at-rule prelude to one space-separated line. */
function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

/**
 * Every declaration in the stylesheet, in source order.
 *
 * Quoted strings are skipped so a `content: '}'` or a `syntax: '<length>'` cannot desynchronise
 * the brace stack. `@property` and `@keyframes` bodies are walked like any other block — their
 * declarations are still declarations, and the keyframe selector (`86%`) becomes part of the key.
 */
export function scanDeclarations(css: string): CssDeclaration[] {
  const source = stripComments(css)
  const declarations: CssDeclaration[] = []
  const stack: string[] = []

  let buffer = ''
  let line = 1
  let quote: string | null = null

  for (let i = 0; i < source.length; i++) {
    const char = source[i]

    if (char === '\n') line++

    if (quote !== null) {
      buffer += char
      if (char === quote && source[i - 1] !== '\\') quote = null
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      buffer += char
      continue
    }

    if (char === '{') {
      stack.push(normalize(buffer))
      buffer = ''
      continue
    }

    if (char === '}') {
      stack.pop()
      buffer = ''
      continue
    }

    if (char === ';') {
      const declaration = toDeclaration(buffer, stack, line)
      if (declaration !== null) declarations.push(declaration)
      buffer = ''
      continue
    }

    buffer += char
  }

  return declarations
}

/** Parse one `property: value` buffer, or `null` if it is not a declaration. */
function toDeclaration(buffer: string, stack: string[], line: number): CssDeclaration | null {
  const text = normalize(buffer)
  if (text === '') return null

  const colon = text.indexOf(':')
  if (colon <= 0) return null

  const property = text.slice(0, colon).trim()
  const value = text.slice(colon + 1).trim()
  if (property === '' || value === '' || !/^[a-zA-Z-]+$/.test(property)) return null

  const context = stack.join(' >> ')
  return { context, property, value, line, key: `${context} | ${property}` }
}
