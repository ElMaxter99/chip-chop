import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCommand } from "./tools.js";
import { parseCopilotModels } from "./aiInfo.js";

test("resolveCommand encuentra un ejecutable por ruta explícita o en el PATH", async () => {
  const d = mkdtempSync(join(tmpdir(), "tools-"));
  const name = process.platform === "win32" ? "mi-herramienta.exe" : "mi-herramienta";
  const f = join(d, name);
  writeFileSync(f, "x");
  chmodSync(f, 0o755);
  assert.equal((await resolveCommand(f))?.via, "explicit");
  const old = process.env.PATH;
  process.env.PATH = `${d}${process.platform === "win32" ? ";" : ":"}${old}`;
  try {
    const r = await resolveCommand("mi-herramienta");
    assert.equal(r?.via, "path");
    assert.equal(r?.path, f);
  } finally {
    process.env.PATH = old;
  }
  assert.equal(await resolveCommand("no-existe-chip-chop-xyz"), undefined);
});

test("resolveCommand mira las carpetas habituales (~/.local/bin) aunque no estén en el PATH", async () => {
  if (process.platform === "win32") return;
  const home = mkdtempSync(join(tmpdir(), "home-"));
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  const f = join(home, ".local", "bin", "herramienta-habitual");
  writeFileSync(f, "x");
  chmodSync(f, 0o755);
  const old = process.env.HOME;
  process.env.HOME = home;
  try {
    const r = await resolveCommand("herramienta-habitual");
    assert.equal(r?.via, "known");
  } finally {
    process.env.HOME = old;
  }
});

test("parseCopilotModels lee los nombres de la opción --model de copilot help", () => {
  const help = `Options:\n  -h, --help   Display help\n  --model <model>  Set the AI model (choices: "claude-sonnet-4.5", "gpt-5", "gpt-5-mini")\n  --banner  Show the startup banner\n`;
  assert.deepEqual(parseCopilotModels(help), ["claude-sonnet-4.5", "gpt-5", "gpt-5-mini"]);
  assert.deepEqual(parseCopilotModels("sin opciones"), []);
});
