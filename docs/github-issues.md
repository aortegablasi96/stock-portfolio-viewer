# GitHub Issues — Conventions

In Stock Portfolio Viewer the **GitHub issue tracker is the source of milestones**. The owner
authors Epics and User Stories in GitHub; the `product-manager` workflow skill **reads them
before planning**. Issues are never created after implementation to record work already done
(that backfill case belongs to the `project-historian` skill). There is no local roadmap or
history document.

## Issue Types

Only three types are used, defined by templates in `.github/ISSUE_TEMPLATE/`:

- **Epic** — a milestone-sized capability that groups several User Stories.
- **User Story** — one coherent, independently implementable piece of user value.
- **Bug** — existing behaviour that is incorrect.

Always choose the smallest type that accurately represents the work.

## Milestones

Milestones are GitHub **Milestones** (native), named `M0 — …`, `M1 — …`, and so on. Each
Epic and User Story is assigned to the milestone it belongs to. The **current milestone** is
prioritized over future ones unless the owner says otherwise.

## Epic lifecycle

**An Epic closes when its stories close.** Refinement work that arrives afterwards opens a
**new** Epic under the current milestone — a delivered Epic is never reopened as a bucket for
follow-up rounds.

Scope Epics by **area of the app**, not by round of work: M3's Epic #4 accumulated 31 stories
across four refinement rounds before being closed and split into #98 (Allocation map), #99
(Analytics views polish) and #100 (App shell & layout). Closed stories stay in the milestone
that delivered them; they are not re-filed.

### The one exception

**An Epic may be reopened when its own stated problem is provably unfinished** — where the
Epic's Summary named a problem its acceptance criteria turned out to under-scope, so the gap is
the *original* scope rather than new refinement. The test is whether the new stories close the
problem the Epic was filed to solve. Anything else — a fresh round of polish on a delivered
area, a new audit, a follow-up idea — opens a new Epic.

Reopening requires appending a dated note to the Epic saying **which criterion under-scoped
which finding**, so the judgement is on the record and not re-litigated later.

Epic #125 is the precedent, and shows how narrow the exception is. Its audit found "no spacing,
radius or type scale — every value is hand-picked at the call site". Its acceptance criterion
was written as "no *primitive* hard-codes a value the token scale can express", and every story
met it. The Epic closed with ~97 hand-picked values still in `app.css` and no guard against the
next one: the criteria were satisfied and the finding was not. Epic #4 remains the
counter-example — four rounds of genuinely new refinement, which is the failure this rule
exists to prevent.

## Labels

Do not invent labels outside this list.

**Type**

| Label | Meaning |
| --- | --- |
| `epic` | Milestone-sized capability |
| `user-story` | One piece of user value |
| `bug` | Incorrect existing behaviour |

**Domain** (mirrors the domains in `CLAUDE.md`)

| Label | Domain |
| --- | --- |
| `domain:portfolio` | Portfolio dashboard and overview |
| `domain:holdings` | Holdings and positions |
| `domain:snapshots` | Historical snapshots |
| `domain:dividends` | Dividend tracking |
| `domain:analytics` | Performance / allocation analytics |

## How the workflow uses issues

1. The owner authors (or, via `issue-writer`, drafts) Epics and User Stories.
2. `product-manager` reads the active milestone's issues and produces a Product Review for
   the selected work item.
3. The rest of the planning workflow (UI Designer, Architect, Database Designer,
   Implementation Engineer, Testing) refines that issue into an approved plan.
4. Execution skills implement the approved plan; the issue is closed when done.
