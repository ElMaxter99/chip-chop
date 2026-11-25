#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadAiConfig, runAi, testProvider } from "./ai.js";
import { hasCatalog, loadCatalog } from "./catalog.js";
import { failureReasons, rerender, reportDir, type Mode } from "./compare.js";
import { doctor } from "./doctor.js";
import { catalogGraph, toMermaid } from "./graph.js";
import { initProject } from "./init.js";
import { packageRoot } from "./paths.js";
import { runCapture, runCompare } from "./pipeline.js";
import { startUi } from "./server.js";
import { checkForUpdate, getChannel, installUpdate, normalizeChannel, setChannel, type Channel } from "./updater.js";
import type { StageName } from "./types.js";
import { formatIssues, validateCatalogDir } from "./validate.js";
import { readStructured } from "./fsutil.js";
import type { Report } from "./types.js";

const COMMANDS: Record<string, string> = {
  init: "Create .chipchop/ (config, states, flows, AI settings, AI guides) in the current app",
  validate: "Check config, states, flows and mocks against the schemas and each other",
  capture: "Build and serve a git ref, replay mocks, capture every state",
  compare: "Capture two refs and write the comparison report",
  report: "Re-render HTML/Markdown from an existing comparison",
  graph: "Print the flow graph (Mermaid) of the catalog",
  ai: "ai run [stages] | ai test <provider> [--model m] | ai show   (uses your Claude/Copilot CLI)",
  ui: "Open the local app in your browser",
  doctor: "Check node, git, Chromium and the AI CLIs",
  update: "update [--check] | update channel [stable|latest]   (GitHub releases; latest includes release candidates)",
};

function version(): string {
  return (JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version: string }).version;
}

function help(): string {
  return [
    `chip-chop ${version()} - capture every UI state on two git refs and compare them`,
    "",
    "Usage: chip-chop <command> [options]   (run inside the app you want to audit)",
    "",
    "Commands:",
    ...Object.entries(COMMANDS).map(([n, t]) => `  ${n.padEnd(9)} ${t}`),
    "",
    "Common options:",
    "  --dir <path>          app folder (default: current directory)",
    "  --ref <git-ref>       capture: ref to build   --label <name>  run name (default: the ref)",
    "  --base <ref> --head <ref>   compare: the two refs   --mode restyle|flow-audit",
    "  --reuse               compare: reuse existing captures instead of recapturing",
    "  --catalog auto|cwd|ref   where .chipchop/ comes from for each ref (default auto)",
    "  --only a,b            capture only these state ids   --viewport <name>",
    "  --no-install          skip dependency install in the worktree   --keep-worktree",
    "  --framework angularjs|angular|react|other   init   --force   init: overwrite",
    "  --dry-run             ai run: print the commands without running them",
    "  --no-open             ui: do not open the browser   --port <n>",
    "  --check / --channel stable|latest   update: only look / pick the channel for this run",
  ].join("\n");
}

interface Parsed {
  pos: string[];
  o: Record<string, string | boolean>;
}
function parse(argv: string[]): Parsed {
  const pos: string[] = [];
  const o: Record<string, string | boolean> = {};
  const flags = new Set(["force", "reuse", "no-install", "keep-worktree", "headed", "dry-run", "no-open", "help"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const k = a.slice(2);
      if (flags.has(k)) o[k] = true;
      else o[k] = argv[++i] ?? "";
    } else pos.push(a);
  }
  return { pos, o };
}

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  execFile(cmd as string, args as string[], () => {});
}

