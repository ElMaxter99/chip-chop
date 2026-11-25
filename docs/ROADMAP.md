# Roadmap

## Done
- Repository, MIT license, CI skeleton, release workflow with npm provenance.
- JSON Schemas: config, states, flow, mock, report, with valid and invalid
  examples and a cross-reference validator.
- AI guides: `SKILL.md`, AngularJS, Angular, React, states/flows, mocks.
- `packages/core`: types and mock URL matching with tests; CLI command surface.

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
