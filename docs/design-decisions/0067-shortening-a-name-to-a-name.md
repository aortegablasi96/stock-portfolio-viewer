# 0067. Position decides a common noun; a legal form always goes

- **Status:** Accepted
- **Date:** 2026-08-20

## Context

`formatCompanyName` shortens a raw IBKR name by stripping a trailing share-class descriptor, then
repeatedly stripping trailing legal-form tokens, then title-casing. Story #211 routed every view
through it (DDR-0066), which widened its audience from **dividend payers** to **every instrument
the owner has traded or holds**, and flagged two of its judgements as unexamined.

Running the real function over a wider name set found those two and a third that nothing had
noticed. Output before this story:

| Input | Before |
| --- | --- |
| `THE WALT DISNEY COMPANY` | `The Walt Disney` |
| `THE COCA-COLA CO` | `The Coca-Cola` |
| `JUROKU FINANCIAL GROUP INC` | `Juroku Financial` |
| `GOLDMAN SACHS GROUP INC` | `Goldman Sachs` |
| `MASSAGE ENVY SPA` | `Massage Envy` |
| `LVMH MOET HENNESSY LOUIS VUITTON SE` | `Lvmh Moet Hennessy Louis Vuitton` |

## Decision

### The suffix list was one list doing two jobs

```ts
const LEGAL_FORM =
  /\s+(?:INC(?:ORPORATED)?|CORP(?:ORATION)?|LIMITED|LTD|PLC|LLC|LLP|LP|SE|SA|SPA|AG|NV|ASA|AB|OYJ)\.?$/i

const TRAILING_NOUN = /\s+(?:COMPANY|CO|GROUP|GRP|HOLDINGS?|HLDGS?)\.?$/i
```

A **legal form** is never part of a name, so it goes wherever it trails, and repeatedly. A
**common noun** often *is* the name, so it goes **only where it is the last word** — the owner's
call, and the only rule available, because the same token reaches opposite verdicts in two
equally real names:

```text
GOLDMAN SACHS GROUP INC   ->  Goldman Sachs Group     boilerplate, kept anyway
JUROKU FINANCIAL GROUP INC->  Juroku Financial Group  the company's actual name
```

No rule can read both. `Goldman Sachs Group` is the price of `Juroku Financial Group`, and it is
the cheaper error: a name with a word too many is still that company; a name with a word too few
is a different one.

**Order is load-bearing.** `TRAILING_NOUN` is applied **once, before** any legal form is removed,
so "last word" means last in what IBKR exported. Run it after — or inside the `while` loop — and
stripping `INC` promotes `GROUP` into final position and takes it too, which is exactly the
behaviour this decision replaces. `format.test.ts` pins `ACME GROUP INC` against `ACME GROUP` for
that reason.

### `SPA` stays a legal form, on evidence

It is the Italian *S.p.A.*, and the owner holds two companies carrying it (`FILA SPA`,
`NEWPRINCES SPA`). A wellness business whose name genuinely ends in the word would be shortened
wrongly. Two real holdings against a hypothetical one; if such a holding ever arrives, this is the
line to revisit.

### A stranded article goes with the noun it paired with

`THE WALT DISNEY COMPANY` is a name; `The Walt Disney` is not, under any policy — which is what
separates this from the other two. A leading `THE` is dropped **only where something was
stripped**, so `THE TORONTO-DOMINION BANK` keeps its article: nothing was removed, so nothing is
stranded.

### An acronym is a token with no vowel, and that is all it can be

IBKR exports every name in capitals, so **the case that would distinguish `LVMH` from `GOLD` is
the case being replaced**. A vowel-less run of two or more letters is the one signal left: it is
not pronounceable as a word in any language these names come from.

It is narrow and the misses are asserted, not hidden — `AB`, `SAP`, `AIG` and `BASF` all contain a
vowel and still title-case to `Ab`, `Sap`, `Aig`, `Basf`. Widening this needs a *signal*, not a
longer list of consonants; a wrong guess here renames a company, which is worse than leaving one
shouting.

`titleCaseWords` also changed shape to make this expressible: it now maps over words rather than
over the first letter after a separator. Behaviour is otherwise identical, including `LEON'S` →
`Leon's` (an apostrophe is inside a word, not between two).

### Two shapes deliberately left alone

`CO-OPERATIVE` → `Co-Operative` and `MCLENNAN` → `Mclennan`. Both are hyphenated or prefixed
all-caps input, and nothing in either distinguishes the one that wants an internal capital from
the one that does not — `COCA-COLA` → `Coca-Cola` is right and needs exactly the rule that makes
`Co-Operative` wrong. Asserted in the tests as they are, so the next story sees today's behaviour
rather than guessing at it.

## Consequences

- **Two of the owner's seventeen named instruments change**, both `GROUP` retentions, checked by
  running both versions of the function over every distinct `(symbol, description)` pair in the
  real database rather than by reasoning about which might move:

  | | Before | After |
  | --- | --- | --- |
  | `RKT` — `RECKITT BENCKISER GROUP PLC` | `Reckitt Benckiser` | `Reckitt Benckiser Group` |
  | `7380.T` — `JUROKU FINANCIAL GROUP INC` | `Juroku Financial` | `Juroku Financial Group` |

  The Dividends *By Ticker* table is unchanged in all nine rows, which is worth stating because
  that view has displayed these names since M3 and this story could have moved them silently.
- The one test that failed was the one encoding the old policy (`SOME NAME HOLDINGS PLC` →
  `Some Name`). It is updated rather than deleted, with a note saying what it used to assert — a
  changed expectation is the record of a changed decision.
- The names still read identically across Dividends, Trades and Allocation: this story changed
  the shortening, not who calls it, so DDR-0066's single implementation is untouched and
  `instrumentNameUsage.test.ts` still passes unmodified.
- `formatCompanyName` remains a **heuristic over an all-caps string with no metadata**. Every
  decision above is a trade between two wrong answers, and the tests say which was chosen and
  why. It is not a name database, and the CSP means it will not become one (ADR-0007).

## References

- Story #214 — Shorten an instrument name to a name a person would write
- [[0066-one-instrument-name-across-the-views]] — one implementation, and where these judgements
  became visible on every instrument
- [[0064-toned-badges-and-the-income-key]] — the same instinct: derive from the row, not from a
  list of strings that is right today
- ADR-0007 — the renderer's one external origin, and why a name lookup is not available
