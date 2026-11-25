import { existsSync } from "node:fs";
import { join } from "node:path";
import { capture } from "./capture.js";
import { hasCatalog, loadCatalog, resolveConfig } from "./catalog.js";
import { compareRuns, reportDir, runDir, type Mode } from "./compare.js";
import { chipDir } from "./paths.js";
import { prepareTarget, type Target } from "./runner.js";
import type { Report, RunInfo } from "./types.js";

export interface CaptureJob {
  appDir: string;
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
      outDir: runDir(job.appDir, job.target.label),
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

export interface CompareJob extends Omit<CaptureJob, "target"> {
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
