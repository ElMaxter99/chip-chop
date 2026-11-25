import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initProject } from "./init.js";
import { validateCatalogDir } from "./validate.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "chipchop-test-"));
}

test("a freshly initialised project validates without errors", () => {
  const dir = tmp();
  initProject(dir, { framework: "angularjs" });
  const issues = validateCatalogDir(dir).filter((i) => i.severity === "error");
  assert.deepEqual(issues, []);
});

test("missing config is reported", () => {
  const dir = tmp();
  const issues = validateCatalogDir(dir);
  assert.ok(issues.some((i) => i.severity === "error" && i.message.includes("missing")));
});

test("unknown capture target and unknown mock are reported", () => {
  const dir = tmp();
  initProject(dir, { framework: "react" });
  writeFileSync(
    join(dir, ".chipchop/flows/bad.flow.yaml"),
    "id: bad\ntitle: Bad\nmocks: [nope/missing]\nsteps:\n  - capture: ghost\n",
  );
  const msgs = validateCatalogDir(dir).map((i) => i.message);
  assert.ok(msgs.some((m) => m.includes('unknown mock "nope/missing"')));
  assert.ok(msgs.some((m) => m.includes('unknown state "ghost"')));
});

test("mock id must match its path and response must satisfy responseSchema", () => {
  const dir = tmp();
  initProject(dir, { framework: "react" });
  mkdirSync(join(dir, ".chipchop/mocks/a"), { recursive: true });
  writeFileSync(
    join(dir, ".chipchop/mocks/a/wrong.mock.json"),
    JSON.stringify({
      id: "a/other",
      requests: [
        {
          match: { method: "GET", url: "/api/x" },
          responseSchema: { type: "object", properties: { isActive: { type: "boolean" } }, required: ["isActive"] },
          response: { status: 200, json: { isActive: "yes" } },
        },
      ],
    }),
  );
  const msgs = validateCatalogDir(dir).map((i) => i.message);
  assert.ok(msgs.some((m) => m.includes('must equal its path "a/wrong"')));
  assert.ok(msgs.some((m) => m.includes("does not match its responseSchema")));
});

test("opensFrom loops are reported", () => {
  const dir = tmp();
  initProject(dir, { framework: "react" });
  writeFileSync(
    join(dir, ".chipchop/states.yaml"),
    `states:
  - { id: a, title: A, kind: modal, opensFrom: b }
  - { id: b, title: B, kind: modal, opensFrom: a }
`,
  );
  const msgs = validateCatalogDir(dir).map((i) => i.message);
  assert.ok(msgs.some((m) => m.includes("loops")));
});
