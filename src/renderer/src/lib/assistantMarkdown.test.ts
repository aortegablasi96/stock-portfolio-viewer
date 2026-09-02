import { describe, expect, it } from 'vitest'

import { blockText, parseAnswer, parseInline, type Block, type Span } from './assistantMarkdown'

/**
 * The answer's markup, parsed (Story #321, DDR-0114).
 *
 * Two kinds of assertion live here and they fail for different reasons.
 *
 * Most of the file pins **what a construct becomes**, because the renderer is a switch over these
 * shapes and a wrong shape is a wrong picture. The last block pins the property the whole design
 * rests on: **nothing is dropped.** Malformed markup degrades to the characters it is made of, and
 * that is stated over a table of broken inputs rather than one example at a time — an unterminated
 * `**` is not a special case someone remembered, it is what the loop does when a closer is missing.
 *
 * There is no DOM here and there cannot be (DDR-0029). What a `<strong>` looks like on screen is
 * `assistantAnswerRendering.test.ts` and the e2e suite; what the parser *said* is this file.
 */

/** The blocks of a one-block answer, asserted to be that block. */
function only(text: string): Block {
  const blocks = parseAnswer(text)
  expect(blocks).toHaveLength(1)
  return blocks[0]!
}

/** A span's text and marks, in the shape the assertions below read most easily. */
function shape(spans: readonly Span[]): [string, string[]][] {
  return spans.map((span) => [span.text, [...span.marks]])
}

describe('paragraphs', () => {
  it('reads a plain answer as one paragraph', () => {
    const block = only('Your largest position is Rio Tinto.')
    expect(block).toEqual({
      kind: 'paragraph',
      spans: [{ text: 'Your largest position is Rio Tinto.', marks: [] }],
    })
  })

  it('keeps a line break inside a paragraph, and splits on a blank line', () => {
    const blocks = parseAnswer('One\ntwo\n\nThree')
    expect(blocks).toHaveLength(2)
    expect(blockText([blocks[0]!])).toBe('One\ntwo')
    expect(blockText([blocks[1]!])).toBe('Three')
  })

  it('parses the same whichever line ending the provider sent', () => {
    expect(parseAnswer('One\r\ntwo')).toEqual(parseAnswer('One\ntwo'))
  })

  it('is nothing at all when there is nothing in it', () => {
    expect(parseAnswer('')).toEqual([])
    expect(parseAnswer('\n\n  \n')).toEqual([])
  })
})

describe('headings', () => {
  it('carries the markdown level, not a page level', () => {
    expect(only('## Holdings')).toEqual({
      kind: 'heading',
      level: 2,
      spans: [{ text: 'Holdings', marks: [] }],
    })
  })

  it('drops a closing run of hashes, which is decoration', () => {
    expect(only('### Drift ###')).toMatchObject({ level: 3, spans: [{ text: 'Drift' }] })
  })

  it('leaves a hash with nothing after it as text', () => {
    // Consuming it would print nothing where the owner wrote something.
    expect(only('#')).toMatchObject({ kind: 'paragraph' })
    expect(only('#hashtag')).toMatchObject({ kind: 'paragraph' })
  })

  it('interrupts the paragraph above it', () => {
    const blocks = parseAnswer('A sentence.\n## Then a heading')
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'heading'])
  })
})

describe('inline marks', () => {
  it('reads bold, italic and strikethrough', () => {
    expect(shape(parseInline('a **b** c *d* e ~~f~~'))).toEqual([
      ['a ', []],
      ['b', ['strong']],
      [' c ', []],
      ['d', ['em']],
      [' e ', []],
      ['f', ['strike']],
    ])
  })

  it('reads a mark set rather than a tree, so bold italic is one span', () => {
    expect(shape(parseInline('***both***'))).toEqual([['both', ['strong', 'em']]])
    expect(shape(parseInline('**bold and *italic* inside**'))).toEqual([
      ['bold and ', ['strong']],
      ['italic', ['strong', 'em']],
      [' inside', ['strong']],
    ])
  })

  it('handles adjacent markers with nothing between them', () => {
    // Two bold runs meeting, folded into one span because they carry identical marks and would
    // render as two indistinguishable `<strong>`s. What matters is that no asterisk survives.
    expect(shape(parseInline('**a****b**'))).toEqual([['ab', ['strong']]])
    expect(shape(parseInline('**a** **b**'))).toEqual([
      ['a', ['strong']],
      [' ', []],
      ['b', ['strong']],
    ])
  })

  it('leaves arithmetic alone — a delimiter followed by a space opens nothing', () => {
    expect(shape(parseInline('5 * 3 * 2 = 30'))).toEqual([['5 * 3 * 2 = 30', []]])
  })

  it('leaves an underscore inside a word alone', () => {
    expect(shape(parseInline('EUR_USD_rate'))).toEqual([['EUR_USD_rate', []]])
    expect(shape(parseInline('_emphasised_'))).toEqual([['emphasised', ['em']]])
  })

  it('leaves unterminated markup as the characters it is made of', () => {
    expect(shape(parseInline('**never closed'))).toEqual([['**never closed', []]])
    expect(shape(parseInline('a ~~b'))).toEqual([['a ~~b', []]])
    expect(shape(parseInline('`unclosed'))).toEqual([['`unclosed', []]])
  })

  it('honours an escape, so a literal asterisk survives', () => {
    expect(shape(parseInline('2 \\* 3'))).toEqual([['2 * 3', []]])
    expect(shape(parseInline('\\**not bold*'))).toEqual([
      ['*', []],
      ['not bold', ['em']],
    ])
  })
})

