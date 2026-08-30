# Product

Stock Portfolio Viewer is a personal, single-user **desktop application** focused on
understanding and analyzing investment portfolios. It is **local-first** (runs on the owner's
machine, stores data locally, not hosted or shared), with **one qualification**: the AI
assistant sends portfolio-derived figures to OpenAI whenever the owner has supplied a key and
asks a question (ADR-0010, ADR-0011). Supplying the key is what authorizes it; removing the key
is what stops it. Every other data path stays on the machine.

## Vision

Help an investor understand *what* their portfolio is and *how* it has behaved over time — and,
against targets they set themselves, whether it still matches how they meant to invest.

The app **proposes; it never acts, and it never sets the policy.** The owner writes the investor
profile; the app measures the portfolio against it and may suggest how to close a gap, naming
positions. It places no orders and has no path to one. Suggesting the owner change their targets
is out of scope — that decision is theirs (ADR-0009).

## Current Capabilities

- Portfolio dashboard
- Holdings visualization
- Historical portfolio snapshots
- Performance analytics
- Allocation analysis
- Dividend tracking
- **An investor profile** — the owner's own style tags and target ranges for currency, sector and
  asset-class weight, plus a single-position size band. It is the standard the app measures
  against, and the app never proposes one of its own (Story #280, DDR-0094).
- **Balance drift against that profile**, computed deterministically by a service — no model does
  the arithmetic (Story #281, DDR-0095).
- **An OpenAI key the owner sets, from inside the app or the environment**, the environment winning
  and the order reported rather than silent (Story #300, DDR-0105). It is the app's one control over
  whether portfolio-derived figures leave the machine: with a key present a question is sent with
  nothing in front of it, and without one nothing is (ADR-0011). What may be sent is bounded by
  `DISCLOSURE_CATEGORIES` — three of its five sections carry percentages and text only; only
  performance carries amounts of money.
- **An assistant that answers questions about the portfolio**, grounded in text the app wrote from
  reports it already computed — the model phrases figures and never produces one (Story #284,
  DDR-0098).
- **An explanation of what changed over a period the owner chooses**, in the app's own range
  presets. It keeps a **return** and a **change in value** apart — the performance curve is
  time-weighted, so deposits and withdrawals move value and not return — names the flows where they
  moved value, and never offers a cause it cannot observe: no market events, no news, no
  fundamentals (Story #285, DDR-0099).
- **A summary of how the portfolio has performed**, bounded by what the app actually computes. It
  states how long the period really is rather than **annualising** a short history, compares against
  **no benchmark** (the app holds none), and describes the ride only from the daily returns it has —
  never a volatility, Sharpe ratio, beta or drawdown figure (Story #286, DDR-0101).

## Future Capabilities

- AI-assisted portfolio analysis
- Multi-broker support
- Benchmark comparison
- Tax reporting

## Out of Scope

Stock Portfolio Viewer deliberately does **not** provide:

- Automated trading
- Order execution, or any path to it
- Automated or scheduled rebalancing
- Proposals to change the owner's own investor profile
- Instrument screening, ranking or discovery from market data the app does not hold

The user always remains the decision maker: every suggestion is read and acted on by hand.

Suggestions that name an instrument the owner does not already hold are **not grounded in the
app's data** — they come from the model, unverified and not price-checked — and are marked as
such wherever they appear (ADR-0009).

## Users

- **Primary (and only):** the single owner of the machine — an individual investor with
  one or more brokerage accounts (initially Interactive Brokers) who wants clearer insight
  into their holdings and performance. There is no multi-user or account system.

## Data Sources

- **Interactive Brokers** is the live source of truth for positions and balances, reached
  via the local Client Portal Gateway.
- **Local SQLite database** stores historical snapshots and cached analytics for fast,
  repeatable analysis without repeatedly querying the broker. All data stays on the
  owner's machine.

> This document is a living artifact. Product Reviews (see the `product-manager` skill)
> refine and extend it as features are scoped.
