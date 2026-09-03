import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import electronBinary from 'electron'
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'

// Outside Electron, the `electron` package resolves to the path of its binary.
const electronPath = electronBinary as unknown as string
const mainEntry = join(__dirname, '..', 'out', 'main', 'index.js')

/**
 * An answer read as prose rather than as its own markup (Story #321, DDR-0114).
 *
 * `lib/assistantMarkdown.test.ts` owns every parse and `lib/assistantAnswerRendering.test.ts` owns
 * what the component and the stylesheet say. Neither can see the three things this file is for:
 * markdown arriving from a real request and coming out of a real renderer as **elements**, a
 * **cascade** resolving (a column the model aligned right, against a header rule that out-specifies
 * a bare class), and the string going back on the wire **unchanged** by any of it.
 *
 * ## Nothing leaves this machine
 *
 * `OPENAI_BASE_URL` points at a local stub, exactly as `assistant-memory.spec.ts` does — every
 * request is served on `127.0.0.1`, the store is empty, and the profile is one typed here. That is
 * what makes asking a real question safe in a suite.
 */

let app: ElectronApplication
let page: Page
let stub: Server

/** Every request body the app has sent, oldest first. */
let sent: { messages: { role: string; content: string }[] }[] = []

/** What the stub answers with next. One canned reply per question, in order. */
let replies: string[] = []

/** The answer under test: one of each construct the story put in scope. */
const MARKDOWN = [
  '## Where you stand',
  '',
  'Your largest position is **Rio Tinto**, held under the ticker `RIO`, and it is *above* your',
  'ceiling.',
  '',
  '| Position | Weight |',
  '| --- | ---: |',
  '| Rio Tinto | 12.4% |',
  '| Serabi Gold | 8.1% |',
  '',
  '1. Trim Rio Tinto',
  '2. Leave the rest',
  '',
  '- A bullet',
  '- Another',
  '',
  '> Judged against your own profile.',
].join('\n')

test.beforeAll(async () => {
  stub = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      sent.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      const content = replies.shift() ?? 'A canned answer.'
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          model: 'stub-model',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      )
    })
  })
  await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve))
  const { port } = stub.address() as AddressInfo

  app = await electron.launch({
    executablePath: electronPath,
    args: [mainEntry, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'spv-e2e-answer-'))}`],
    env: {
      ...process.env,
      OPENAI_API_KEY: 'sk-not-a-real-key-and-never-used',
      // The whole safety property of this file, in one line: the only host it can reach is this one.
      OPENAI_BASE_URL: `http://127.0.0.1:${port}`,
    },
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
  await new Promise<void>((resolve) => stub.close(() => resolve()))
})

/** The panel that is currently exposed — hidden panels are out of the accessibility tree. */
const view = (): ReturnType<Page['locator']> => page.locator('.tab-panel:not([hidden])')

const answer = () => view().locator('.assistant-answer')

test.beforeAll(async () => {
  // A profile is the one grounding that needs neither a gateway nor an import, and it is what opens
  // the question box (`askGate`'s `no_grounding`).
  await page.getByRole('tab', { name: /^Assistant/ }).click()
  await expect(view().getByRole('heading', { level: 1, name: 'AI Assistant' })).toBeVisible()
  await view().getByRole('button', { name: 'Dividend income' }).click()
  await view().getByRole('button', { name: 'Save profile' }).click()

  sent = []
  replies = [MARKDOWN]
  await view().getByLabel('Your question').fill('Where do I stand?')
  await view().getByRole('button', { name: 'Ask' }).click()
  await expect(view().locator('.assistant-thinking')).toHaveCount(0)
})

/**
 * The ground the answer renders on moved (Story #344, DDR-0115 decision 7): it was the page's own
 * background, and it is the model's bubble now. That is a cascade, so it is proved here rather
 * than by a text scan — and it is what every ink inside the answer is measured against in
 * `contrast.ts`, including the code chip's own recessed well.
 */
