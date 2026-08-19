---
name: run-app
description: Launch Stock Portfolio Viewer so a human can use it, or screenshot its views against a real import. Use when asked to run, start, open, or screenshot the app, or to confirm a change works in the running app rather than in tests.
---

# Running Stock Portfolio Viewer

Two different jobs, and they **cannot run at the same time** — see *Captures end a running app*.

- **Interactive** — a window on the owner's screen, for them to click through.
- **Capture** — screenshots of one or more views, for a before/after in a PR.

Every command below was run on Windows and produced the stated result. Where something has an
obvious-looking alternative that fails, the failure is recorded rather than omitted.

## Interactive: put a window on screen

```powershell
Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev" `
  -WorkingDirectory "<repo>" `
  -RedirectStandardOutput "<scratchpad>\app-out.log" `
  -RedirectStandardError  "<scratchpad>\app-err.log"
```

`Start-Process` is the point. **`npm run dev` from a backgrounded shell exits the moment its stdin
reaches EOF** — the dev server tears down and takes the window with it, with `[exited with code 0]`
and nothing in the log to suggest a problem. Detaching it gives it a console of its own; the
redirects keep the log readable.

Verify with the **window handle**, never the process list:

```powershell
Get-Process -Name electron | Where-Object { $_.MainWindowHandle -ne 0 } |
  Select-Object Id, MainWindowTitle
```

`MainWindowTitle` reads `Stock Portfolio Viewer` when the app is really up. Three live `electron`
processes with `MainWindowHandle = 0` is the failure mode this catches: `src/main/index.ts` creates
the window with `show: false` and shows it on `ready-to-show`, so a renderer that never loads
leaves a hidden window and a process tree that looks healthy.

**Do not launch `electron.exe out/main/index.js` directly** to get an interactive window. It starts,
applies migrations, logs normally — and never shows anything.

Stop it with `Get-Process -Name electron,node | Stop-Process -Force` (`node` is the Vite dev
server, which outlives the window).

### What the owner will see

- **Portfolio** shows the not-connected state unless the IBKR Client Portal Gateway is running on
  `https://localhost:5000`; the log line is `[snapshot] capture-on-open: not_connected`. The four
  analytics views read imported Flex data and need no gateway.
- Renderer edits hot-reload. **Main-process edits need a relaunch** — there is no HMR across the
  process boundary.

## Capture: screenshots against a real import

```bash
npm run build
node .claude/skills/run-app/capture.mjs <out-dir> <label> Trades Allocation
```

Writes `<out-dir>/trades-<label>.png`. Views are the sidebar tab names: `Portfolio`,
`Performance`, `Allocation`, `Dividends`, `Trades`.

The script copies the owner's `portfolio.db` into a throwaway `--user-data-dir`. **A fresh
user-data directory renders `needs_import` on all four analytics views**, so a capture from one
shows empty states rather than the thing under review. Copy, never open the real one: launching
applies migrations and may capture a snapshot.

It lives in the repo so its `@playwright/test` import resolves by walking up to `node_modules`.
The same file in a scratchpad directory fails with `Cannot find module '@playwright/test'` — which
is why this is committed rather than written fresh each time.

### Captures end a running app

**Running the capture terminates every running Electron instance**, including one the capture
never launched. Verified: with an interactive app up (`pid 7696`) and a second instance up under
its own `--user-data-dir` (`pid 13844`), a Playwright `electron.launch()` from this repo left
neither alive. It is not the single-instance lock — that is scoped to the user-data directory, and
two instances started *without* Playwright coexist fine. It is not `app.close()` either — a launch
that deliberately skips the close does it too.

So: **capture first, then launch for the human.** If the owner is reviewing and a capture is
needed, tell them the window will close, and relaunch afterwards.

## Reading the database without launching anything

`better-sqlite3` is built for Electron's ABI and throws `NODE_MODULE_VERSION` under plain Node.
Node's own module reads the same file:

```bash
node --experimental-sqlite -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(process.argv[1],{readOnly:true});
for (const r of db.prepare('select symbol, description from flex_trades limit 5').all()) console.log(r);
" "$APPDATA/stock-portfolio-viewer/portfolio.db"
```

Copy the file first if anything might write. Use this to check what a Flex export actually contains
before designing a rule about it — two stories have now been filed on a premise one query
disproved.

## Driving a view: the locator trap

Analytics views **mount on first visit and stay mounted** (DDR-0027), so every visited view's DOM
is still in the document. `page.locator('table').first()` matches the first table across *all*
mounted panels, not the visible one — it silently returned Allocation's asset-class table when the
Dividends view was on screen. Scope by something the view owns:

```js
page.locator('table').filter({ has: page.getByText('Dividend income by ticker') })
```

Tab names come from the tablist: `page.getByRole('tab', { name: /^Trades$/i })`.
