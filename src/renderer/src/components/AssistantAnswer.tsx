import { Fragment, useMemo } from 'react'
import { parseAnswer, type Block, type CellAlign, type Span } from '../lib/assistantMarkdown'

/**
 * An answer, drawn the way the owner already reads model output (Story #321, DDR-0114).
 *
 * The reasoning is all in `lib/assistantMarkdown` — this file is the half a Node-only suite cannot
 * reach (DDR-0029), and it is kept to exactly that: a switch over the blocks the parser produced,
 * with no parsing, no measuring and no state.
 *
 * **Two rules govern everything here.**
 *
 * The answer is **model output**, so it never reaches `innerHTML`. Every element below exists
 * because the *parse* said so, never because the text contained a tag: an answer full of
 * `<script>` renders as the characters `<script>`, since React escapes a string child and this
 * component passes strings as children and nothing else. `assistantAnswerRendering.test.ts` fails
 * if `dangerouslySetInnerHTML` ever appears anywhere in `src/`.
 *
 * And **a heading here is a heading inside a card**, not a page heading. The view's `<h1>` is
 * "Assistant" and the card's own title is an `<h2>`, so a model-authored `#` starts at `h3` and
 * every deeper level steps down from there, bottoming out at `h6` rather than climbing past the
 * page. An answer cannot restructure the document outline by writing a hash.
 *
 * A **link is text** (ADR-0010): the parser has already turned it into its label followed by its
 * URL, so there is no `<a>` to render and nothing here to decide. The app has no policy for opening
 * a model-authored URL, and an underlined thing that does nothing when clicked is worse than plain
 * text.
 */
export function AssistantAnswer({ text }: { text: string }): React.JSX.Element {
  // The parse is a pure function of the string, and a turn's string never changes once answered —
  // so this runs once per answer, and re-runs only if a future story makes an answer mutable.
  const blocks = useMemo(() => parseAnswer(text), [text])

  return <div className="assistant-answer">{blocks.map(renderBlock)}</div>
}

/** Markdown level 1–6, stepped down to where a card's content actually sits in the outline. */
const HEADING_TAGS = ['h3', 'h4', 'h5', 'h6', 'h6', 'h6'] as const

/** Left is the absence of a class, the way a neutral tone is elsewhere (DDR-0039). */
const ALIGN_CLASS: Record<CellAlign, string | undefined> = {
  left: undefined,
  center: 'assistant-cell-center',
  right: 'assistant-cell-right',
}

function renderBlock(block: Block, index: number): React.JSX.Element {
  switch (block.kind) {
    case 'paragraph':
      return <p key={index}>{renderSpans(block.spans)}</p>

    case 'heading': {
      const Tag = HEADING_TAGS[Math.min(block.level, HEADING_TAGS.length) - 1]!
      return <Tag key={index}>{renderSpans(block.spans)}</Tag>
    }

    case 'list':
      return block.ordered ? (
        // `start` is the number the model wrote, which may not be 1: an answer continuing a count
        // after a paragraph is still counting the same things.
        <ol key={index} start={block.start}>
          {block.items.map(renderItem)}
        </ol>
      ) : (
        <ul key={index}>{block.items.map(renderItem)}</ul>
      )

    case 'quote':
      return <blockquote key={index}>{block.blocks.map(renderBlock)}</blockquote>

    case 'code':
      return (
        <div key={index} className="assistant-code">
          {block.language !== null && (
            <span className="assistant-code-language">{block.language}</span>
          )}
          <pre>
            <code>{block.text}</code>
          </pre>
        </div>
      )

    case 'table':
      return (
        // The scroller is the wrapper, not the table: a wide grid must not widen the card, and a
        // `<table>` cannot scroll itself.
        <div key={index} className="assistant-table">
          <table>
            <thead>
              <tr>
                {block.head.map((cell, column) => (
                  <th key={column} scope="col" className={ALIGN_CLASS[block.align[column] ?? 'left']}>
                    {renderSpans(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, column) => (
                    <td key={column} className={ALIGN_CLASS[block.align[column] ?? 'left']}>
                      {renderSpans(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )

    case 'rule':
      return <hr key={index} />
  }
}

/** An item's own text, then whatever nested under it — usually nothing. */
function renderItem(item: { spans: readonly Span[]; blocks: readonly Block[] }, index: number): React.JSX.Element {
  return (
    <li key={index}>
      {renderSpans(item.spans)}
      {item.blocks.map(renderBlock)}
    </li>
  )
}

/**
 * The spans of one block.
 *
 * Index keys are correct here and nowhere near the usual trap: the list is derived from an
 * immutable string, is never reordered, and nothing in it holds state.
 */
function renderSpans(spans: readonly Span[]): React.JSX.Element[] {
  return spans.map((span, index) => <Fragment key={index}>{withMarks(span)}</Fragment>)
}

/**
 * One run of text, wrapped in whatever applies to it.
 *
 * The order is the nesting order, and only one of them is load-bearing: `code` wraps **first**, so
 * a bold code span is `<strong><code>`, which is the pair a reader expects and the one the
 * stylesheet's `.assistant-answer code` rule can size on its own.
 */
function withMarks(span: Span): React.ReactNode {
  let node: React.ReactNode = span.text
  if (span.marks.includes('code')) node = <code>{node}</code>
  if (span.marks.includes('em')) node = <em>{node}</em>
  if (span.marks.includes('strike')) node = <s>{node}</s>
  if (span.marks.includes('strong')) node = <strong>{node}</strong>
  return node
}