test('the answer renders inside the model’s bubble, on the card surface', async () => {
  const bubble = view().locator('.assistant-bubble-model').first()

  await expect(bubble.locator('.assistant-answer')).toHaveCount(1)
  await expect(bubble).toHaveCSS('background-color', 'rgb(15, 19, 32)')
  // The asymmetric corner points at the speaker: flat top-left, `--radius-lg` on the other three.
  await expect(bubble).toHaveCSS('border-top-left-radius', '2px')
  await expect(bubble).toHaveCSS('border-bottom-right-radius', '12px')
})

test('no marker character survives where it was markup', async () => {
  const text = (await answer().innerText()).trim()

  expect(text).not.toContain('**')
  expect(text).not.toContain('## ')
  expect(text).not.toMatch(/\| ---/)
  expect(text).not.toContain('`')
  // And every word the model wrote is still on screen.
  for (const word of ['Rio Tinto', 'Serabi Gold', '12.4%', 'ceiling', 'Another']) {
    expect(text).toContain(word)
  }
})

test('a heading is a heading, and it sits under the card’s own', async () => {
  // The view's `<h1>` is "Assistant" and the card's title is the `<h2>`, so a model-authored `#`
  // starts at `h3` and `##` — what the prompt's own register produces — lands on `h4`. An answer
  // cannot restructure the page outline by writing a hash.
  const heading = answer().getByRole('heading', { name: 'Where you stand' })
  await expect(heading).toHaveJSProperty('tagName', 'H4')
  // And it is drawn as a section title rather than at body size, which is the half the tag alone
  // does not settle.
  await expect(heading).toHaveCSS('font-size', '17.6px')
})

test('bold, italic and inline code are elements rather than characters', async () => {
  await expect(answer().locator('strong')).toHaveText('Rio Tinto')
  await expect(answer().locator('em')).toHaveText('above')
  await expect(answer().locator('code')).toHaveText('RIO')
})

test('a numbered list is a list, and so is a bulleted one', async () => {
  await expect(answer().locator('ol > li')).toHaveText(['Trim Rio Tinto', 'Leave the rest'])
  await expect(answer().locator('ul > li')).toHaveText(['A bullet', 'Another'])
})

test('a quote is drawn as one', async () => {
  await expect(answer().locator('blockquote')).toContainText('Judged against your own profile.')
})

/**
 * The cascade half, which no text scan can resolve. `.assistant-answer th` is a class *and* a type,
 * so an unscoped alignment class loses to it and every column the model aligned reads as left.
 */
test('a pipe table is a grid, aligned the way the model asked', async () => {
  await expect(answer().locator('table thead th')).toHaveText(['Position', 'Weight'])
  await expect(answer().locator('table tbody tr')).toHaveCount(2)

  const weight = answer().locator('table tbody tr').first().locator('td').nth(1)
  await expect(weight).toHaveText('12.4%')
  await expect(weight).toHaveCSS('text-align', 'right')

  const position = answer().locator('table tbody tr').first().locator('td').first()
  await expect(position).toHaveCSS('text-align', 'left')
})

test('a wide table scrolls inside the answer rather than widening the card', async () => {
  await expect(answer().locator('.assistant-table')).toHaveCSS('overflow-x', 'auto')
})

/**
 * The story's own boundary (DDR-0113, DDR-0114): formatting is a **render** concern. What the next
 * turn carries is the string that came back, markers and all — the model reads its own markdown,
 * not this app's rendering of it.
 */
test('the next question remembers the raw markdown, not the rendering', async () => {
  replies = ['A follow-up answer.']
  await view().getByLabel('Your question').fill('And the second one?')
  await view().getByRole('button', { name: 'Ask' }).click()
  await expect(view().locator('.assistant-thinking')).toHaveCount(0)

  const remembered = sent[1]!.messages.find((message) => message.role === 'assistant')
  expect(remembered?.content).toBe(MARKDOWN)
})
