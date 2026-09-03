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
 * body** — and that the New conversation control, whose confirm expands in place, empties what the
 * next question would carry.
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
 * The control expands in place rather than opening a modal (DDR-0012), which is a cascade no text
 * scan can resolve, and clearing the transcript is what makes the *next* question a first one.
 */
test('New conversation confirms in place, and the next question starts fresh', async () => {
  await expect(view().locator('.assistant-turn')).toHaveCount(2)

  await view().getByRole('button', { name: 'New conversation' }).click()
  const confirm = view().getByRole('group', { name: 'Confirm: New conversation' })
  await expect(confirm).toBeVisible()
  await expect(confirm.getByText(/stop remembering/)).toBeVisible()

  // Cancel first: an in-place confirm that cannot be backed out of is a modal with extra steps.
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(view().locator('.assistant-turn')).toHaveCount(2)

  await view().getByRole('button', { name: 'New conversation' }).click()
  await view().getByRole('button', { name: 'Yes, start a new conversation' }).click()
  await expect(view().locator('.assistant-turn')).toHaveCount(0)

  replies = ['A fresh answer.']
  await ask('Starting over: what do I hold?')

  expect(sent).toHaveLength(3)
  const turns = conversation(2)
  expect(turns).toHaveLength(1)
  expect(turns[0]!.content).toContain('Starting over')
  expect(turns[0]!.content).not.toContain('Serabi Gold')
})

/** The control is about a conversation, so it is not offered before there is one. */
test('offers nothing to clear once the conversation is one turn old again', async () => {
  await expect(view().getByRole('button', { name: 'New conversation' })).toBeVisible()

  await view().getByRole('button', { name: 'New conversation' }).click()
  await view().getByRole('button', { name: 'Yes, start a new conversation' }).click()

  await expect(view().locator('.assistant-turn')).toHaveCount(0)
  await expect(view().getByRole('button', { name: 'New conversation' })).toHaveCount(0)
})
