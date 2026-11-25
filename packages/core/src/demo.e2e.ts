import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { failureReasons } from "./compare.js";
import { runCompare } from "./pipeline.js";
import { makeRepo } from "./demoRepo.js";

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