async function main(): Promise<number> {
  const { pos, o } = parse(process.argv.slice(2));
  const [command, sub] = pos;
  if (!command || command === "help" || o.help || command === "--help") {
    console.log(help());
    return 0;
  }
  if (command === "--version" || command === "version") {
    console.log(version());
    return 0;
  }
  const appDir = resolve(String(o.dir ?? process.cwd()));
  const log = (l: string): void => console.log(l);
  const str = (k: string): string | undefined => (typeof o[k] === "string" && o[k] !== "" ? (o[k] as string) : undefined);

  switch (command) {
    case "init": {
      const r = initProject(appDir, { framework: (str("framework") ?? "other") as never, force: !!o.force });
      console.log(`created: ${r.created.join(", ") || "-"}\nskipped (already there): ${r.skipped.join(", ") || "-"}`);
      console.log("\nNext: run `chip-chop ai run` (or `chip-chop ui`) to let your AI CLI fill in states, flows and mocks.");
      return 0;
    }
    case "validate": {
      const issues = validateCatalogDir(appDir);
      console.log(issues.length ? formatIssues(issues) : "OK: no problems found.");
      return issues.some((i) => i.severity === "error") ? 1 : 0;
    }
    case "capture": {
      const ref = str("ref");
      const run = await runCapture({
        appDir,
        target: { label: str("label") ?? ref ?? "working-tree", ...(ref ? { ref } : {}), ...(str("base-url") ? { url: str("base-url")! } : {}) },
        catalog: (str("catalog") as "auto" | "cwd" | "ref") ?? "auto",
        install: !o["no-install"],
        keepWorktree: !!o["keep-worktree"],
        ...(str("only") ? { only: str("only")!.split(",") } : {}),
        ...(str("viewport") ? { viewport: str("viewport")! } : {}),
        headed: !!o.headed,
        log,
      });
      const failed = run.results.filter((r) => !r.ok).length;
      console.log(`captured ${run.results.length - failed}/${run.results.length}`);
      return failed ? 1 : 0;
    }
    case "compare": {
      const base = str("base");
      const head = str("head");
      if (!base || !head) {
        console.error("compare needs --base <ref> and --head <ref>");
        return 2;
      }
      const mode = (str("mode") ?? "restyle") as Mode;
      const { report, dir } = await runCompare({
        appDir,
        base: { label: base, ref: base },
        head: { label: head, ref: head },
        mode,
        reuse: !!o.reuse,
        catalog: (str("catalog") as "auto" | "cwd" | "ref") ?? "auto",
        install: !o["no-install"],
        keepWorktree: !!o["keep-worktree"],
        ...(str("only") ? { only: str("only")!.split(",") } : {}),
        ...(str("viewport") ? { viewport: str("viewport")! } : {}),
        log,
      });
      const s = report.summary;
      console.log(`\nidentical ${s.identical} · visual-only ${s.visualOnly} · structural ${s.structural} · added ${s.added} · removed ${s.removed} · failed ${s.failed}`);
      console.log(`open: ${join(dir, "report.html")}`);
      const why = failureReasons(report);
      for (const w of why) console.log(`FAIL: ${w}`);
      return why.length ? 1 : 0;
    }
    case "report": {
      const base = str("base");
      const head = str("head");
      if (!base || !head) {
        console.error("report needs --base and --head (the labels used when comparing)");
        return 2;
      }
      console.log(`written: ${rerender(appDir, base, head)}`);
      console.log(`mode: ${readStructured<Report>(join(reportDir(appDir, base, head), "report.json")).mode}`);
      return 0;
    }
    case "graph": {
      if (!hasCatalog(appDir)) {
        console.error("no .chipchop/ here; run `chip-chop init` first");
        return 1;
      }
      console.log(toMermaid(catalogGraph(loadCatalog(appDir)), {}));
      return 0;
    }
    case "ai": {
      if (sub === "test") {
        const name = pos[2];
        if (!name) {
          console.error("usage: chip-chop ai test <provider> [--model <name>]");
          return 2;
        }
        const r = await testProvider(appDir, name, str("model"));
        console.log(r.ok ? `OK: ${name} answered` : `FAILED: ${r.output}`);
        return r.ok ? 0 : 1;
      }
      if (sub === "show") {
        console.log(JSON.stringify(loadAiConfig(appDir), null, 2));
        return 0;
      }
      if (sub === "run") {
        const stages = pos.slice(2) as StageName[];
        const r = await runAi({ appDir, log, dryRun: !!o["dry-run"], ...(stages.length ? { stages } : {}), ...(str("extra") ? { extra: str("extra")! } : {}) });
        console.log(r.ok ? "OK: catalog validates." : `Still invalid after repairs:\n${r.issues}`);
        return r.ok ? 0 : 1;
      }
      console.error("usage: chip-chop ai run [discover|flows|mocks|repair ...] | ai test <provider> | ai show");
      return 2;
    }
    case "ui": {
      const ui = await startUi(appDir, Number(str("port") ?? 0));
      console.log(`chip-chop is running for ${appDir}\n  ${ui.url}\nPress Ctrl+C to stop.`);
      if (!o["no-open"]) openBrowser(ui.url);
      await new Promise<void>((r) => process.on("SIGINT", () => r()));
      await ui.close();
      return 0;
    }
    case "update": {
      if (sub === "channel") {
        const c = pos[2];
        if (c === "stable" || c === "latest" || c === "all") setChannel(normalizeChannel(c));
        else if (c) {
          console.error("channel must be `stable` (final releases only) or `latest` (the newest, release candidates included)");
          return 2;
        }
        console.log(`update channel: ${getChannel()} (${getChannel() === "stable" ? "solo estables" : "últimas"})`);
        return 0;
      }
      const ch = str("channel") ? (normalizeChannel(str("channel")) as Channel) : undefined;
      if (o.check) {
        const i = await checkForUpdate(ch ? { channel: ch } : {});
        console.log(i.available ? `update available: ${i.current} -> ${i.latest}${i.prerelease ? " (release candidate)" : ""}\n${i.url}${i.note ? `\n${i.note}` : ""}` : `up to date (${i.current}, channel ${i.channel})${i.note ? `: ${i.note}` : ""}`);
        return i.available ? 10 : 0;
      }
      await installUpdate({ ...(ch ? { channel: ch } : {}), log });
      return 0;
    }
    case "doctor": {
      const checks = await doctor(appDir);
      for (const c of checks) console.log(`${c.ok ? "ok     " : c.required ? "MISSING" : "absent "} ${c.name}: ${c.detail}`);
      return checks.some((c) => c.required && !c.ok) ? 1 : 0;
    }
    default:
      console.error(`Unknown command "${command}".\n\n${help()}`);
      return 1;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: Error) => {
    console.error(`chip-chop: ${e.message}`);
    process.exitCode = 1;
  },
);
