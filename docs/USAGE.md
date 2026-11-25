# Using chip-chop on your app

## 1. Install

Download `chip-chop-0.1.0.tgz` from the [latest GitHub Release](https://github.com/ElMaxter99/chip-chop/releases), then:

```bash
npm install -g ./chip-chop-0.1.0.tgz
npx playwright install chromium
chip-chop doctor
```

`doctor` checks Node (22+), git, Chromium and whether the `claude` / `copilot` CLIs are on your `PATH`.
Only the CLIs you actually configure for a stage are needed.

## 2. Prepare the app (AngularJS example)

Run everything from the root of the app you audit.

```bash
chip-chop init --framework angularjs
```

This creates `.chipchop/` with a config, a starter state and flow, `ai.yaml` and the AI guides
(`.chipchop/ai/`). Then let your AI CLI read the source and write the rest:

```bash
chip-chop ai test claude --model haiku   # confirms the CLI answers
chip-chop ai run                         # discover -> flows -> mocks, then validate and repair
```

Or do the same from the browser with `chip-chop ui` (tab *AI* to choose provider and model per stage,
tab *Run* to start it). Review what the AI wrote: states, flows and mocks are plain YAML/JSON.

Things to check by hand in `.chipchop/config.yaml` for an old AngularJS app: the build and serve commands,
the Node version the build needs (`build.nodeVersion`), and the external image hosts.

## 3. Compare

```bash
chip-chop compare --base develop --head my-branch              # restyle: only pixels may change
chip-chop compare --base develop --head my-branch --mode flow-audit   # new flows are expected
```

Each ref is checked out into a temporary git worktree, built, served and captured; nothing in your
working tree is touched. The report is written to `.chipchop/reports/<base>__vs__<head>/report.html`
(also `REPORT.md` and `report.json`). The exit code is 1 when the gate fails, so it works in CI.
Use `--reuse` to compare existing captures without rebuilding.

## 4. Configure the AI

`.chipchop/ai.yaml` (per app) overrides `~/.chipchop/ai.yaml` (global). Every stage has its own provider
and model; model names are passed to the CLI as written.

```yaml
stages:
  discover: { provider: claude, model: sonnet }
  flows:    { provider: claude, model: haiku }
  mocks:    { provider: copilot, model: gpt-5-mini }
```

Providers: `claude`, `copilot`, or `custom` (any CLI, with `{prompt}` / `{model}` placeholders).
Prompts can be replaced with `settings.promptsDir` (`discover.md`, `flows.md`, `mocks.md`, `repair.md`).

## What has been tested

Honest list, as of v0.1:

- **Tested for real:** the end-to-end tests also pass in GitHub Actions with the real `pngjs`, `pixelmatch` and a clean `npm install`. They cover capture and compare on the bundled demo app with Chromium (restyle, and a new modal
  detected as added), the CLI commands, the local server (auth token, host check, report serving), schema
  validation, mock matching, AI argument building and the repair loop (with a fake CLI).
- **Not tested here:** the Claude CLI end to end (it was not signed in where this was built), the Copilot CLI
  (not installed; its flags follow its documentation and may need `extraArgs`), Windows, the ``
  nvm wrapper, and any real AngularJS/Angular/React app. Those are exactly what your first run will show.
