import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capture } from "./capture.js";
import { hasCatalog, loadCatalog, resolveConfig } from "./catalog.js";
import { compareRuns, reportDir, runDir, type Mode } from "./compare.js";
import { chipDir } from "./paths.js";
import { prepareTarget, type Target } from "./runner.js";
import type { Report, RunInfo } from "./types.js";
import { formatIssues, validateCatalogDir } from "./validate.js";

export interface CaptureJob {
  appDir: string;
  outDir?: string;
  target: Target;
  catalog?: "auto" | "cwd" | "ref";
  install?: boolean;
  keepWorktree?: boolean;
  only?: string[];
  viewport?: string;
  headed?: boolean;
  log?: (line: string) => void;
}

export async function runCapture(job: CaptureJob): Promise<RunInfo> {
  const log = job.log ?? (() => {});
  const prepared = await prepareTarget({
    hostAppDir: job.appDir,
    target: job.target,
    catalog: job.catalog ?? "auto",
    install: job.install ?? true,
    keepWorktree: job.keepWorktree ?? false,
    log,
  });
  try {
    return await capture({
      target: prepared,
      outDir: job.outDir ?? runDir(job.appDir, job.target.label),
      assetsDir: join(chipDir(job.appDir), "assets"),
      ...(job.only ? { only: job.only } : {}),
      ...(job.viewport ? { viewport: job.viewport } : {}),
      ...(job.headed ? { headed: job.headed } : {}),
      log,
    });
  } finally {
    await prepared.cleanup();
  }
}

interface BranchValidation {
  ref: string;
  captured: number;
  failed: number;
  unmocked?: number;
  preview?: { id: string; viewport: string; png: string };
  error?: string;
}

export async function validateCaptures(appDir: string, refs: [string, string], log: (line: string) => void) {
  const issues = validateCatalogDir(appDir);
  const text = issues.length ? formatIssues(issues) : "";
  if (text) log(text);
  const branches: BranchValidation[] = [];
  if (issues.some((issue) => issue.severity === "error")) return { text, branches, pairs: 0, ok: false };

  const dir = mkdtempSync(join(tmpdir(), "chipchop-validation-"));
  const capturedKeys: Set<string>[] = [];
  try {
    for (const [index, ref] of refs.entries()) {
      log(`== comprobando capturas de ${ref}`);
      const outDir = join(dir, String(index));
      try {
        const run = await runCapture({ appDir, outDir, target: { label: ref, ref }, catalog: "cwd", log });
        const captures = run.results.filter((result) => result.ok);
        const failures = run.results.filter((result) => !result.ok);
        for (const request of run.unmocked.slice(0, 10)) {
          log(`  sin mock: ${request.method} ${request.url.split("?")[0]} (${request.state})`);
        }
        const first = captures[0];
        const preview = first ? {
          id: first.id,
          viewport: first.viewport,
          png: readFileSync(join(outDir, `${first.id}.${first.viewport}.png`)).toString("base64"),
        } : undefined;
        branches.push({
          ref, captured: captures.length, failed: failures.length, unmocked: run.unmocked.length,
          ...(preview ? { preview } : {}),
          ...(failures[0]?.error ? { error: failures[0].error } : {}),
        });
        capturedKeys.push(new Set(captures.map(({ id, viewport }) => JSON.stringify([id, viewport]))));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(message);
        branches.push({ ref, captured: 0, failed: 0, error: message });
        capturedKeys.push(new Set<string>());
      }
    }
    const [base, head] = capturedKeys;
    const pairs = [...(base ?? [])].filter((key) => head?.has(key)).length;
    return { text, branches, pairs, ok: pairs > 0 && branches.every((branch) => branch.failed === 0 && !branch.error) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface CompareJob extends Omit<CaptureJob, "target" | "outDir"> {
  base: Target;
  head: Target;
  mode: Mode;
  reuse?: boolean;
}

export async function runCompare(job: CompareJob): Promise<{ report: Report; dir: string }> {
  const log = job.log ?? (() => {});
  for (const t of [job.base, job.head]) {
    if (job.reuse && existsSync(join(runDir(job.appDir, t.label), "run.json"))) {
      log(`reusing capture "${t.label}"`);
      continue;
    }
    log(`== capturing ${t.label}`);
    await runCapture({ ...job, target: t });
  }
  log("== comparing");
  const host = hasCatalog(job.appDir) ? loadCatalog(job.appDir).config : undefined;
  const config = host ?? resolveConfig({ app: "app", framework: "other", serve: { command: "", url: "" } });
  const report = compareRuns({
    appDir: job.appDir,
    baseLabel: job.base.label,
    headLabel: job.head.label,
    mode: job.mode,
    appName: config.app,
    compare: config.compare,
  });
  const dir = reportDir(job.appDir, job.base.label, job.head.label);
  log(`report: ${join(dir, "report.html")}`);
  return { report, dir };
}
