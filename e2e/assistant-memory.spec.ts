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
 * The conversation reaching the wire (Story #320, DDR-0113).
 *
 * `lib/assistantHistory.test.ts` holds every selection rule and `assistantService.test.ts` holds the
 * message array's shape. Neither can see the one thing this story is actually about: that a question
 * typed into a real window carries the turns before it **all the way through IPC to the request
 * body** — and that Clear chat, in the chat header's chip row, empties what the next question would
 * carry.
 *
 * ## Nothing leaves this machine, and that is enforced rather than promised
 *
 * `OPENAI_BASE_URL` is the seam `aiGateway`'s own transport tests use, and here it points at a
 * **local stub** started by this file. Every request the app makes is served on `127.0.0.1`, which
 * is what makes asking a real question safe in a suite — the sibling `assistant-ask.spec.ts` states
 * as its own premise that it never asks one, precisely because it has no stub. The store is empty
 * and the profile is one typed here, so there is no owner data in play either way.
 *
 * The stub keeps every request body, which is what turns "the conversation was remembered" from a
 * screen assertion into a wire assertion.
 */

let app: ElectronApplication
let page: Page
let stub: Server

/** Every request body the app has sent, oldest first. Reset between the tests that care. */
let sent: { messages: { role: string; content: string }[] }[] = []

/** What the stub answers with next. One canned reply per question, in order. */
let replies: string[] = []

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
    args: [mainEntry, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'spv-e2e-memory-'))}`],
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

const questionBox = () => view().getByLabel('Your question')

/** Type a question, send it, and wait for the answer to replace the waiting state. */
const ask = async (question: string): Promise<void> => {
  await questionBox().fill(question)
  await view().getByRole('button', { name: 'Ask' }).click()
  await expect(view().locator('.assistant-thinking')).toHaveCount(0)
}

/** The user and assistant turns of the nth request, with the system prompt dropped. */
const conversation = (index: number): { role: string; content: string }[] =>
  sent[index]!.messages.filter((message) => message.role !== 'system')

test.beforeAll(async () => {
  // A profile is the one grounding that needs neither a gateway nor an import, and it is what opens
  // the question box (`askGate`'s `no_grounding`).
  await page.getByRole('tab', { name: /^Assistant/ }).click()
  await expect(view().getByRole('heading', { level: 1, name: 'AI Assistant' })).toBeVisible()
  await view().getByRole('button', { name: 'Dividend income' }).click()
  await view().getByRole('button', { name: 'Save profile' }).click()
  await expect(questionBox()).toBeVisible()
})

test('the first question is single-shot, exactly as it always was', async () => {
  sent = []
  replies = ['Rio Tinto, then Serabi Gold.']

  await ask('What do I hold?')

  expect(sent).toHaveLength(1)
  const turns = conversation(0)
  expect(turns).toHaveLength(1)
  expect(turns[0]!.role).toBe('user')
  expect(turns[0]!.content).toContain('What do I hold?')
})

/**
 * **The story, on the wire.** The follow-up carries the previous question and the previous answer,
 * in order, and the answer is attributed to the model rather than folded into the app's own turn.
 */
test('a follow-up carries the turns before it, the answer under the model’s own role', async () => {
  replies = ['Serabi Gold is the second.']

  await ask('And the second one?')

  expect(sent).toHaveLength(2)
  const turns = conversation(1)
  expect(turns).toHaveLength(3)
  expect(turns[0]).toEqual({ role: 'user', content: 'What do I hold?' })
  expect(turns[1]).toEqual({ role: 'assistant', content: 'Rio Tinto, then Serabi Gold.' })
  expect(turns[2]!.role).toBe('user')
  expect(turns[2]!.content).toContain('And the second one?')
})

/**
 * The transcript's own half of the same story (Story #344, DDR-0115 decision 7).
 *
 * The wire assertions above prove the conversation reaches the model oldest-first. This proves the
 * screen reads the same way — and the two are produced by *different* code over an array held in
 * the opposite order, which is exactly why both are worth asserting. A `reverse()` in the wrong
 * place makes one of them wrong and the other still right.
 */
test('the transcript reads oldest-first, each bubble marked with who said it and when', async () => {
  const turns = view().locator('.assistant-turn')
  await expect(turns).toHaveCount(2)

  await expect(turns.first().locator('.assistant-bubble-you')).toHaveText('What do I hold?')
  await expect(turns.last().locator('.assistant-bubble-you')).toHaveText('And the second one?')

  // `WHO · TIME`, one above each of a turn's two bubbles. The time is `APP_LOCALE`'s 24-hour
  // clock, never the host's — `format.test.ts` pins the string, this pins that it is drawn.
  const roles = turns.first().locator('.assistant-turn-role')
  await expect(roles).toHaveCount(2)
  await expect(roles.first()).toHaveText(/^You · \d\d:\d\d$/)
  await expect(roles.last()).toHaveText(/^Assistant · \d\d:\d\d$/)
})

/**
 * The grounding block appears **once** in a conversation, on the question being asked — a remembered
 * question is the bare text the owner typed (DDR-0113, decision 3). Restating the absences per turn
 * would leave the model deciding which copy is current.
 */
test('the grounding block is sent once, however long the conversation is', () => {
  const grounded = sent[1]!.messages.filter((message) =>
    message.content.includes('Before any figure'),
  )

  expect(grounded).toHaveLength(1)
  expect(grounded[0]!.content).toContain('And the second one?')
})

/**
 * **No tool result and no tool call ever crosses a turn** (DDR-0113, decision 2) — the decision that
 * keeps ADR-0009's seam open. A figure survives into the next question only inside a sentence
 * attributed to the model, with no report standing behind it.
 */
test('carries no report from an earlier turn', () => {
  expect(sent[1]!.messages.some((message) => message.role === 'tool')).toBe(false)
  expect(
    sent[1]!.messages.some((message) => 'tool_calls' in (message as Record<string, unknown>)),
  ).toBe(false)
})

/**
 * **One click, no confirmation** (Story #346, DDR-0115 amendment 5). The `ConfirmAction` that used
 * to stand in front of this went with the design's answer: nothing stored is touched, so ADR-0006
 * does not reach it, and the design's own guard is the *disabled* state asserted below. What is
 * under test here is the part no unit test can see — that the click empties the transcript, and
 * that the *next* question therefore goes to the wire as a first one.
 */
test('Clear chat empties the conversation in one click, and the next question starts fresh', async () => {
  await expect(view().locator('.assistant-turn')).toHaveCount(2)

  // The fact the old warning carried, on the control that carries it now.
  await expect(view().getByRole('button', { name: 'Clear chat' })).toHaveAttribute(
    'title',
    /stops remembering/,
  )
  await expect(view().getByRole('group', { name: /^Confirm:/ })).toHaveCount(0)

  await view().getByRole('button', { name: 'Clear chat' }).click()
  await expect(view().locator('.assistant-turn')).toHaveCount(0)

  replies = ['A fresh answer.']
  await ask('Starting over: what do I hold?')

  expect(sent).toHaveLength(3)
  const turns = conversation(2)
  expect(turns).toHaveLength(1)
  expect(turns[0]!.content).toContain('Starting over')
  expect(turns[0]!.content).not.toContain('Serabi Gold')
})

/**
 * The control is about a conversation, and with none it is **disabled rather than absent**
 * (Story #346). That is the design's own guard and the whole of the protection now — and it is
 * drawn in both states on purpose: a control appearing the moment the first answer lands moves the
 * chip row under the pointer.
 */
test('is disabled, not withdrawn, once there is nothing left to clear', async () => {
  const clear = view().getByRole('button', { name: 'Clear chat' })
  await expect(clear).toBeEnabled()

  await clear.click()

  await expect(view().locator('.assistant-turn')).toHaveCount(0)
  await expect(clear).toBeVisible()
  await expect(clear).toBeDisabled()
})

/**
 * **Enter sends** (Story #345), and this is the only suite that can prove it: pressing Enter asks a
 * real question, so it needs the local stub listening on `127.0.0.1`. `assistant-ask.spec.ts` owns
 * the two branches that send nothing — Shift+Enter, and Enter on a blank box — because its own
 * premise is that no question ever leaves it.
 *
 * The assertion is on the **wire**, not the screen: the key press goes through the form's
 * `onSubmit`, so what arrives is a question shaped exactly like the button's, in a conversation
 * Clear chat has just emptied.
 */
test('Enter sends the question, through the same path the button uses', async () => {
  sent = []
  replies = ['Answered from a keystroke.']

  await questionBox().fill('Does Enter send this?')
  await questionBox().press('Enter')
  await expect(view().locator('.assistant-thinking')).toHaveCount(0)

  expect(sent).toHaveLength(1)
  const turns = conversation(0)
  expect(turns).toHaveLength(1)
  expect(turns[0]!.role).toBe('user')
  expect(turns[0]!.content).toContain('Does Enter send this?')

  // And the newline the key would otherwise have inserted is not in the box or the question —
  // `preventDefault` is load-bearing, and its absence would show up as both.
  await expect(questionBox()).toHaveValue('')
  expect(turns[0]!.content).not.toContain('Does Enter send this?\n')
})
