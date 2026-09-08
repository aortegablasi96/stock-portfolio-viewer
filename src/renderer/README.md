# `src/renderer`

The **React UI**. It runs sandboxed, with context isolation on and Node integration off: its only
door out is `window.api` from the preload bridge. Importing `@services`, `@repositories`, `@db`,
`@main` or `electron` here fails `npm run lint`.

```text
src/App.tsx        the shell: the vertical sidebar, the tab panels, the accelerators
src/app.css        every design token and rule, one stylesheet
src/components/    the views, the charts, and the ui/ primitives
src/lib/           pure logic and the guard tests
src/assets/fonts/  Inter and JetBrains Mono, self-hosted
```

## Why `lib/` exists

Vitest runs in a **Node environment with no jsdom**, so **no test may render a component**. Chart
maths, filtering, sorting, formatting, keyboard arithmetic and view state are therefore extracted
into pure modules under `lib/` — that is the only way they get tested. Follow the split when
adding a component with real logic.

Several `lib/*.test.ts` files have **no module under test**. They guard `app.css`, a component, a
view's composition or an accessibility rule by **scanning source text** — and a text-scanning
guard must strip comments first, because the stylesheet and the components quote their own values
in prose (bitten five times; DDR-0075). What a text scan cannot see — a cascade resolving, a
measured width, a key reaching the app — is pinned by Playwright in `e2e/`.

## The shell

Six views in a vertical sidebar that collapses to a 56px rail. It is the **full WAI-ARIA tabs
pattern**, not styled buttons (DDR-0029, DDR-0055, DDR-0057): a roving `tabindex`, automatic
activation on arrow keys, `aria-controls` set only on the selected tab. Up/Down only — Left/Right
are deliberately inert. Accelerators sit *beside* the pattern, in one `window` listener:
`Ctrl`/`Cmd`+digit selects a row, `Ctrl`(+`Shift`)+`Tab` rotates, and both decline while text is
being entered.

**An analytics tab mounts on first visit and then stays mounted**, hidden rather than unmounted,
so view-local state survives and unvisited tabs issue no IPC (DDR-0006, DDR-0027). The
consequence is that a mounted view can go stale, which is why both Flex write paths bump
`lib/dataVersion` and every `useAnalytics` re-reads. **Portfolio is deliberately excluded** — it
shows live data that changes with no event to signal it.

`AnalyticsShell` owns the four-branch state guard, the `<main>` and the page header, so a view
never re-declares them. Its children are a **function of the report, not elements**, and the shell
holds no state.

## Components

- **`components/ui/`** — the in-house primitives (`Button`, `Card`, `Badge`, `DataTable`,
  `Field`, `StatTile`, `StatePanel`, `Collapsible`, …). shadcn/ui was **declined**; what was
  adopted is the *shape* — `variant`/`size` axes and composition (ADR-0008). Each has a guard test
  in `lib/*Variants.test.ts`, and each has a DDR recording its call sites and rejected
  alternatives. **Read the DDR before changing an axis.**
- **`components/charts/`** — dependency-free inline SVG, sized by **aspect ratio, never a pixel
  width**: an axis label is 11 *viewBox units*, so halving the column halves the label (DDR-0018).
- **`components/analytics/`** — the four imported-history views and the hooks they share.

## Styling

One stylesheet, all tokens. Three rules that are easy to break by accident:

- **Never write a focus rule.** One ring is applied by a zero-specificity `:where(...)` base rule,
  so an element is ringed by default and can't ship without one.
- **Use a scale step, not a raw length** — `--space-*`, `--radius-*`, `--text-*`, and the two
  motion durations. Adoption is held by a ratchet in `lib/tokenAdoption.ts`; don't re-baseline it.
- **A colour's meaning is in its token pair.** `--neg` is fill only, `--neg-text` is text only;
  picking the wrong one is silent. Contrast is *enumerated by hand* in `lib/contrast.ts`, including
  hover and tint states that axe-style tests never visit.

The CSP admits exactly one external origin (`https://api.mapbox.com`); `events.mapbox.com` is
omitted on purpose so telemetry is blocked by the platform. **The CSP is not the app's boundary** —
the assistant sends figures to OpenAI from *main*, which the CSP never sees. Don't add an origin
here for it (ADR-0007, ADR-0010).
