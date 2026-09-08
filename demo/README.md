# Demo data

A complete portfolio built for demonstration, so the app can be shown to someone without
showing them the owner's real one.

**The companies are real; the portfolio is not.** Every quantity, price, price path, trade date,
dividend, balance and the account number itself is invented by `scripts/demo/`. Nothing here is
market data, nothing is a record of what these companies actually did, nothing is anyone's real
position, and nothing is advice. Prices are only in the right ballpark so the figures sit
naturally beside each other.

What *is* real is each company's published reference data — ISIN, listing exchange, issuer
country, and IBKR's sector and industry — because a demo that files Nestlé under Banks looks
broken. The **structure** of the export is real too: same sections, same attributes, same
relationships between the figures as the owner's own exports, because that structure is what
the parser and the views are written against.

```text
demo/flex/demo-2024.xml     Flex Query export, the quarter the account opened
demo/flex/demo-2025.xml     Flex Query export, full year 2025
demo/flex/demo-2026.xml     Flex Query export, year to date (ends 2026-09-04)
demo/gateway/state.json     the live reading the fake gateway serves
```

## Running the demo

**1 — Start with an empty app.** The app's database lives at
`%APPDATA%/stock-portfolio-viewer/portfolio.db` (Windows) or the platform's equivalent
`userData` directory. Deleting the file clears everything and the app re-migrates a fresh one on
next launch; clearing Flex, snapshots and the profile from inside the app does the same job
without losing the saved window geometry or an API key stored in-app.

**2 — Start the fake gateway**, so the live views have something to read:

```bash
npm run demo:gateway              # http://localhost:5055
npm run demo:gateway -- --static  # freeze prices instead of drifting them
npm run demo:gateway -- --down    # answer 401, to show the not-connected state
```

**3 — Point the app at it.** The gateway URL is read from the environment once at startup, so a
shell variable is enough and leaves `.env` untouched:

```bash
IBKR_GATEWAY_URL=http://localhost:5055 npm run dev
```

For a longer-lived setup, put `IBKR_GATEWAY_URL=http://localhost:5055` in `.env` instead and
restart the app. A real OS environment variable wins over the file either way.

**4 — Load the data.** One command does the lot — import, sectors, and the investor profile:

```bash
npm run build          # the seeder drives the built app, not the dev server
npm run demo:seed      # add -- --replace to overwrite an existing database
```

It refuses to overwrite a database that is already there, and it ends any running Electron
instance (driving the app from Playwright does that — see the `run-app` skill), so seed first and
launch second.

By hand instead, if you prefer to show the import itself:

- **Flex → Import**, and choose **all three** files from `demo/flex/` (the picker is
  multi-select). Order does not matter to the app, but oldest-first is the owner's own workflow.
  The 2024 quarter is small and easy to skip; don't. It holds the opening purchases, and the
  Dividends view reconstructs share counts from imported trades — without it a payment is divided
  by only the shares bought later, and the per-share figure it prints is one that never existed.
- **Allocation → Sector → Classify from IBKR.** Sectors are not in a Flex export; the app reads
  them from the gateway on demand and caches them, so this is one click and then it stays done.
- **The investor profile** is thirteen ranges in a form. That one is worth letting the seeder do.

## Regenerating

```bash
npm run demo:generate
```

The simulation is seeded, so this is a no-op unless `scripts/demo/universe.mjs` or
`scripts/demo/simulate.mjs` changed. Everything is derived from one pass of a single state
machine — positions, cash, dividends, accruals, realized P&L, the daily NAV series and the live
gateway reading — which is what keeps the figures agreeing with each other. Hand-written
fixtures do not agree with each other, and the app cross-checks them in half a dozen places.

`src/repositories/flex/demoStatements.test.ts` holds the generated exports to the identities the
views read them by, and runs in CI: the demo cannot silently rot.

## What the demo portfolio shows

A EUR-based account that arrives **already funded**: €68,000 in cash the day before the first
statement opens, the way a transferred-in account does, then four top-ups of €24,500 between
them. Worth roughly €107,900 at the end of the last statement.

The opening balance is deliberate. An account that opens at zero gives the app's headline
"value change %" no denominator, and the tile reads as an em dash. It also has to *dominate* the
later contributions: that percentage is measured against the opening value, so an account funded
mostly by top-ups reports a figure that is mathematically true and reads as nonsense.

Nine open positions, spread deliberately wide so every view has something to draw — **eight IBKR
sectors, six currencies and eight countries**:

| | Sector | Currency | Country |
| --- | --- | --- | --- |
| ASML Holding | Technology | EUR | NL |
| Apple | Technology | USD | US |
| Banco Santander | Financial | EUR | ES |
| Rio Tinto | Basic Materials | GBP | GB |
| Nestlé | Consumer, Non-cyclical | CHF | CH |
| Exxon Mobil | Energy | USD | US |
| BCE | Communications | CAD | CA |
| Toyota Motor | Consumer, Cyclical | JPY | JP |
| Schneider Electric | Industrial | EUR | FR |

### The investor profile

The demo ships with a profile already saved (`scripts/demo/profile.mjs`), because "is this
portfolio balanced?" has no answer without one — balance is a relation between a portfolio and an
intent, and the app never invents the intent.

It is written to sit **mostly** on top of the portfolio, with a few deliberate gaps. A profile
that matched every weight would say "balanced" eight times and leave the assistant nothing to
discuss; one that matched nothing would make the app look like it disapproves of the portfolio it
was handed. What is left over:

| | |
| --- | --- |
| **Technology 29% against a 18–25% target** | the two largest holdings are both tech; the app proposes trimming 4.0pp across ASML and Apple, proportionally |
| **Consumer, Non-cyclical 7% against 10–16%** | underweight defensives, which contradicts the owner's own "defensive sectors" style tag — the other half of the same conversation |
| **GBP 13% against 5–12%** | one mining holding grew into more sterling than intended, the kind of drift nobody notices because nothing about the position changed |
| **Communications has no target at all** | not a target of zero — no policy, so its 7% surfaces as untargeted rather than as a breach |

Asset class and position size are left blank on purpose, so the **app's own baseline** speaks for
them and the demo shows both standards side by side, each attributed: cash at 9% inside the
baseline's 15% ceiling, ASML at 15% above its 10% position ceiling, no bonds held — and the
baseline's sector check *stood down*, because the owner set sector targets there. Three checks
applied, one deferred, is ADR-0012 on one screen.

Two more were closed — one at a gain in 2025, one at a loss in 2026 — and a partial sale is held
long enough to realise as a long-term gain, so the realized-gains report has both ends to list.
Two held positions are under water, because a demo where everything went up demonstrates
nothing. Dividends pay across the whole period, and the 2025 and 2026 statements each end
between a declaration and its payment, so the upcoming-income panel has something in it whichever
of them is the latest imported.
