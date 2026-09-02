/**
 * The answer's markup, turned into a tree a component can render (Story #321, DDR-0114).
 *
 * The model writes markdown because **the prompt is written in it** (DDR-0110), and until this
 * story the view rendered the string as-is inside a `pre-wrap` paragraph — so the layout survived
 * and the *syntax* arrived with it: the `**` around a term, a leading `## `, the bullet and the
 * pipes. This module is the half of the fix that can be tested: text in, blocks out, no DOM
 * anywhere near it (DDR-0029 — Vitest runs Node-only with no jsdom).
 *
 * ## Why it is written here rather than installed
 *
 * Every markdown package worth having emits **HTML**, and the one rule this story may not break is
 * that model output never reaches `innerHTML`. Rendering a library's HTML would need
 * `dangerouslySetInnerHTML` and a sanitiser behind it — two dependencies and a security argument —
 * to reach a subset of syntax the assistant actually writes. A parser that stops at a *data
 * structure* cannot inject anything: the component renders `<strong>` because the parse said
 * `strong`, never because the answer contained a tag. That is the whole argument for the ~400 lines
 * below, and CLAUDE.md's dependency guardrail is the other half of it.
 *
 * ## What it promises
 *
 * **Nothing is dropped.** Every character that was not a marker survives into some span, and every
 * marker that fails to close degrades to the literal text it is made of. There is no error state
 * and no `null` return: the worst case for any input is a paragraph of exactly the characters that
 * went in. `assistantMarkdown.test.ts` states that as a property over malformed input rather than
 * as a list of examples.
 *
 * **Marks are a set, not a tree.** `**bold *and italic***` is three spans carrying `['strong']`,
 * `['strong','em']` and `['strong']` rather than a nested structure. A flat run with a mark set
 * renders as nested elements just the same, and it keeps the recursion in one place — the block
 * level, where lists and quotes genuinely nest.
 *
 * **Depth is bounded.** {@link MAX_DEPTH} stops a pathological answer (a hundred `>` characters)
 * from recursing per line; past it, content is kept as paragraph text rather than parsed further.
 * A bound is not an error — the text is still there.
 *
 * What is deliberately *not* here: links as anything actionable (ADR-0010 has no policy for opening
 * a model-authored URL, so a link becomes its label followed by the URL, both visible and neither
 * clickable), images, footnotes, and HTML — which is text like anything else the parser does not
 * recognise.
 */

/** An inline treatment. Applied as a set, so `['strong','em']` is bold italic. */
export type Mark = 'strong' | 'em' | 'code' | 'strike'

/** A run of text and everything applying to it. */
export interface Span {
  readonly text: string
  readonly marks: readonly Mark[]
}

/** A table column's alignment, as its delimiter row declared it. */
export type CellAlign = 'left' | 'center' | 'right'

/**
 * One item of a list: its own text, then anything nested under it.
 *
 * The split exists because an item is usually one line — `spans` alone — and occasionally a
 * paragraph with a sub-list under it. Keeping the common case out of `blocks` means the renderer
 * writes `<li>{spans}</li>` for it rather than a paragraph inside every bullet.
 */
export interface ListItem {
  readonly spans: readonly Span[]
  readonly blocks: readonly Block[]
}

/** Everything an answer can be made of. */
export type Block =
  | { readonly kind: 'paragraph'; readonly spans: readonly Span[] }
  /** `level` is the markdown level 1–6; where it lands in the page's outline is the view's call. */
  | { readonly kind: 'heading'; readonly level: number; readonly spans: readonly Span[] }
  | {
      readonly kind: 'list'
      readonly ordered: boolean
      /** The number the first item was written with; 1 for a bullet list. */
      readonly start: number
      readonly items: readonly ListItem[]
    }
  | { readonly kind: 'quote'; readonly blocks: readonly Block[] }
  | { readonly kind: 'code'; readonly language: string | null; readonly text: string }
  | {
      readonly kind: 'table'
      readonly align: readonly CellAlign[]
      readonly head: readonly (readonly Span[])[]
      readonly rows: readonly (readonly (readonly Span[])[])[]
    }
  | { readonly kind: 'rule' }

/**
 * How deep lists and quotes may nest before content is kept as text.
 *
 * Six is past anything the assistant writes and far short of a stack overflow. The bound is on
 * *structure*, never on characters: at the limit the lines become a paragraph, so the answer still
 * reads, it just stops indenting.
 */
export const MAX_DEPTH = 6

