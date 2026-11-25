# Architecture

## Principle: deterministic engine, AI-authored inputs

The engine contains no AI. It executes and compares. Understanding the app is
the AI's job: it reads the source code (guided by `packages/skills`) and writes
the `.chipchop/` files. Every file is validated against a JSON Schema before the
engine runs, so any AI (or a human) can produce them.

## Pipeline

```
validate → capture(base) ┐
                         ├→ compare → report
          capture(head) ─┘
```

### validate
Schema validation of config, states, flows and mocks, plus cross-references:
every `capture` names a declared state, every mock id exists, every `opensFrom`
exists, ids are unique, mock responses satisfy their `responseSchema`.
`scripts/validate-schemas.mjs` already does this for the example files.

### capture (per git ref)
1. Check out the ref in a `git worktree` (or use `--base-url` for an app that is
   already running).
2. Install, build and serve with the commands from `config.yaml`.
3. Launch Chromium via Playwright with the determinism settings: fixed viewport
   and device scale factor, fixed clock, timezone and locale, frozen
   animations, seeded `Math.random`.
4. Install request interception: API calls are answered from the mocks, external
   assets follow `externalAssets.mode`. **A request no mock matches is not
   forwarded to the network**; it is recorded as unmocked and reported.
5. Walk the flows, and for each `capture` step save:
   `<state>.<viewport>.png`, `<state>.<viewport>.aria.yml`,
   `<state>.<viewport>.requests.json`, `<state>.<viewport>.console.json`,
   `<state>.<viewport>.meta.json`.
6. Record transitions (which step moved from which state to which) as a graph.

### compare
- Pairs states by `id` + `viewport`.
- **Visual**: `pngjs` decodes, `pixelmatch` diffs with the configured threshold,
  masks are painted over first, a diff image is written.
- **Structural**: the ARIA snapshot (roles and names, not CSS classes), the
  set of requests and new console errors.
- **Graph**: added/removed states and transitions between the two refs.
- Classification per state: `identical`, `visual-only`, `structural`, `added`,
  `removed`, `failed`.

### report
Renders `report.json` (schema: report) into a self-contained `report.html`
(side by side, diff slider, flow graph) and a `REPORT.md`.

## Modes

| | `restyle` | `flow-audit` |
|---|---|---|
| Expected | pixels change | states also added, removed, moved |
| Must stay identical | ARIA, requests, ids, graph | everything the feature did not touch |
| Gate | any `structural`, `added`, `removed` or unmocked request fails | informational |

## Why ARIA for the structural check

A style rewrite changes classes and markup but not what a user can perceive and
do. The accessibility tree captures roles, names and states, so it is stable
under CSS refactors and changes when behavior or content changes.

## Output layout

```
.chipchop/
  runs/<ref>/                 captures for one ref
  reports/<base>__vs__<head>/ report.json, report.html, REPORT.md, diff/
```

## Known limits

- Rendering differs across OS, browser version and hardware. Compare refs on
  the same machine and image (the Playwright Docker image in CI).
- Server-side fetches (SSR) are invisible to browser interception.
- Modals reachable only after complex input must be described with `via` or a
  flow; chip-chop does not guess interactions.
