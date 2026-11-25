import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedConfig } from "./catalog.js";
import { ensureDir, readStructured, safeLabel, writeJson, writeText } from "./fsutil.js";
import { diffPngs } from "./imagediff.js";
import { chipDir } from "./paths.js";
import { renderHtml, renderMarkdown } from "./render.js";
import type { GraphEdge, Report, RunInfo, StateResult } from "./types.js";
import { validateAgainst } from "./validate.js";

export type Mode = "restyle" | "flow-audit";

export interface CompareOptions {
  appDir: string;
  baseLabel: string;
  headLabel: string;
  mode: Mode;
  appName: string;
  compare: ResolvedConfig["compare"];
}

export function runDir(appDir: string, label: string): string {
  return join(chipDir(appDir), "runs", safeLabel(label));
}

export function reportDir(appDir: string, baseLabel: string, headLabel: string): string {
  return join(chipDir(appDir), "reports", `${safeLabel(baseLabel)}__vs__${safeLabel(headLabel)}`);
}

function readLines(path: string): string[] {
  return existsSync(path) ? readStructured<string[]>(path) : [];
}

function edgeKey(e: GraphEdge): string {
  return `${e.from}->${e.to}`;
}

export function compareRuns(opts: CompareOptions): Report {
  const baseDir = runDir(opts.appDir, opts.baseLabel);
  const headDir = runDir(opts.appDir, opts.headLabel);
  if (!existsSync(join(baseDir, "run.json"))) throw new Error(`no capture found for "${opts.baseLabel}" (expected ${baseDir}/run.json)`);
  if (!existsSync(join(headDir, "run.json"))) throw new Error(`no capture found for "${opts.headLabel}" (expected ${headDir}/run.json)`);
  const base = readStructured<RunInfo>(join(baseDir, "run.json"));
  const head = readStructured<RunInfo>(join(headDir, "run.json"));
  const out = reportDir(opts.appDir, opts.baseLabel, opts.headLabel);
  ensureDir(join(out, "images", "base"));
  ensureDir(join(out, "images", "head"));
  ensureDir(join(out, "diff"));

  const baseHas = new Set(base.states.map((s) => s.id));
  const headHas = new Set(head.states.map((s) => s.id));
  const keys = new Map<string, { id: string; viewport: string }>();
  const res = (run: RunInfo, id: string, vp: string) => run.results.find((r) => r.id === id && r.viewport === vp);
  for (const run of [base, head]) for (const r of run.results) keys.set(`${r.id}|${r.viewport}`, { id: r.id, viewport: r.viewport });

  const states: StateResult[] = [];
  const cfg = opts.compare;

  for (const { id, viewport } of [...keys.values()].sort((a, b) => `${a.id}|${a.viewport}`.localeCompare(`${b.id}|${b.viewport}`))) {
    const b = res(base, id, viewport);
    const h = res(head, id, viewport);
    const file = `${id}.${viewport}`;
    const bPng = join(baseDir, `${file}.png`);
    const hPng = join(headDir, `${file}.png`);

    if (!baseHas.has(id) && headHas.has(id)) {
      if (h?.ok) {
        copyFileSync(hPng, join(out, "images", "head", `${file}.png`));
        states.push({ id, viewport, status: "added", visual: { headImage: `images/head/${file}.png` } });
      } else {
        states.push({ id, viewport, status: "failed", error: `head: ${h?.error ?? "not captured"}` });
      }
      continue;
    }
    if (baseHas.has(id) && !headHas.has(id)) {
      if (b?.ok) copyFileSync(bPng, join(out, "images", "base", `${file}.png`));
      states.push({ id, viewport, status: "removed", ...(b?.ok ? { visual: { baseImage: `images/base/${file}.png` } } : {}) });
      continue;
    }
    if (!b && !h) continue;
    if (!b?.ok || !h?.ok) {
      const why = [!b?.ok ? `base: ${b?.error ?? "not captured"}` : "", !h?.ok ? `head: ${h?.error ?? "not captured"}` : ""].filter(Boolean).join(" | ");
      states.push({ id, viewport, status: "failed", error: why });
      continue;
    }

    const diff = diffPngs(readFileSync(bPng), readFileSync(hPng), { threshold: cfg.pixelThreshold, ignoreAntialiasing: cfg.ignoreAntialiasing });
    copyFileSync(bPng, join(out, "images", "base", `${file}.png`));
    copyFileSync(hPng, join(out, "images", "head", `${file}.png`));
    const visualChanged = diff.ratio > cfg.maxDiffPixelRatio || (cfg.maxDiffPixelRatio === 0 && diff.diffPixels > 0);
    if (visualChanged) writeFileSync(join(out, "diff", `${file}.png`), diff.diffPng);

    const aria = cfg.structural.aria
      ? readFileSync(join(baseDir, `${file}.aria.yml`), "utf8") !== readFileSync(join(headDir, `${file}.aria.yml`), "utf8")
      : false;
    const bReq = readLines(join(baseDir, `${file}.requests.json`));
    const hReq = readLines(join(headDir, `${file}.requests.json`));
    const requestsAdded = cfg.structural.requests ? hReq.filter((r) => !bReq.includes(r)) : [];
    const requestsRemoved = cfg.structural.requests ? bReq.filter((r) => !hReq.includes(r)) : [];
    const bErr = readLines(join(baseDir, `${file}.console.json`));
    const newConsoleErrors = cfg.structural.consoleErrors ? readLines(join(headDir, `${file}.console.json`)).filter((e) => !bErr.includes(e)) : [];

    const structural = aria || requestsAdded.length > 0 || requestsRemoved.length > 0 || newConsoleErrors.length > 0;
    states.push({
      id,
      viewport,
      status: structural ? "structural" : visualChanged ? "visual-only" : "identical",
      visual: {
        diffPixels: diff.diffPixels,
        diffRatio: Number(diff.ratio.toFixed(6)),
        baseImage: `images/base/${file}.png`,
        headImage: `images/head/${file}.png`,
        ...(visualChanged ? { diffImage: `diff/${file}.png` } : {}),
      },
      ...(structural ? { structural: { ariaChanged: aria, requestsAdded, requestsRemoved, newConsoleErrors } } : {}),
    });
  }

  const count = (s: StateResult["status"]): number => states.filter((x) => x.status === s).length;
  const bEdges = new Map(base.graph.edges.map((e) => [edgeKey(e), e]));
  const hEdges = new Map(head.graph.edges.map((e) => [edgeKey(e), e]));
  const bNodes = new Set(base.graph.nodes);
  const hNodes = new Set(head.graph.nodes);

  const report: Report = {
    app: opts.appName,
    base: { name: base.ref ?? base.label, ...(base.commit ? { commit: base.commit } : {}) },
    head: { name: head.ref ?? head.label, ...(head.commit ? { commit: head.commit } : {}) },
    mode: opts.mode,
    generatedAt: new Date().toISOString(),
    summary: {
      identical: count("identical"),
      visualOnly: count("visual-only"),
      structural: count("structural"),
      added: count("added"),
      removed: count("removed"),
      failed: count("failed"),
    },
    states,
    unmockedRequests: [
      ...base.unmocked.map((u) => ({ ref: "base" as const, ...u })),
      ...head.unmocked.map((u) => ({ ref: "head" as const, ...u })),
    ],
    flowGraph: {
      addedStates: [...hNodes].filter((n) => !bNodes.has(n)),
      removedStates: [...bNodes].filter((n) => !hNodes.has(n)),
      addedTransitions: [...hEdges.entries()].filter(([k]) => !bEdges.has(k)).map(([, e]) => e),
      removedTransitions: [...bEdges.entries()].filter(([k]) => !hEdges.has(k)).map(([, e]) => e),
    },
  };

  const problems = validateAgainst("report", report);
  if (problems.length) throw new Error(`internal: generated report is invalid: ${problems.join("; ")}`);

  writeJson(join(out, "report.json"), report);
  writeText(join(out, "report.html"), renderHtml(report, { baseGraph: base.graph, headGraph: head.graph }));
  writeText(join(out, "REPORT.md"), renderMarkdown(report, { headGraph: head.graph }));
  return report;
}