const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*$/
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const FENCE = /^ {0,3}(```+|~~~+)[ \t]*([^`]*?)[ \t]*$/
const QUOTE = /^ {0,3}>[ \t]?(.*)$/
const LIST_ITEM = /^([ \t]*)(?:([-*+])|(\d{1,9})[.)])[ \t]+(.*)$/
/** A delimiter row is what makes the line above it a header rather than a paragraph. */
const TABLE_DELIMITER = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/

/**
 * Parse an answer into the blocks that render it.
 *
 * The one entry point. Line endings are normalised first so a `\r\n` answer parses identically to
 * an `\n` one — the string arrives from a provider over HTTP and nothing upstream guarantees which.
 */
export function parseAnswer(text: string): Block[] {
  return parseBlocks(text.replace(/\r\n?/g, '\n').split('\n'), 0)
}

/**
 * The block loop: at every non-blank line, whichever construct claims it.
 *
 * Order is load-bearing in two places. A **thematic break** is tested before a list, or `---` opens
 * a bullet list whose item is empty. A **table** is tested before a paragraph, because what makes a
 * row a header is the delimiter line *underneath* it — the only lookahead in the parser.
 */
function parseBlocks(lines: readonly string[], depth: number): Block[] {
  if (depth >= MAX_DEPTH) return textFallback(lines)

  const blocks: Block[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]!
    if (line.trim() === '') {
      index++
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const [block, next] = readFence(lines, index, fence[1]!, fence[2]!)
      blocks.push(block)
      index = next
      continue
    }

    if (THEMATIC_BREAK.test(line)) {
      blocks.push({ kind: 'rule' })
      index++
      continue
    }

    const heading = HEADING.exec(line)
    // A heading with nothing after the hashes is not a heading — it is a `#` the owner should still
    // see. Consuming it would drop a character, which is the one thing this parser may not do.
    if (heading && (heading[2] ?? '').trim() !== '') {
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length,
        // A closing run of hashes is decoration, not content: `## Holdings ##`.
        spans: parseInline(heading[2]!.replace(/\s+#+\s*$/, '')),
      })
      index++
      continue
    }

    if (QUOTE.test(line)) {
      const [block, next] = readQuote(lines, index, depth)
      blocks.push(block)
      index = next
      continue
    }

    if (LIST_ITEM.test(line)) {
      const [block, next] = readList(lines, index, depth)
      blocks.push(block)
      index = next
      continue
    }

    const table = readTable(lines, index)
    if (table !== null) {
      blocks.push(table[0])
      index = table[1]
      continue
    }

    const [block, next] = readParagraph(lines, index)
    blocks.push(block)
    index = next
  }

  return blocks
}

/** Past {@link MAX_DEPTH}: the lines as they stand, so nothing is lost to the bound. */
function textFallback(lines: readonly string[]): Block[] {
  const text = lines.join('\n').trim()
  return text === '' ? [] : [{ kind: 'paragraph', spans: parseInline(text) }]
}

/**
 * A fenced code block, to the closing fence or to the end of the answer.
 *
 * An **unclosed fence runs to the end**, which is CommonMark's rule and also the safe one here:
 * the alternative — treating the opener as text — would leave a ``` on screen, which is the exact
 * thing this story removes. Either way every character after it is visible; only the marker is
 * consumed.
 */
function readFence(
  lines: readonly string[],
  start: number,
  marker: string,
  info: string,
): [Block, number] {
  // Built from the opener: a fence closes on a run of its own character, at least as long.
  const closing = new RegExp('^ {0,3}' + marker[0]! + '{' + String(marker.length) + ',}[ \\t]*$')
  const body: string[] = []
  let index = start + 1

  while (index < lines.length && !closing.test(lines[index]!)) {
    body.push(lines[index]!)
    index++
  }

  return [
    { kind: 'code', language: info.trim() === '' ? null : info.trim(), text: body.join('\n') },
    // Step over the closing fence when there was one; `index` is already past the end when not.
    index < lines.length ? index + 1 : index,
  ]
}

/** A run of `>` lines, re-parsed with their marker stripped. */
function readQuote(lines: readonly string[], start: number, depth: number): [Block, number] {
  const body: string[] = []
  let index = start

  while (index < lines.length) {
    const quoted = QUOTE.exec(lines[index]!)
    if (quoted === null) break
    body.push(quoted[1]!)
    index++
  }

  return [{ kind: 'quote', blocks: parseBlocks(body, depth + 1) }, index]
}

/**
 * A list, and everything indented under it.
 *
 * Two rules decide where it ends. A marker of the **other kind** at the same indent starts a new
 * list rather than continuing this one — `1.` under a `-` is a different list, and running them
 * together would renumber the bullets. A **blank line** ends it unless what follows is indented or
 * another item, which is what lets a list hold paragraphs without swallowing the prose after it.
 *
 * Nested content is dedented by one step and handed back to {@link parseBlocks}, so a sub-list is
 * parsed by exactly the code that parsed its parent.
 */
