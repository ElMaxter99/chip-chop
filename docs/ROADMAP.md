# Roadmap

## Done in v0.1
- Schemas, AI guides, `validate`, `init`, `capture`, `compare` (restyle / flow-audit), HTML + Markdown
  reports, flow graph with Mermaid output.
- Configurable AI layer: Claude CLI and Copilot CLI providers (plus `custom`), provider and model per
  stage, prompt overrides, validate-and-repair loop.
- Local app (`chip-chop ui`), `doctor`, GitHub Release with an installable tarball.
- End-to-end CI against `examples/static-demo` with a real browser.

## Next
- Run on real AngularJS, then Angular and React apps and fix what that shows (v0.2).
- Demo apps per framework in `examples/`.
- Electron shell around the local app; npm publication.
- Reusable GitHub workflow that comments on PRs.

## Original plan (kept for reference)
## 1. MVP engine
- `validate` command (schemas + cross-references, from the existing script).
- `capture`: Playwright, mock replay, determinism, PNG + ARIA + requests.
- `compare`: pngjs + pixelmatch, masks, per-state classification.
- Basic HTML report.
- AngularJS demo app in `examples/angularjs-demo`, run in CI.

## 2. Structure
- ARIA and request comparison, console errors, unmocked-request findings.
- `restyle` and `flow-audit` modes with exit codes for CI gates.

## 3. Flow graph
- Record transitions, diff graphs, Mermaid output, graph section in the report.

## 4. Angular and React
- Demo apps and CI jobs for both.
- External assets modes (`placeholder`, `download`, `block`).

## 5. Polish
- Reusable GitHub workflow that comments on PRs.
- `init` command that scaffolds `.chipchop/`.
- Docs site, more framework guides (Vue, Svelte) if there is demand.
