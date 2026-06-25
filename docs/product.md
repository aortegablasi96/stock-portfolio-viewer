# Product

Stock Portfolio Viewer is a personal, single-user **desktop application** focused on
understanding and analyzing investment portfolios. It is **local-first and private** (runs
on the owner's machine, stores data locally, not hosted or shared) and **analytics-first**,
not advice-first.

## Vision

Help an investor understand *what* their portfolio is and *how* it has behaved over time,
without ever telling them what to buy, sell, or hold.

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

- Investment recommendations
- Automated trading
- Order execution
- Robo-advisor functionality

The user always remains the decision maker.

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
