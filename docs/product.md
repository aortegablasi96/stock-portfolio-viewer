# Product

Stock Portfolio Viewer is a personal, single-user **desktop application** focused on
understanding and analyzing investment portfolios. It is **local-first** (runs on the owner's
machine, stores data locally, not hosted or shared), with **one qualification**: the AI
assistant sends portfolio-derived figures to OpenAI, gated on the owner's consent
(ADR-0010). Every other data path stays on the machine.

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
