# 0114. An answer is formatted, and the parser is the app's own

- **Status:** Accepted
- **Date:** 2026-09-02
- **Extends:** [[0110-the-prompt-is-eight-sections-and-the-owner-wrote-them]],
  [[0113-the-conversation-remembers-itself-and-the-models-prose-stays-the-models]],
  [[0053-bundled-typefaces-and-the-figure-role]],
  [[0031-design-token-scales]],
  [[0039-data-table-primitive-and-column-sorting]]

## Context

Story #321 of Epic #319, and the second half of it: #320 made the assistant remember, and this one
makes what it says readable.

`AssistantConversation` rendered the answer as `<p className="assistant-answer">{text}</p>`, and
`.assistant-answer` carried `white-space: pre-wrap`. So the *layout* already survived — this was
never a collapsed wall of text — and what arrived on screen with it was the **syntax**: the `**`
around an emphasised term, a leading `## `, the backticks, the bullets, the pipes of a table.

The model writes markdown because **the prompt is written in it**
([[0110-the-prompt-is-eight-sections-and-the-owner-wrote-them]]): the eight sections use bold terms,
numbered lists and bullets throughout, and *Communication* asks for brief, concrete answers in that
register. Nothing here changes what the model is asked to produce. The owner asked for the answer to
read the way ChatGPT's does, which is the register they already read model output in, and that is
what the story scopes: **the answer body**. The transcript around it is untouched — newest turn
first, the question quoted back down a rule, no bubbles and no avatars
([[0098-the-assistant-is-grounded-in-text-the-app-wrote]], [[0107-the-assistant-view-is-the-chat]]).

Three constraints were fixed before any option was on the table.

- **Model output must never reach `innerHTML`.** There is no `dangerouslySetInnerHTML` anywhere in
  `src/`, and this story is not what introduces one.
- **Vitest is Node-only with no jsdom** ([[0029-tab-shell-aria-pattern-and-keyboard-navigation]]), so
  anything that renders markdown *directly* is untestable here.
- **Seven runtime dependencies**, and CLAUDE.md asks that an eighth carries clear long-term value.

## Decision

### 1. The parser is the app's own, and it stops at a data structure

`renderer/src/lib/assistantMarkdown.ts` takes the answer's text and returns `Block[]`.
`components/AssistantAnswer.tsx` is a switch over those blocks. Nothing between them is HTML.

This is the decision the other five follow from, and the dependency guardrail is only half its
argument. The other half is that **every markdown library emits HTML**, which is exactly the thing
the first constraint forbids: adopting one means `dangerouslySetInnerHTML` plus a sanitiser behind
it — two dependencies and a standing security argument — to reach a subset of syntax an assistant
writing about a portfolio actually uses. A parser that stops at a data structure cannot inject
anything at all: the component renders `<strong>` because the *parse* said `strong`, never because
the answer contained a tag. An answer full of `<script>` renders as the characters `<script>`,
because React escapes a string child and this component passes strings and nothing else.

The split is also what makes it testable. `assistantMarkdown.test.ts` runs in Node against a tree;
`assistantAnswerRendering.test.ts` reads the component and the stylesheet as text; the e2e suite is
where a cascade actually resolves. That is the same three-layer split the charts already use, for
the same reason.

**A guard on the whole of `src/`**, not on this component: the risk is not that someone rewrites
`AssistantAnswer`, it is that a later story reaches for the same shortcut two directories away on a
string from the same place.

### 2. Nothing is dropped, ever — malformed markup is text

The one property everything else is measured against. Every character that was not a marker survives
into some span; every marker that fails to close degrades to the literal characters it is made of.
There is no error state and no `null` return, and the worst case for any input is a paragraph of
exactly what went in.

A parser that silently ate a malformed table row would be worse than one that printed a pipe: the
owner reads a shorter answer with no way to know. So it is stated as a **property over a table of
broken inputs** rather than as remembered cases — an unterminated `**` is what the loop does when a
closer is missing, not a branch someone thought of.

Three places where that rule decided a detail against convention:

- A **short table row is padded** and a **long one has its surplus folded into the last cell**. GFM
  truncates; truncating drops text the model wrote.