describe('inline code', () => {
  it('is literal to its closer, so markup inside it stays text', () => {
    expect(shape(parseInline('use `**AAPL**` here'))).toEqual([
      ['use ', []],
      ['**AAPL**', ['code']],
      [' here', []],
    ])
  })

  it('matches a run of the same length, so a backtick can be quoted', () => {
    expect(shape(parseInline('``a ` b``'))).toEqual([['a ` b', ['code']]])
  })

  it('strips the one padding space a quoted backtick needs', () => {
    expect(shape(parseInline('`` ` ``'))).toEqual([['`', ['code']]])
  })

  it('nests inside another mark rather than replacing it', () => {
    expect(shape(parseInline('**`RIO`**'))).toEqual([['RIO', ['strong', 'code']]])
  })
})

describe('links', () => {
  it('renders as its label and its URL, neither hidden nor clickable (ADR-0010)', () => {
    // One span, because a link carries no mark of its own: there is nothing here for a renderer to
    // turn into an `<a>`, which is the point.
    expect(shape(parseInline('see [the filing](https://example.com/x)'))).toEqual([
      ['see the filing (https://example.com/x)', []],
    ])
  })

  it('does not repeat a label that is already the URL', () => {
    expect(shape(parseInline('[https://example.com](https://example.com)'))).toEqual([
      ['https://example.com', []],
    ])
  })

  it('leaves a bracket that is not a link as text', () => {
    expect(shape(parseInline('[not a link] and [neither](is this'))).toEqual([
      ['[not a link] and [neither](is this', []],
    ])
  })
})

describe('lists', () => {
  it('reads a bullet list, one item per marker', () => {
    expect(only('- Rio Tinto\n- Serabi Gold')).toEqual({
      kind: 'list',
      ordered: false,
      start: 1,
      items: [
        { spans: [{ text: 'Rio Tinto', marks: [] }], blocks: [] },
        { spans: [{ text: 'Serabi Gold', marks: [] }], blocks: [] },
      ],
    })
  })

  it('keeps the number an ordered list actually started at', () => {
    expect(only('3. third\n4. fourth')).toMatchObject({ ordered: true, start: 3 })
  })

  it('starts a new list when the marker kind changes', () => {
    const blocks = parseAnswer('- bullet\n1. number')
    expect(blocks.map((block) => block.kind)).toEqual(['list', 'list'])
    expect(blocks[1]).toMatchObject({ ordered: true })
  })

  it('nests an indented list under the item above it', () => {
    const list = only('- Equities\n  - Rio Tinto\n  - Serabi Gold\n- Cash')
    expect(list).toMatchObject({ kind: 'list', items: [{}, {}] })
    const [equities, cash] = (list as Extract<Block, { kind: 'list' }>).items
    expect(equities!.spans).toEqual([{ text: 'Equities', marks: [] }])
    expect(equities!.blocks).toHaveLength(1)
    expect(equities!.blocks[0]).toMatchObject({ kind: 'list', items: [{}, {}] })
    expect(cash!.blocks).toEqual([])
  })

  it('marks up an item like any other text', () => {
    const list = only('- **Rio Tinto** at 12%') as Extract<Block, { kind: 'list' }>
    expect(shape(list.items[0]!.spans)).toEqual([
      ['Rio Tinto', ['strong']],
      [' at 12%', []],
    ])
  })

  it('ends at the prose that follows it', () => {
    const blocks = parseAnswer('- one\n- two\n\nAnd that is all.')
    expect(blocks.map((block) => block.kind)).toEqual(['list', 'paragraph'])
  })
})

describe('block quotes', () => {
  it('re-parses its contents, so a quoted list is a list', () => {
    const quote = only('> A note:\n> - one\n> - two') as Extract<Block, { kind: 'quote' }>
    expect(quote.kind).toBe('quote')
    expect(quote.blocks.map((block) => block.kind)).toEqual(['paragraph', 'list'])
  })
})

describe('code blocks', () => {
  it('keeps every character between the fences, and names the language', () => {
    expect(only('```sql\nselect 1\n  from t\n```')).toEqual({
      kind: 'code',
      language: 'sql',
      text: 'select 1\n  from t',
    })
  })

  it('has no language where none was written', () => {
    expect(only('```\nplain\n```')).toMatchObject({ language: null, text: 'plain' })
  })

  it('runs to the end of the answer when the fence never closes', () => {
    // The marker is consumed either way; what matters is that the text after it is all still here.
    expect(only('```\nstill visible\nand this too')).toMatchObject({
      kind: 'code',
      text: 'still visible\nand this too',
    })
  })

  it('does not open on a strikethrough at the start of a line', () => {
    expect(only('~~gone~~')).toMatchObject({ kind: 'paragraph' })
  })
})

