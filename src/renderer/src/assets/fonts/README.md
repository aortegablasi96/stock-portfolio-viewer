# Bundled typefaces

Two variable `woff2` faces, latin subset, checked into the repo and served from the renderer
bundle. **They are assets, not a dependency** — nothing in `package.json` references them.

| File | Family | Axis | Bytes |
| --- | --- | --- | --- |
| `inter-latin-variable.woff2` | Inter | `wght` 100–900 | 48,256 |
| `jetbrains-mono-latin-variable.woff2` | JetBrains Mono | `wght` 100–800 | 40,404 |

`app.css` declares the two `@font-face` rules and the `--font-sans` / `--font-figure` tokens that
name them (DDR-0053). No call site declares a raw family.

## Why local, and why it is not negotiable

The renderer's CSP admits exactly one external origin, `https://api.mapbox.com`, and every other
host is omitted **as the enforcement mechanism** (ADR-0007). The Figma Make proposal these faces
come from opens its stylesheet with two `@import url('https://fonts.googleapis.com/…')` lines;
that cannot ship here, and no future edit may reintroduce it. `lib/figureRole.test.ts` fails if a
font host appears anywhere in `app.css` or `index.html`.

Because `default-src 'self'` already covers `font-src`, bundling these needed **no CSP change**.

## Why variable rather than static weights

The proposal asks for Inter at 300/400/500/600/700 and JetBrains Mono at 400/500/600/700 — nine
static latin faces, roughly 240 KB. Two variable faces cover every weight in 86.6 KB, so the
variable answer is both smaller and open-ended: a later story can reach for 550 without adding a
file.

## Provenance, and how to regenerate

Both are the latin variable `woff2` shipped by Fontsource 5.3.0, extracted from the published
tarballs without installing either package:

```bash
npm pack @fontsource-variable/inter@5.3.0 @fontsource-variable/jetbrains-mono@5.3.0
tar -xzf fontsource-variable-inter-5.3.0.tgz         package/files/inter-latin-wght-normal.woff2
tar -xzf fontsource-variable-jetbrains-mono-5.3.0.tgz package/files/jetbrains-mono-latin-wght-normal.woff2
```

`inter-latin-wght-normal.woff2` → `inter-latin-variable.woff2`,
`jetbrains-mono-latin-wght-normal.woff2` → `jetbrains-mono-latin-variable.woff2`.

Deliberately **not** taken: the `latin-ext` subsets, the italics, and Inter's `opsz` axis. The app
renders English prose, tickers and figures; nothing in it is italic.

## Licence

Both faces are SIL Open Font License 1.1. The upstream licence files are kept beside them as
`inter-OFL.txt` and `jetbrains-mono-OFL.txt`.