/** Re-renders HTML and Markdown from an existing report.json. */
export function rerender(appDir: string, baseLabel: string, headLabel: string): string {
  const out = reportDir(appDir, baseLabel, headLabel);
  const report = readStructured<Report>(join(out, "report.json"));
  const head = readStructured<RunInfo>(join(runDir(appDir, headLabel), "run.json"));
  const base = readStructured<RunInfo>(join(runDir(appDir, baseLabel), "run.json"));
  writeText(join(out, "report.html"), renderHtml(report, { baseGraph: base.graph, headGraph: head.graph }));
  writeText(join(out, "REPORT.md"), renderMarkdown(report, { headGraph: head.graph }));
  return out;
}

/** Exit-code policy. restyle is a gate; flow-audit only fails when something could not be captured. */
export function failureReasons(report: Report): string[] {
  const s = report.summary;
  const reasons: string[] = [];
  if (s.failed > 0) reasons.push(`${s.failed} state(s) could not be captured`);
  if (report.mode === "restyle") {
    if (s.structural > 0) reasons.push(`${s.structural} state(s) changed structurally (accessibility tree, requests or console errors)`);
    if (s.added > 0) reasons.push(`${s.added} state(s) were added`);
    if (s.removed > 0) reasons.push(`${s.removed} state(s) were removed`);
    const unmocked = (report.unmockedRequests ?? []).filter((u) => u.ref === "head").length;
    if (unmocked > 0) reasons.push(`${unmocked} request(s) in head had no mock`);
  }
  return reasons;
}