function readList(lines: readonly string[], start: number, depth: number): [Block, number] {
  const first = LIST_ITEM.exec(lines[start]!)!
  const ordered = first[3] !== undefined
  const baseIndent = first[1]!.length
  // The number the owner wrote, not 1: an answer that continues "4." after a paragraph is counting
  // something, and renumbering it from the top would contradict the sentence above it.
  const firstNumber = ordered ? Number(first[3]) : 1

  const items: ListItem[] = []
  let buffer: string[] = []
  let index = start

  const flush = (): void => {
    if (buffer.length === 0) return
    items.push(toItem(buffer, depth))
    buffer = []
  }

  while (index < lines.length) {
    const line = lines[index]!

    if (line.trim() === '') {
      const next = lines[index + 1]
      if (next === undefined || next.trim() === '' || !continuesList(next, baseIndent)) break
      buffer.push('')
      index++
      continue
    }

    const item = LIST_ITEM.exec(line)
    if (item !== null && item[1]!.length <= baseIndent + 1) {
      if ((item[3] !== undefined) !== ordered) break
      flush()
      buffer.push(item[4]!)
      index++
      continue
    }

    if (item !== null || indentOf(line) > baseIndent) {
      buffer.push(dedent(line, baseIndent + 2))
      index++
      continue
    }

    // Not indented and not a marker: a lazy continuation of the item's own paragraph.
    buffer.push(line.trim())
    index++
  }

  flush()
  return [{ kind: 'list', ordered, start: firstNumber, items }, index]
}

/** Whether a line after a blank one is still part of the list above it. */
function continuesList(line: string, baseIndent: number): boolean {
  const item = LIST_ITEM.exec(line)
  if (item !== null && item[1]!.length >= baseIndent) return true
  return indentOf(line) >= baseIndent + 2
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

function dedent(line: string, by: number): string {
  return line.slice(Math.min(indentOf(line), by))
}

/**
 * One item's lines, parsed.
 *
 * A leading paragraph becomes the item's own `spans` — the common case, one bullet one line — and
 * anything after it stays a block. An item that opens with a sub-list or a code fence has no text
 * of its own, and says so with an empty span list rather than an empty paragraph.
 */
function toItem(lines: readonly string[], depth: number): ListItem {
  const blocks = parseBlocks(lines, depth + 1)
  const [first] = blocks
  if (first?.kind === 'paragraph') return { spans: first.spans, blocks: blocks.slice(1) }
  return { spans: [], blocks }
}

/**
 * A pipe table, or `null` where the line only looked like one.
 *
 * The header's cell count is the table's width. A short row is **padded** and a long one has its
 * surplus **folded into the last cell**, because the alternative is dropping text the model wrote —
 * a malformed row degrades to a visible, slightly wrong cell rather than to nothing at all.
 */
function readTable(lines: readonly string[], start: number): [Block, number] | null {
  const header = lines[start]!
  const delimiter = lines[start + 1]
  if (!header.includes('|')) return null
  if (delimiter === undefined || !delimiter.includes('|') || !TABLE_DELIMITER.test(delimiter)) {
    return null
  }

  const head = splitRow(header)
  const align = splitRow(delimiter).map(alignOf)
  if (align.length !== head.length) return null

  const rows: string[][] = []
  let index = start + 2
  while (index < lines.length && lines[index]!.trim() !== '' && lines[index]!.includes('|')) {
    rows.push(fitRow(splitRow(lines[index]!), head.length))
    index++
  }

  return [
    {
      kind: 'table',
      align,
      head: head.map((cell) => parseInline(cell)),
      rows: rows.map((row) => row.map((cell) => parseInline(cell))),
    },
    index,
  ]
}

/** `:---`, `---:`, `:---:`, or neither. */
function alignOf(cell: string): CellAlign {
  const trimmed = cell.trim()
  if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center'
  if (trimmed.endsWith(':')) return 'right'
  return 'left'
}

/**
 * A row's cells, on unescaped pipes only.
 *
 * The leading and trailing pipes are optional in GFM and are stripped when present, which is why
 * the split runs on the trimmed interior rather than on the raw line.
 */
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cell = ''
  for (let index = 0; index < trimmed.length; index++) {
    const char = trimmed[index]!
    if (char === '\\' && trimmed[index + 1] === '|') {
      cell += '|'
      index++
      continue
    }
    if (char === '|') {
      cells.push(cell.trim())
      cell = ''
      continue
    }
    cell += char
  }
  cells.push(cell.trim())
  return cells
}

