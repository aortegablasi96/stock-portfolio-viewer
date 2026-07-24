# 0012. In-place confirmation for destructive actions

- **Status:** Accepted
- **Date:** 2026-07-24

## Context

Story #43 adds the app's first **destructive** actions — "Clear statements" (wipes the imported
Flex store) and "Clear history" (wipes captured snapshots). Both permanently delete local data
(ADR-0006), so each needs explicit confirmation that states what will be removed. Until now the
app had no confirmation pattern; the ui-designer guidance also steers away from unnecessary
dialogs, and the only prior "dialog" is the OS file picker owned by the main process.

## Decision

Introduce a single reusable **in-place confirm** pattern, `ConfirmAction`, rather than a modal
dialog or the browser's `window.confirm`:

- The resting state is a destructive-styled trigger button (e.g. "Clear statements").
- Activating it **expands in place** into an explicit, plain-language warning of exactly what
  will and will not be removed, plus two buttons: a destructive **confirm** ("Yes, clear all
  statements") and a neutral **Cancel**. No overlay, no focus trap to manage.
- While the action runs the confirm button shows a busy label ("Clearing…") and both buttons
  disable; afterwards the control returns to its resting trigger and the parent shows an outcome
  status ("Cleared N …" / "No … to clear").
- Destructive controls use a dedicated `danger-button` style (the `--neg` red, filling on
  hover); Cancel uses a neutral `ghost-button`. Both are real, keyboard-focusable `<button>`s
  with visible focus rings.
- The two clear actions live where their data does: **Clear statements** in the Flex import
  panel, **Clear history** in the History section header — and "Clear history" is shown only
  when there is history to clear.

`ConfirmAction` is presentational and generic (label, confirm label, busy label, warning,
`onConfirm`), so future destructive actions reuse it instead of inventing new confirmation UI.

## Consequences

Benefits:

* Consistent, discoverable confirmation with no modal machinery (no overlay, focus trap, or
  scroll-lock), keeping the "avoid unnecessary dialogs" stance.
* Fully keyboard-accessible and deterministically testable in Playwright (no native dialog
  handling), unlike `window.confirm`.
* One reusable pattern for every future destructive action.

Tradeoffs:

* An inline confirm is marginally less "heavy" than a centred modal. Acceptable here: the
  warning is explicit, the actions are independent and reversible by re-importing/re-capturing,
  and the destructive button is clearly distinguished by colour and wording.

Risks:

* Accidental confirmation. Mitigated by the two-step reveal, the distinct destructive styling,
  and wording that names exactly what is removed and what is preserved.

## Alternatives Considered

### A centred modal dialog

Rejected for now: adds overlay/focus-trap/scroll-lock machinery the app has never needed, for
two low-frequency actions. The pattern can be promoted to a modal later without changing callers.

### `window.confirm`

Rejected: inconsistent OS-native styling, blocks the renderer, and is awkward to drive in the
Playwright e2e suite.

## References

- [[0006-sanctioned-full-reset-of-local-history]] is not a DDR; see ADR-0006 — the decision this
  UX serves
- [[0001-dashboard-layout-and-load-states]] — the dashboard chrome these controls sit in
- GitHub Issues #4 (Epic M3), #43 (Story)
