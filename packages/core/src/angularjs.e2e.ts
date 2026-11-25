import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { delimiter, join } from "node:path";
import { after, before, test } from "node:test";
import { failureReasons } from "./compare.js";
import { angularJsDemoModules, angularJsInstalled, makeAngularJsRepo } from "./demoRepo.js";
import { runCompare } from "./pipeline.js";
import type { Report } from "./types.js";

// AngularJS comes from npm (examples/angularjs-demo/package.json). CI installs it
// (`npm install --prefix examples/angularjs-demo`); locally the test is skipped, loudly, when it is missing.
const installed = angularJsInstalled();
if (!installed && process.env.CI) {
  throw new Error(`AngularJS is not installed in ${angularJsDemoModules}: run "npm install --prefix examples/angularjs-demo"`);
}
const skip = installed ? false : `AngularJS not installed (run "npm install --prefix examples/angularjs-demo")`;

const STATES = ["login", "home", "passwords", "passwords-empty", "passwords-delete-modal", "passwords-deleted"];
const VIEWPORTS = ["desktop", "mobile"];

let dir = "";
const compare = (base: { label: string; ref: string }, head: { label: string; ref: string }, mode: "restyle" | "flow-audit") =>
  runCompare({ appDir: dir, base, head, mode, install: false, reuse: true });

const byId = (report: Report, id: string) => report.states.filter((s) => s.id === id);

before(() => {
  if (skip) return;
  dir = makeAngularJsRepo();
  // The apps' build step (node build.mjs) finds AngularJS here: the temp checkouts have no node_modules.
  process.env.NODE_PATH = [angularJsDemoModules, process.env.NODE_PATH].filter(Boolean).join(delimiter);
});
after(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test("same commit twice: nothing differs (no false positives from digest timing or $http)", { timeout: 600000, skip }, async () => {
  const { report } = await compare({ label: "develop", ref: "develop" }, { label: "develop-again", ref: "develop" }, "restyle");
  console.log(JSON.stringify(report.summary));
  assert.equal(report.states.length, STATES.length * VIEWPORTS.length);
  assert.deepEqual(report.summary, { identical: STATES.length * VIEWPORTS.length, visualOnly: 0, structural: 0, added: 0, removed: 0, failed: 0 });
  assert.deepEqual(report.unmockedRequests, []);
  assert.deepEqual(failureReasons(report), []);
});

test("the captures show the rendered AngularJS app, not a loading state", { timeout: 600000, skip }, () => {
  const run = join(dir, ".chipchop", "runs", "develop");
  const read = (f: string): string => readFileSync(join(run, f), "utf8");
  for (const vp of VIEWPORTS) {
    // data that arrives through $http after the route template has loaded
    assert.match(read(`passwords.${vp}.aria.yml`), /Old forum/);
    assert.doesNotMatch(read(`passwords.${vp}.aria.yml`), /Loading/);
    assert.match(read(`home.${vp}.aria.yml`), /Total/);
    assert.match(read(`passwords-empty.${vp}.aria.yml`), /No passwords yet/);
    // modal opened by ng-click, role=dialog from an ng-if
    assert.match(read(`passwords-delete-modal.${vp}.aria.yml`), /dialog "Delete password"/);
    // after Confirm: DELETE /api/passwords/:id answered by the mock, row gone, modal gone
    assert.doesNotMatch(read(`passwords-deleted.${vp}.aria.yml`), /Email/);
    assert.doesNotMatch(read(`passwords-deleted.${vp}.aria.yml`), /dialog/);
    assert.deepEqual(JSON.parse(read(`passwords-deleted.${vp}.requests.json`)), ["DELETE /api/passwords/1", "GET /api/passwords"]);
    // form: fill + POST with bodyContains, then a route change; templates are not listed as requests
    assert.deepEqual(JSON.parse(read(`home.${vp}.requests.json`)), ["GET /api/summary", "POST /api/login"]);
    assert.deepEqual(JSON.parse(read(`passwords.${vp}.requests.json`)), ["GET /api/passwords"]);
  }
  for (const f of ["passwords", "home", "login"]) {
    const errors = JSON.parse(read(`${f}.desktop.console.json`)) as string[];
    assert.deepEqual(errors.filter((e) => /uncaught|\[\$|angularjs\.org/i.test(e)), []);
  }
});

test("restyle: only pixels change, in every state", { timeout: 600000, skip }, async () => {
  const { report, dir: out } = await compare({ label: "develop", ref: "develop" }, { label: "restyle", ref: "restyle" }, "restyle");
  console.log(JSON.stringify(report.summary));
  assert.deepEqual(report.summary, { identical: 0, visualOnly: STATES.length * VIEWPORTS.length, structural: 0, added: 0, removed: 0, failed: 0 });
  assert.deepEqual(report.unmockedRequests, []);
  assert.deepEqual(report.flowGraph?.addedStates, []);
  assert.deepEqual(report.flowGraph?.removedStates, []);
  assert.deepEqual(failureReasons(report), []);
  assert.ok(existsSync(join(out, "report.html")));
});

test("feature: share dialog added, pages that gained a button are structural, the rest only restyled", { timeout: 600000, skip }, async () => {
  const { report } = await compare({ label: "develop", ref: "develop" }, { label: "feature", ref: "feature" }, "flow-audit");
  console.log(JSON.stringify(report.summary), JSON.stringify(report.flowGraph?.addedTransitions));
  const status = (id: string): string[] => byId(report, id).map((s) => s.status);
  const both = (s: string): string[] => VIEWPORTS.map(() => s);
  assert.deepEqual(status("login"), both("visual-only"));
  assert.deepEqual(status("home"), both("visual-only"));
  assert.deepEqual(status("passwords-empty"), both("visual-only"));
  // the new "Share" buttons are in the accessibility tree behind the table and behind the delete dialog
  for (const id of ["passwords", "passwords-delete-modal", "passwords-deleted"]) {
    assert.deepEqual(status(id), both("structural"), id);
    for (const s of byId(report, id)) {
      assert.equal(s.structural?.ariaChanged, true, id);
      assert.deepEqual(s.structural?.requestsAdded, [], id);
      assert.deepEqual(s.structural?.requestsRemoved, [], id);
    }
  }
  assert.deepEqual(status("passwords-share-modal"), both("added"));
  assert.deepEqual(status("passwords-share-sent"), both("added"));
  assert.deepEqual(report.summary, { identical: 0, visualOnly: 6, structural: 6, added: 4, removed: 0, failed: 0 });
  assert.deepEqual([...(report.flowGraph?.addedStates ?? [])].sort(), ["passwords-share-modal", "passwords-share-sent"]);
  assert.deepEqual(report.flowGraph?.removedStates, []);
  assert.deepEqual(report.unmockedRequests, []);
  // flow-audit is informational; the same result fails the restyle gate
  assert.deepEqual(failureReasons(report), []);
  assert.notDeepEqual(failureReasons({ ...report, mode: "restyle" }), []);
  // the share flow really ran: select + Send posted the body the mock requires
  const sent = readFileSync(join(dir, ".chipchop", "runs", "feature", "passwords-share-sent.desktop.requests.json"), "utf8");
  assert.ok(sent.includes("POST /api/share"), sent);
});
