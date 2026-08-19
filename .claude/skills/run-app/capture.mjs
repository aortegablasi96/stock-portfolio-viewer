/**
 * Screenshot one or more views of the built app, against a copy of the owner's real database.
 *
 *   npm run build
 *   node .claude/skills/run-app/capture.mjs <out-dir> <label> <view> [view...]
 *
 * Views are the sidebar tab names: Portfolio, Performance, Allocation, Dividends, Trades.
 * Writes <out-dir>/<view-lowercased>-<label>.png.
 *
 * It copies `portfolio.db` rather than opening it: launching applies migrations and may capture a
 * snapshot, and the single-instance lock is scoped to the user-data directory — so aiming at the
 * real one either mutates the owner's data or quits instantly while their app is open. With the
 * copy, this coexists with a running app.
 */
import { join } from 'node:path'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { _electron as electron } from '@playwright/test'

const [outDir, label, ...views] = process.argv.slice(2)
if (!outDir || !label || views.length === 0) {
  console.error('usage: capture.mjs <out-dir> <label> <view> [view...]')
  process.exit(2)
}

const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
const realDb = join(appData, 'stock-portfolio-viewer', 'portfolio.db')
const mainEntry = join(process.cwd(), 'out', 'main', 'index.js')

async function main() {
  if (!existsSync(mainEntry)) throw new Error(`no build at ${mainEntry} — run \`npm run build\``)
  if (!existsSync(realDb)) throw new Error(`no database at ${realDb} — import a Flex statement first`)

  const userData = mkdtempSync(join(tmpdir(), 'spv-shot-'))
  copyFileSync(realDb, join(userData, 'portfolio.db'))
  mkdirSync(outDir, { recursive: true })

  const app = await electron.launch({ args: [mainEntry, `--user-data-dir=${userData}`] })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.setViewportSize({ width: 1440, height: 1000 })

  for (const view of views) {
    await page.getByRole('tab', { name: new RegExp(`^${view}$`, 'i') }).click()
    // Analytics views mount on first visit and read over IPC; give the report time to land.
    await page.waitForTimeout(2600)
    const file = join(outDir, `${view.toLowerCase()}-${label}.png`)
    await page.screenshot({ path: file, fullPage: true })
    console.log(file)
  }

  await app.close()
}

main().catch((error) => {
  console.error(error.message ?? error)
  process.exit(1)
})