/** Pad a short row, fold a long one's surplus back into its last cell. */
function fitRow(cells: readonly string[], width: number): string[] {
  if (cells.length === width) return [...cells]
  if (cells.length < width) {
    return [...cells, ...Array<string>(width - cells.length).fill('')]
  }
  const kept = cells.slice(0, width - 1)
  return [...kept, cells.slice(width - 1).join(' | ')]
}

/** Consecutive lines up to a blank one or the start of another block. */
function readParagraph(lines: readonly string[], start: number): [Block, number] {
  const body: string[] = []
  let index = start

  while (index < lines.length) {
    const line = lines[index]!
    if (line.trim() === '') break
    if (index > start && startsBlock(lines, index)) break
    body.push(line.trim())
    index++
  }

  return [{ kind: 'paragraph', spans: parseInline(body.join('\n')) }, index]
}

/** Whether a line interrupts the paragraph it would otherwise continue. */
function startsBlock(lines: readonly string[], index: number): boolean {
  const line = lines[index]!
  return (
    FENCE.test(line) ||
    THEMATIC_BREAK.test(line) ||
    HEADING.test(line) ||
    QUOTE.test(line) ||
    LIST_ITEM.test(line) ||
    readTable(lines, index) !== null
  )
}

const LINK = /^\[([^\]]*)\]\(\s*(\S*?)\s*\)/

/**
 * The inline scanner: literal text until a delimiter that closes.
 *
 * Every branch has the same shape — try to find the closer, and fall back to the literal character
 * where there is none — which is what makes "unterminated markup degrades to text" a property of
 * the loop rather than a case someone remembered to write.
 *
 * Code wins over everything: a backtick run is literal to its closer, so `**` inside one stays two
 * asterisks, which is the whole point of quoting something.
 */
