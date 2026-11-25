import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { failureReasons } from "./compare.js";
import { runCompare } from "./pipeline.js";

const here = dirname(fileURLToPath(import.meta.url));
const demo = resolve(here, "../../../examples/static-demo");

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdio: "pipe" });
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "chipchop-demo-"));
  git(dir, "init", "-q", "-b", "develop");
  const put = (from: string, to = "") => cpSync(join(demo, from), join(dir, to), { recursive: true });
  put("base", "");
  put("server.mjs", "server.mjs");
  put("chipchop-base", ".chipchop");
  writeFileSync(join(dir, ".gitignore"), ".chipchop/runs/\n.chipchop/reports/\n.chipchop/assets/\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "base");
  git(dir, "branch", "restyle");
  git(dir, "branch", "feature");
  git(dir, "checkout", "-q", "restyle");
  cpSync(join(demo, "restyle/style.css"), join(dir, "style.css"));
  git(dir, "commit", "-qam", "restyle");
  git(dir, "checkout", "-q", "feature");
  cpSync(join(demo, "feature/app.js"), join(dir, "app.js"));
  cpSync(join(demo, "feature/style.css"), join(dir, "style.css"));
  rmSync(join(dir, ".chipchop"), { recursive: true });
  cpSync(join(demo, "chipchop-feature"), join(dir, ".chipchop"), { recursive: true });
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "feature");
  git(dir, "checkout", "-q", "develop");
  return dir;
}

test("restyle: only pixels change", { timeout: 300000 }, async () => {
  const dir = makeRepo();
  const logs: string[] = [];
  const { report, dir: out } = await runCompare({
    appDir: dir,
    base: { label: "develop", ref: "develop" },
    head: { label: "restyle", ref: "restyle" },
    mode: "restyle",
    install: false,
    log: (l) => logs.push(l),
  });
  console.log(JSON.stringify(report.summary), logs.slice(-5).join("\n"));
  assert.equal(report.summary.structural, 0);
  assert.equal(report.summary.added, 0);
  assert.equal(report.summary.removed, 0);
  assert.equal(report.summary.failed, 0);
  assert.ok(report.summary.visualOnly > 0, "restyle should produce visual differences");
  assert.deepEqual(failureReasons(report), []);
  assert.ok(existsSync(join(out, "report.html")));
  assert.ok(readFileSync(join(out, "REPORT.md"), "utf8").includes("Visual only"));
  rmSync(dir, { recursive: true, force: true });
});

test("feature: new modal is reported as added", { timeout: 300000 }, async () => {
  const dir = makeRepo();
  const { report } = await runCompare({
    appDir: dir,
    base: { label: "develop", ref: "develop" },
    head: { label: "feature", ref: "feature" },
    mode: "flow-audit",
    install: false,
  });
  console.log(JSON.stringify(report.summary), JSON.stringify(report.flowGraph));
  assert.ok(report.states.some((s) => s.id === "passwords-share-modal" && s.status === "added"));
  assert.ok(report.flowGraph?.addedStates?.includes("passwords-share-modal"));
  assert.equal(report.summary.failed, 0);
  assert.deepEqual(failureReasons(report), []);
  rmSync(dir, { recursive: true, force: true });
});