- An **unclosed fence runs to the end of the answer** (CommonMark's rule, and the safe one here:
  the alternative leaves a ``` on screen, which is the thing this story removes).
- A **hash with nothing after it is a paragraph**, not an empty heading. Consuming it would print
  nothing where the owner wrote something.

### 3. Marks are a set; blocks are a tree

`**bold *and italic***` is three spans carrying `['strong']`, `['strong','em']` and `['strong']`,
not a nested inline structure. A flat run with a mark set renders as nested elements just the same,
and it keeps recursion at the block level, where lists and quotes genuinely nest. Depth is bounded
by `MAX_DEPTH` (6); past it the content is kept as paragraph text, so a bound costs indentation and
never a word.

Two inline rules exist because of what this app writes. Emphasis will not open on a delimiter
followed by whitespace, so **`5 * 3 * 2` stays arithmetic**; an underscore will not open inside a
word, so `EUR_USD_rate` survives. And the closing-delimiter rule has to distinguish `***both***`
(which closes on the *last* two of three) from `**a****b**` (which closes on the *first* two of
four) — the parser tracks what the opener left behind, and getting it wrong leaves a stray `*` on
screen, which is this story's own bug re-shipped.

### 4. A link is its label and its URL, and is never actionable

ADR-0010 has no policy for opening a model-authored URL, and the app has no browser. So a link is
not an `<a>`, and it is not silently reduced to its label either: it renders as the label followed
by the URL in parentheses, both visible, neither clickable. Nothing is hidden and nothing is
clickable — the two halves of decision 2 and ADR-0010 met at the same place. A label that *is* the
URL is not repeated.

### 5. The model's code spans join the figure role rather than declaring a second one

The answer needed a mono face, and `--font-figure` is applied by **exactly one rule** —
`figureRole.ts` throws rather than merging if a second appears
([[0053-bundled-typefaces-and-the-figure-role]]). So `.assistant-answer code` joins the role's selector
list, as its thirteenth member and the first that is not the app's own figure.

It belongs there on the role's own terms. What an assistant puts in backticks in *this* app is a
ticker, a currency code or a figure, which is what `tabular-nums` and the tightened tracking were
chosen for. The prose around it stays out — a figure quoted inside a sentence is prose, which is
what kept `.badge` and `.map-popup-title` out of the role in the first place. The role declares no
`font-size`, so the step down to `--text-xs` is the chip's own rule: JetBrains Mono runs larger than
Inter at one size, and a chip should not outweigh the sentence around it.

The chip's surface is **`--bg` behind a `--border` hairline**, not `--surface-raised`.
`--surface-raised` has exactly three adopters and `sidebarRail.test.ts` counts them, because every
ink measured on it is an ink one of those three renders (DDR-0069, DDR-0070); a fourth owes new
pairings in `lib/contrast.ts`. `--text` and `--muted` on `--bg` are already measured, so this adds
no unmeasured ink.

### 6. Where a model-authored heading lands, and how big it is

The view's own heading is the `<h1>` and the card's title is the `<h2>`, so a model-authored `#`
starts at **`h3`** and steps down to `h6`. An answer cannot restructure the page outline by writing
a hash.

Two type steps cover the four levels, and **where the step falls was decided by what the model
actually writes**. The prompt's register is `##` and `###`, which arrive here as `h4` and `h5` — so
those are the pair that must be told apart, and the step falls between them. Putting it between
`h3` and `h4` instead, which reads more naturally as "first level, second level", would render the
app's most common heading at body size: a section title nobody sees.

### 7. Spacing is the column's gap, and the table's alignment is scoped

`.assistant-answer` is a flex column with one `gap`, and every block inside it zeroes its own
margin. One number to change, and no margin collapsing to reason about. Lists keep the browser's
`list-item` layout rather than becoming flex columns — blockifying the items is how a bullet list
quietly loses its bullets.

The alignment classes are **scoped**: `.assistant-answer th` is a class *and* a type, so a bare
`.assistant-cell-right` loses to it and every column the model aligned reads as left. That is
[[0039-data-table-primitive-and-column-sorting]]'s trap, which shipped once already on the linked row's lift, and
it is pinned in Playwright because a text scan cannot resolve a cascade.

### 8. `pre-wrap` stays, and the string does not change

`white-space: pre-wrap` was doing two jobs and now does one: inside a block, a newline the model
wrote is a line break the reader sees. Between blocks it has nothing left to do, because the parser
consumed those newlines into structure. A code block overrides it to `pre` — a listing does not
re-wrap, it scrolls, and so does a wide table, inside a wrapper so it cannot widen the card.

And the string itself is untouched. `rememberedTurns` sends `turn.answer.text` back under
`role: 'assistant'` ([[0113-the-conversation-remembers-itself-and-the-models-prose-stays-the-models]]),
so **formatting is a render concern**: the model reads its own markdown on the next turn, not this
app's rendering of it. The e2e suite asserts that on the wire, because it is the kind of thing a
refactor quietly breaks.

## Consequences

Benefits:

- The answer reads as prose. No marker character reaches the screen where it was markup, and the
  register matches what the prompt asks the model to write.
- No new dependency, and no `dangerouslySetInnerHTML` — now guarded across `src/` rather than merely
  absent.
- The parse is a pure module, so the behaviour that used to be unreachable in a Node-only suite is
  60 unit tests.

Tradeoffs:

- ~400 lines of parser to own. It is bounded by the subset declared above and by the property in
  decision 2; it is not on a path to becoming a markdown implementation.
- The subset is not CommonMark. Setext headings, reference links, images, footnotes, task lists and
  HTML are all text. Each is visible as itself, which is the fallback the design guarantees.
- A code span now sets in mono at `--text-xs`, so an answer quoting a long identifier is denser than
  the prose around it.

Risks:

- **The parser is the trust boundary.** It cannot emit HTML, so the failure mode is a wrong picture
  rather than an injection — but a future story adding a block kind must add the branch that draws
  it, or the block renders as nothing. `assistantAnswerRendering.test.ts` fails on exactly that: it
  reads the `Block` union out of the parser and asserts a `case` for each.

## Alternatives Considered

### A markdown library (`marked`, `markdown-it`, `react-markdown`)

Rejected on the first constraint rather than on the dependency count. All three emit HTML, so the
renderer would need `dangerouslySetInnerHTML` and a sanitiser to be safe — a security posture this
app has never had to hold. `react-markdown` avoids the HTML by rendering components, and brings
`unified`/`remark`/`micromark` (dozens of transitive packages) into an app with seven runtime
dependencies, for a feature that renders one string in one view. It also could not be tested here:
no jsdom, so its output would be pinned by e2e alone.

### Leaving `pre-wrap` and asking the model for plain text

The cheapest option, and it was rejected in the Epic before this story: the prompt is written in
markdown and its register is what makes the answers readable in the first place. Asking for plain
text costs the bold terms and the numbered steps in every answer, to fix how six characters render.
It would also mean editing DDR-0110's eight sections, which this story explicitly does not touch.

### Rendering a markdown table as `DataTable`

Rejected. `DataTable` is the app's own grid: sortable columns, a missing value sorting last, an
11px column head paired with its tracking ([[0039-data-table-primitive-and-column-sorting]]). None of that is
meaningful for two rows the model wrote in a sentence, and adopting the primitive would put
model-authored content inside the component the app's *computed* figures use — the same conflation
the marking rules in ADR-0009 exist to prevent. The answer's table is a plain grid that shares the
tokens and nothing else.

### Restyling the transcript into chat bubbles

Out of scope, and against two records. DDR-0098 put the question in a quoted rule and DDR-0107 made
the view the chat; the ask was about the *markup*, and the surface around it is decided elsewhere.

## References

- Story #321, Epic #319
- `src/renderer/src/lib/assistantMarkdown.ts`, `src/renderer/src/components/AssistantAnswer.tsx`
- ADR-0009 (the grounding rule and the marking), ADR-0010 (the network policy, and why a link is
  text), ADR-0008 (the in-house design system)
- [[0110-the-prompt-is-eight-sections-and-the-owner-wrote-them]],
  [[0113-the-conversation-remembers-itself-and-the-models-prose-stays-the-models]],
  [[0053-bundled-typefaces-and-the-figure-role]], [[0031-design-token-scales]],
  [[0039-data-table-primitive-and-column-sorting]], [[0075-sidebar-nav-rhythm-and-the-boxed-currency]]