export function parseInline(text: string, marks: readonly Mark[] = [], depth = 0): Span[] {
  if (text === '') return []
  if (depth >= MAX_DEPTH) return [{ text, marks }]

  const spans: Span[] = []
  let literal = ''
  let index = 0

  const flush = (): void => {
    if (literal === '') return
    spans.push({ text: literal, marks })
    literal = ''
  }

  while (index < text.length) {
    const char = text[index]!

    // An escape is one character of literal text, marker or not.
    if (char === '\\' && index + 1 < text.length && /[\\`*_~[\]()#|-]/.test(text[index + 1]!)) {
      literal += text[index + 1]!
      index += 2
      continue
    }

    if (char === '`') {
      const run = runLength(text, index, '`')
      const close = findRun(text, index + run, '`', run)
      if (close !== -1) {
        flush()
        spans.push({ text: unpadCode(text.slice(index + run, close)), marks: withMark(marks, 'code') })
        index = close + run
        continue
      }
    }

    if (char === '~' && text[index + 1] === '~') {
      const close = findEmphasis(text, index + 2, '~~', 0)
      if (close !== -1) {
        flush()
        spans.push(...parseInline(text.slice(index + 2, close), withMark(marks, 'strike'), depth + 1))
        index = close + 2
        continue
      }
    }

    if (char === '*' || char === '_') {
      const opened = runLength(text, index, char)
      const run = Math.min(opened, 2)
      const delimiter = char.repeat(run)
      if (opensEmphasis(text, index, char, run)) {
        // What the opener did *not* consume is content — the middle `*` of `***both***`, which
        // opens the emphasis inside. The closer has to leave the same number behind.
        const close = findEmphasis(text, index + run, delimiter, opened - run, char === '_')
        if (close !== -1) {
          flush()
          spans.push(
            ...parseInline(
              text.slice(index + run, close),
              withMark(marks, run === 2 ? 'strong' : 'em'),
              depth + 1,
            ),
          )
          index = close + run
          continue
        }
      }
    }

    if (char === '[') {
      const link = LINK.exec(text.slice(index))
      if (link !== null) {
        flush()
        spans.push(...parseInline(link[1]!, marks, depth + 1))
        // Never actionable, and never silently dropped: the URL follows its label as text
        // (ADR-0010). A label that *is* the URL is not repeated.
        const url = link[2]!
        if (url !== '' && url !== link[1]!) spans.push({ text: ` (${url})`, marks })
        index += link[0]!.length
        continue
      }
    }

    literal += char
    index++
  }

  flush()
  return merge(spans)
}

/** How many of `char` run from `index`. */
function runLength(text: string, index: number, char: string): number {
  let length = 0
  while (text[index + length] === char) length++
  return length
}

/** The index of the next run of exactly `length` of `char`, or -1. */
function findRun(text: string, from: number, char: string, length: number): number {
  for (let index = from; index < text.length; index++) {
    if (text[index] !== char) continue
    const run = runLength(text, index, char)
    if (run === length) return index
    index += run - 1
  }
  return -1
}

/**
 * Whether a delimiter opens emphasis here.
 *
 * The rule is CommonMark's left-flanking test, kept because of what it prevents in *this* app:
 * `5 * 3 * 2` is arithmetic, not italics, and an assistant that quotes figures writes it. An
 * underscore is stricter still — it may not open inside a word — so `EUR_USD_rate` survives.
 */
function opensEmphasis(text: string, index: number, char: string, run: number): boolean {
  const after = text[index + run]
  if (after === undefined || /\s/.test(after)) return false
  if (char !== '_') return true
  const before = text[index - 1]
  return before === undefined || !/[\w]/.test(before)
}

/**
 * The index the closing delimiter starts at, or -1.
 *
 * The subtle half is a run **longer** than the delimiter, and the two cases pull opposite ways.
 * `***both***` opens on two of three and must close on the *last* two of three, so the odd one at
 * each end becomes the nested emphasis. `**a****b**` has a run of four in the middle, and the first
 * bold must close on the *first* two of it so the other two can open the second.
 *
 * `leftover` is what tells them apart: it is what the opener did not consume, and the closer has to
 * leave exactly as much behind. Getting this wrong leaves a stray `*` on screen — the bug this
 * story exists to remove.
 */
function findEmphasis(
  text: string,
  from: number,
  delimiter: string,
  leftover: number,
  wordBounded = false,
): number {
  const char = delimiter[0]!
  const width = delimiter.length

  for (let index = from; index + width <= text.length; index++) {
    if (text[index] !== char) continue
    const run = runLength(text, index, char)
    if (run < width) {
      index += run - 1
      continue
    }
    const close = index + Math.min(run - width, leftover)
    const before = text[index - 1]
    const after = text[close + width]
    // Empty emphasis is not emphasis, and a closer preceded by a space is the opener of something
    // else — `a * b * c` is arithmetic.
    if (close <= from || before === undefined || /\s/.test(before)) {
      index += run - 1
      continue
    }
    if (wordBounded && after !== undefined && /\w/.test(after)) {
      index += run - 1
      continue
    }
    return close
  }
  return -1
}

/** CommonMark strips one space from each end of a code span, so `` ` `` can be quoted. */
function unpadCode(text: string): string {
  if (text.length > 1 && text.startsWith(' ') && text.endsWith(' ') && text.trim() !== '') {
    return text.slice(1, -1)
  }
  return text
}

/** A mark added once — the set is small enough that order is the order it was applied in. */
function withMark(marks: readonly Mark[], mark: Mark): Mark[] {
  return marks.includes(mark) ? [...marks] : [...marks, mark]
}

/** Fold neighbours carrying identical marks, so `a**b**` is not three spans where two will do. */
function merge(spans: readonly Span[]): Span[] {
  const merged: Span[] = []
  for (const span of spans) {
    const last = merged[merged.length - 1]
    if (last !== undefined && sameMarks(last.marks, span.marks) && !last.marks.includes('code')) {
      merged[merged.length - 1] = { text: last.text + span.text, marks: last.marks }
      continue
    }
    merged.push(span)
  }
  return merged
}

function sameMarks(left: readonly Mark[], right: readonly Mark[]): boolean {
  return left.length === right.length && left.every((mark) => right.includes(mark))
}

/**
 * Every character a parse kept, in order — the guard's own subject rather than the renderer's.
 *
 * `assistantMarkdown.test.ts` uses it to state the promise at the top of this file as a property:
 * whatever the input, the text that comes out contains the text that went in, once the markers are
 * discounted. Exported because a test may not reach into a module's private half.
 */
export function blockText(blocks: readonly Block[]): string {
  return blocks.map(oneBlockText).join('\n')
}

function oneBlockText(block: Block): string {
  switch (block.kind) {
    case 'paragraph':
    case 'heading':
      return spanText(block.spans)
    case 'list':
      return block.items
        .map((item) => `${spanText(item.spans)}\n${blockText(item.blocks)}`.trim())
        .join('\n')
    case 'quote':
      return blockText(block.blocks)
    case 'code':
      return block.text
    case 'table':
      return [block.head, ...block.rows].map((row) => row.map(spanText).join(' ')).join('\n')
    case 'rule':
      return ''
  }
}

function spanText(spans: readonly Span[]): string {
  return spans.map((span) => span.text).join('')
}
