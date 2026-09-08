/**
 * Load the whole demo into an app database in one command: import the three Flex exports,
 * classify sectors from the gateway, and save the investor profile.
 *
 *   npm run build                 # seeds through the built app, not the dev server
 *   npm run demo:gateway          # in another terminal — classification reads it
 *   npm run demo:seed             # add -- --replace to overwrite an existing database
 *
 * The alternative is doing it by hand in the running app, which is four clicks and a form; both
 * work and `demo/README.md` documents each. This exists because the profile is a form with
 * thirteen ranges in it, and typing those before a demo is how a demo starts late.
 *
 * Two things to know:
 *
 * **It refuses to overwrite.** The target defaults to the app's real user-data directory, and a
 * database already there is the owner's until they say otherwise — `--replace` is that say-so.
 *
 * **It ends any running app.** Driving Electron from Playwright terminates every Electron
 * instance on the machine, including ones this script did not start (see the `run-app` skill).
 * Seed first, launch second.
 */

import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from '@playwright/test'
import { DEMO_PROFILE } from './profile.mjs'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}

/** Where Electron keeps this app's user data, per platform. */
function defaultUserData() {
  const name = 'stock-portfolio-viewer'
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), name)
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', name)
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), name)
}

const userData = option('--user-data', defaultUserData())
const gatewayUrl = option('--gateway', 'http://localhost:5055')
const mainEntry = join(process.cwd(), 'out', 'main', 'index.js')
const files = ['demo-2024.xml', 'demo-2025.xml', 'demo-2026.xml'].map((f) =>
  join(process.cwd(), 'demo', 'flex', f),
)

if (!existsSync(mainEntry)) {
  console.error(`No build at ${mainEntry} — run \`npm run build\` first.`)
  process.exit(1)
}

const database = join(userData, 'portfolio.db')
if (existsSync(database)) {
  if (!flag('--replace')) {
    console.error(`A database already exists at ${database}.`)
    console.error('Refusing to overwrite it. Pass --replace if that is what you want,')
    console.error('or --user-data <dir> to seed somewhere else.')
    process.exit(1)
  }
  // Replaced rather than cleared through the app: `clearAll()` is per domain (ADR-0006) and
  // would leave the classification cache and the profile from a previous seed behind, which is
  // the state this script exists to make reproducible.
  rmSync(database, { force: true })
}

const app = await electron.launch({
  args: [mainEntry, `--user-data-dir=${userData}`],
  env: { ...process.env, IBKR_GATEWAY_URL: gatewayUrl },
})

// The import opens a native file picker, which nothing outside the app can answer. Stubbing the
// dialog in main is the only seam: the import path itself stays exactly the one the owner uses.
await app.evaluate(({ dialog }, filePaths) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths })
}, files)

const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')

const imported = await page.evaluate(() => window.api.importFlexStatements())
if (imported.status !== 'imported') {
  console.error(`Import failed: ${imported.status}`, imported.message ?? '')
  await app.close()
  process.exit(1)
}
console.log(`imported ${imported.summary.statements.length} statements`)

const saved = await page.evaluate((profile) => window.api.saveInvestorProfile(profile), DEMO_PROFILE)
if (saved.status !== 'saved') {
  console.error(`Profile save failed: ${saved.status}`, saved.message ?? '')
  await app.close()
  process.exit(1)
}
console.log(
  `saved profile · ${DEMO_PROFILE.sectorTargets.length} sector targets, ` +
    `${DEMO_PROFILE.currencyTargets.length} currency targets, ${DEMO_PROFILE.styleTags.length} style tags`,
)

// Sectors are a gateway read the owner triggers by hand; do it once so the demo opens complete.
// A failure here is not fatal: the refresh is resumable (DDR-0023), the rest of the demo is
// already seeded, and the owner can press the button once the gateway is up.
const classified = await page.evaluate(() => window.api.classifyInstruments())
if (classified.status === 'ok') {
  console.log(
    `classified ${classified.summary.classified} of ${classified.summary.total} instruments` +
      (classified.summary.unclassified > 0 ? ` (${classified.summary.unclassified} without a sector)` : ''),
  )
} else {
  console.warn(`classification did not finish: ${classified.status}. Is the demo gateway running?`)
  console.warn('Sectors will read "Unclassified" until Allocation → Sector → Classify from IBKR.')
}

await app.close()
console.log(`\nSeeded ${database}`)
console.log('Launch with:  IBKR_GATEWAY_URL=' + gatewayUrl + ' npm run dev')
