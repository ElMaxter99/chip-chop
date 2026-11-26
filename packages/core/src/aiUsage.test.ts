import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeEvent, formatUsage, parseOutput, recordRun, sumUsage, summarizeUsage } from "./aiUsage.js";

const L = (...o: object[]): string => o.map((x) => JSON.stringify(x)).join("\n");

test("Claude stream-json: pasos legibles, respuesta final, tokens y coste", () => {
  const out = L(
    { type: "system", subtype: "init", model: "claude-sonnet-x" },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/app/src/main.ts" } }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "/app/.chipchop/states.yaml" } }, { type: "text", text: "listo" }] } },
    { type: "result", result: "hecho", is_error: false, total_cost_usd: 0.1234, num_turns: 3, modelUsage: { m: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 1000, cacheCreationInputTokens: 10 } } },
  );
  assert.deepEqual(describeEvent("claude", out.split("\n")[1]!), ["lee main.ts"]);
  assert.deepEqual(describeEvent("claude", out.split("\n")[2]!), ["escribe states.yaml", "responde (5 caracteres)"]);
  const r = parseOutput("claude", out);
  assert.equal(r.text, "hecho");
  assert.deepEqual(r.usage, { input: 100, output: 50, cacheRead: 1000, cacheWrite: 10, costUsd: 0.1234, turns: 3 });
  assert.equal(r.isError, false);
  assert.match(formatUsage(r.usage), /160 tokens.*≈ \$0\.12 equivalente/);
});

test("Copilot JSONL: respuesta, AI credits y premium requests", () => {
  const out = L(
    { type: "assistant.message", data: { toolRequests: [{ name: "view", arguments: { path: "/a/b/c.ts" } }], content: "" } },
    { type: "session.usage_checkpoint", data: { totalNanoAiu: 6_760_000_000, totalPremiumRequests: 1, accountingSnapshot: { tokenDetails: { input: { tokenCount: 900 }, output: { tokenCount: 100 }, cache_read: { tokenCount: 50 } } } } },
    { type: "assistant.message", data: { content: "ok" } },
    { type: "result", exitCode: 0, usage: { premiumRequests: 1 } },
  );
  assert.deepEqual(describeEvent("copilot", out.split("\n")[0]!), ["lee c.ts"]);
  const r = parseOutput("copilot", out);
  assert.equal(r.text, "ok");
  assert.equal(r.usage?.aiCredits, 6.76);
  assert.equal(r.usage?.premiumRequests, 1);
  assert.match(formatUsage(r.usage), /6\.76 AI credits.*1 premium request$/);
});

test("Codex --json: tokens de turn.completed y texto del agente", () => {
  const out = L(
    { type: "item.completed", item: { type: "command_execution", command: "ls -la" } },
    { type: "item.completed", item: { type: "agent_message", text: "hecho" } },
    { type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 80 } },
  );
  assert.deepEqual(describeEvent("codex", out.split("\n")[0]!), ["ejecuta: ls -la"]);
  const r = parseOutput("codex", out);
  assert.equal(r.text, "hecho");
  assert.deepEqual(r.usage, { input: 600, output: 80, cacheRead: 400, cacheWrite: 0, turns: 1 });
});

test("sin eventos reconocibles se devuelve la salida cruda y nada de consumo", () => {
  const r = parseOutput("claude", "texto plano\notra línea");
  assert.equal(r.parsed, false);
  assert.equal(r.text, "texto plano\notra línea");
  assert.equal(r.usage, null);
  assert.match(formatUsage(null), /no los informa/);
});

test("registro y resumen por etapa", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-usage-"));
  const run = (stage: string, input: number, cost?: number) => ({ at: "2026-01-01T00:00:00Z", stage, provider: "claude", model: "sonnet", ms: 1000, ok: true, usage: { input, output: 10, cacheRead: 0, cacheWrite: 0, ...(cost ? { costUsd: cost } : {}) } });
  recordRun(dir, run("discover", 100, 0.5));
  recordRun(dir, run("flows", 20, 0.01));
  recordRun(dir, run("discover", 300, 1));
  const s = summarizeUsage(dir);
  const d = s.stages.find((x) => x.stage === "discover")!;
  assert.equal(d.runs, 2);
  assert.equal(d.last?.usage?.input, 300);
  assert.equal(d.total?.costUsd, 1.5);
  assert.equal(s.total?.input, 420);
  assert.equal(sumUsage([null, undefined]), null);
});

test("Copilot: un checkpoint posterior sin tokens no borra los anteriores; sin tokens no se muestra «0 tokens»; las sumas se redondean", () => {
  const out = L(
    { type: "session.usage_checkpoint", data: { totalNanoAiu: 1_000_000_000, accountingSnapshot: { tokenDetails: { input: { tokenCount: 500 }, output: { tokenCount: 50 } } } } },
    { type: "session.usage_checkpoint", data: { totalNanoAiu: 2_000_000_000 } },
    { type: "assistant.message", data: { content: "ok" } },
  );
  const u = parseOutput("copilot", out).usage!;
  assert.equal(u.input, 500);
  assert.equal(u.aiCredits, 2);
  const only = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, aiCredits: 7.84, premiumRequests: 0.33 };
  assert.equal(formatUsage(only), "7.84 AI credits · 0.33 premium requests");
  const s = sumUsage([only, { ...only, premiumRequests: 1 }, { ...only, premiumRequests: 0.33 }, { ...only, premiumRequests: 0.33 }, { ...only, premiumRequests: 0.33 }, { ...only, premiumRequests: 0.33 }])!;
  assert.equal(s.premiumRequests, 2.65);
});
