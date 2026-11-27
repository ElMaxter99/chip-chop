import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildInvocation, loadAiConfig, promptFor, runAi } from "./ai.js";
import { initProject } from "./init.js";
import { writeText } from "./fsutil.js";

test("claude invocation: model per stage, prompt on stdin, scoped tools", () => {
  const inv = buildInvocation({ type: "claude", command: "claude" }, { provider: "claude", model: "haiku" }, "hi");
  assert.equal(inv.stdin, "hi");
  assert.deepEqual(inv.args.slice(0, 3), ["-p", "--model", "haiku"]);
  assert.ok(inv.args.includes("--allowedTools"));
  assert.ok(!inv.args.includes("hi"));
});

test("copilot invocation: prompt as argument, shell denied", () => {
  const inv = buildInvocation({ type: "copilot" }, { provider: "copilot", model: "gpt-5-mini", extraArgs: ["--x"] }, "do it");
  assert.equal(inv.command, "copilot");
  assert.deepEqual(inv.args.slice(0, 2), ["-p", "do it"]);
  assert.ok(inv.args.includes("--model") && inv.args.includes("gpt-5-mini"));
  assert.ok(inv.args.includes("--deny-tool=shell") && inv.args.includes("--x"));
});

test("custom invocation substitutes {prompt} and {model}", () => {
  const inv = buildInvocation({ type: "custom", command: "x", args: ["--p", "{prompt}", "--m", "{model}"] }, { provider: "c", model: "m1" }, "P");
  assert.deepEqual(inv.args, ["--p", "P", "--m", "m1"]);
});

test("project ai.yaml overrides defaults per stage", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-ai-"));
  process.env.CHIPCHOP_HOME = join(dir, "home");
  writeText(join(dir, ".chipchop/ai.yaml"), "stages:\n  flows: { provider: copilot, model: gpt-5-mini }\n");
  const cfg = loadAiConfig(dir);
  assert.equal(cfg.stages.flows?.provider, "copilot");
  assert.equal(cfg.stages.flows?.model, "gpt-5-mini");
  assert.equal(cfg.stages.mocks?.provider, "claude");
});

test("prompts can be overridden from promptsDir", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-pr-"));
  writeText(join(dir, "p/flows.md"), "custom {{extra}}");
  assert.equal(promptFor("flows", dir, { extra: "E" }, "p"), "custom E");
});

test("pipeline: fake CLI writes a bad file, repair stage fixes it", { timeout: 60000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-pipe-"));
  process.env.CHIPCHOP_HOME = join(dir, "home");
  initProject(dir, { framework: "other", force: false });
  const fake = join(dir, "fake-ai.mjs");
  writeFileSync(
    fake,
    `import { writeFileSync, mkdirSync } from "node:fs";
const prompt = process.argv[2];
mkdirSync(".chipchop/mocks", { recursive: true });
if (prompt.startsWith("chip-chop validate")) {
  writeFileSync(".chipchop/mocks/x.mock.json", JSON.stringify({ id: "x", requests: [{ match: { method: "GET", url: "/a" }, response: { status: 200, json: {} } }] }));
} else if (prompt.includes("write typed")) {
  writeFileSync(".chipchop/mocks/x.mock.json", JSON.stringify({ id: "WRONG", requests: [{ match: { method: "GET", url: "/a" }, response: { status: 200, json: {} } }] }));
}
`,
  );
  chmodSync(fake, 0o755);
  writeText(
    join(dir, ".chipchop/ai.yaml"),
    `providers:\n  fake: { type: custom, command: node, args: ["${fake.replaceAll("\\", "/")}", "{prompt}"] }\nstages:\n  discover: { provider: fake }\n  flows: { provider: fake }\n  mocks: { provider: fake }\n  repair: { provider: fake }\nsettings: { maxRepairs: 2 }\n`,
  );
  const lines: string[] = [];
  const r = await runAi({ appDir: dir, stages: ["mocks"], log: (l) => lines.push(l) });
  assert.ok(lines.some((l) => l.includes("repair attempt")), lines.join("\n"));
  assert.equal(r.ok, true, r.issues);
});

test("repair-only passes a large catalog error list by file and removes it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-repair-"));
  process.env.CHIPCHOP_HOME = join(dir, "home");
  try {
    initProject(dir, { framework: "other", force: false });
    const states = join(dir, ".chipchop", "states.yaml");
    writeFileSync(join(dir, "valid-states.yaml"), readFileSync(states));
    const mocks = Array.from({ length: 2225 }, (_, i) => `missing-mock-${i}`);
    writeFileSync(states, JSON.stringify({ states: [{ id: "home", kind: "page", title: "Home", url: "/", mocks }] }));
    writeFileSync(join(dir, "fake-ai.mjs"), `import assert from "node:assert/strict";
import { copyFileSync, readFileSync } from "node:fs";
const prompt = process.argv[2];
assert.ok(Buffer.byteLength(prompt) < 4000);
const path = /Read "([^"]+diagnostics[.]txt)"/.exec(prompt)?.[1];
assert.ok(path);
const diagnostics = readFileSync(path, "utf8");
assert.match(diagnostics, /missing-mock-2224/);
assert.ok(Buffer.byteLength(diagnostics) > 128 * 1024);
copyFileSync("valid-states.yaml", ".chipchop/states.yaml");
`);
    writeText(join(dir, ".chipchop", "ai.yaml"), `providers:
  fake: { type: custom, command: node, args: ["fake-ai.mjs", "{prompt}"] }
stages:
  repair: { provider: fake }
settings: { maxRepairs: 0 }
`);
    const result = await runAi({ appDir: dir, stages: ["repair"] });
    assert.equal(result.ok, true, result.issues);
    assert.deepEqual(result.runs.map((run) => run.stage), ["repair"]);
    assert.ok(!readdirSync(join(dir, ".chipchop")).some((name) => name.startsWith(".repair-")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("codex: exec por stdin, sandbox que permite escribir .chipchop y modelo opcional", () => {
  const inv = buildInvocation({ type: "codex" }, { provider: "codex", model: "gpt-x" }, "hola");
  assert.equal(inv.command, "codex");
  assert.deepEqual(inv.args, ["exec", "--sandbox", "workspace-write", "--skip-git-repo-check", "--color", "never", "--json", "--model", "gpt-x", "-"]);
  assert.equal(inv.stdin, "hola");
  assert.ok(!buildInvocation({ type: "codex", sandbox: "read-only" }, { provider: "codex" }, "x").args.includes("--model"));
});