describe('tables', () => {
  const TABLE = [
    '| Position | Weight |',
    '| --- | ---: |',
    '| Rio Tinto | 12.4% |',
    '| Serabi Gold | 8.1% |',
  ].join('\n')

  it('reads the header, the alignment and every row', () => {
    const table = only(TABLE) as Extract<Block, { kind: 'table' }>
    expect(table.kind).toBe('table')
    expect(table.align).toEqual(['left', 'right'])
    expect(table.head.map(text)).toEqual(['Position', 'Weight'])
    expect(table.rows.map((row) => row.map(text))).toEqual([
      ['Rio Tinto', '12.4%'],
      ['Serabi Gold', '8.1%'],
    ])
  })

  it('reads centred columns and optional outer pipes', () => {
    const table = only('a | b\n:-: | -\nc | d') as Extract<Block, { kind: 'table' }>
    expect(table.align).toEqual(['center', 'left'])
    expect(table.rows.map((row) => row.map(text))).toEqual([['c', 'd']])
  })

  it('is a paragraph without a delimiter row under the header', () => {
    // A sentence containing a pipe is not a table, and must not be eaten as one.
    expect(only('Cash | equities was the split.')).toMatchObject({ kind: 'paragraph' })
  })

  it('pads a short row rather than dropping the column', () => {
    const table = only('| a | b |\n| --- | --- |\n| only |') as Extract<Block, { kind: 'table' }>
    expect(table.rows[0]!.map(text)).toEqual(['only', ''])
  })

  it('folds a long row into its last cell rather than dropping the text', () => {
    const table = only('| a | b |\n| --- | --- |\n| x | y | z |') as Extract<Block, { kind: 'table' }>
    expect(table.rows[0]!.map(text)).toEqual(['x', 'y | z'])
  })

  it('reads an escaped pipe as a character in a cell', () => {
    const table = only('| a |\n| --- |\n| x \\| y |') as Extract<Block, { kind: 'table' }>
    expect(table.rows[0]!.map(text)).toEqual(['x | y'])
  })

  it('marks up a cell like any other text', () => {
    const table = only('| a |\n| --- |\n| **bold** |') as Extract<Block, { kind: 'table' }>
    expect(shape(table.rows[0]![0]!)).toEqual([['bold', ['strong']]])
  })
})

describe('thematic breaks', () => {
  it('reads a rule, and not as an empty list', () => {
    expect(only('---')).toEqual({ kind: 'rule' })
    expect(only('***')).toEqual({ kind: 'rule' })
  })
})

describe('bounds', () => {
  it('stops nesting at a depth no answer reaches, keeping the text', () => {
    const deep = `${'> '.repeat(12)}buried`
    expect(blockText(parseAnswer(deep))).toContain('buried')
  })

  it('stops nesting emphasis without losing the words', () => {
    const nested = `${'**'.repeat(10)}word${'**'.repeat(10)}`
    expect(blockText(parseAnswer(nested))).toContain('word')
  })
})

/**
 * The promise the whole design rests on, stated once over everything that can go wrong.
 *
 * A parser that silently eats a malformed row is worse than one that prints a pipe: the owner reads
 * a shorter answer and has no way to know. So every word that went in comes out, whatever shape the
 * markup was in.
 */
describe('nothing is dropped', () => {
  const BROKEN = [
    '**unterminated bold',
    'a *lone asterisk',
    '`unclosed code span',
    '```\nunclosed fence',
    '## ',
    '#',
    '| broken | table |\n| --- |\n| row |',
    '| a | b |\n| --- | --- |\n| one |',
    '- item\n    still the item\nlazy continuation',
    '> quote\nlazy quote continuation',
    '<script>alert(1)</script>',
    '~~~~~~',
    '[label](',
    '****',
    '   ',
  ]

  it.each(BROKEN)('keeps every word of %j', (input) => {
    const out = blockText(parseAnswer(input))
    for (const word of input.match(/[\w()]+/g) ?? []) {
      expect(out, `"${word}" went missing`).toContain(word)
    }
  })

  it('never throws, whatever the answer looks like', () => {
    for (const input of BROKEN) expect(() => parseAnswer(input)).not.toThrow()
  })

  it('treats HTML as text, since a tag is not markup this parser knows', () => {
    // The renderer escapes it in turn; this is the first of the two guards on the same claim.
    expect(shape(parseInline('<b>not bold</b>'))).toEqual([['<b>not bold</b>', []]])
  })
})

/** A cell's or a span list's plain text. */
function text(spans: readonly Span[]): string {
  return spans.map((span) => span.text).join('')
}
