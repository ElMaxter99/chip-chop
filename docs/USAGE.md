# Using chip-chop on your app

## 1. Install

Download `chip-chop-<version>-linux.tar.gz` from the [latest GitHub Release](https://github.com/ElMaxter99/chip-chop/releases), then:

```bash
tar xzf chip-chop-*-linux.tar.gz
./chip-chop-*-linux/install.sh      # installs to ~/.local, downloads Chromium
chip-chop doctor
```

On Windows, unzip `chip-chop-<version>-windows.zip` and run, in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\chip-chop-<version>-windows\install.ps1
```

Open a new terminal afterwards. Linux and Windows are the validated platforms.

**macOS (untested):** a `chip-chop-<version>-macos.tar.gz` bundle is published too (`tar xzf … && ./chip-chop-*-macos/install.sh`, then add `~/.local/bin` to `~/.zshrc`'s PATH). Nobody has run chip-chop on a real Mac yet; CI only checks that it installs and starts on a macOS runner (informational, it never blocks a release). Expect to find rough edges and report them.
`build.nodeVersion` (running a legacy build under another Node) only works on Linux through nvm; on Windows start chip-chop under that Node version instead.

(The plain `chip-chop-<version>.tgz` is also attached: `npm install -g ./chip-chop-<version>.tgz` and `npx playwright install chromium`.)

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

## The local app

`chip-chop ui` opens the app in your browser (it only listens on 127.0.0.1 and needs the link it prints).
Tabs: **Proyecto** (create `.chipchop`, generate with AI, validate, environment check), **IA** (provider and
model per stage, with a *Probar* button), **Comparar** (pick two branches, live log, result, open report),
**Informes** and **Actualizar** (version button, top right). The interface is in Spanish for now.

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
  (not installed; its flags follow its documentation and may need `extraArgs`), anything run on Windows beyond what CI covers (the Windows installer and
  self-update are only smoke-tested in CI), the nvm wrapper, and any real AngularJS/Angular/React app. Those are exactly what your first run will show.

## Updates

chip-chop reads the GitHub releases of this repository. Two channels:

- `stable` («Solo estables», default): final releases only; release candidates (`-rc.N`) are ignored.
- `latest` («Últimas»): the newest version wins, whether it is a release candidate or a final release (a final `X.Y.Z` beats its own `-rc.N`). `all` is accepted as an old alias.

```bash
chip-chop update channel latest   # or: stable
chip-chop update --check          # exit code 10 when an update exists
chip-chop update                  # downloads the bundle for your OS (Linux, Windows, macOS) and runs its installer; the download is deleted afterwards
```

The local app has the same controls in the *Project* tab. The choice is stored in `~/.chipchop/settings.json`
(`%USERPROFILE%\.chipchop` on Windows). A release candidate is any version with a suffix, such as `0.2.0-rc.1`;
the release workflow marks it as a pre-release on GitHub automatically. Updating needs network access to
`api.github.com`; it has not been exercised against a real newer release yet (only the version logic is unit-tested).
