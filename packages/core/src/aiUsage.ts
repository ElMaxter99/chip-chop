// Medición de lo que gasta la IA. Cada CLI cuenta de una forma:
//  · Claude Code (`--output-format stream-json --verbose`): tokens y coste equivalente en USD (`total_cost_usd`) en el evento final.
//  · Copilot CLI (`--output-format json`, JSONL): tokens, «AI credits» (totalNanoAiu / 1e9) y premium requests.
//  · Codex (`exec --json`): tokens en `turn.completed` (sin coste).
// Todo se parsea de la salida real del CLI; nada se estima ni se inventa. Lo que un CLI no informa queda sin rellenar.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { chipDir } from "./paths.js";

export interface AiUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** coste equivalente en dólares que informa Claude Code (con suscripción no se cobra por token: cuenta contra tus límites) */
  costUsd?: number;
  /** AI credits que informa Copilot */
  aiCredits?: number;
  premiumRequests?: number;
  turns?: number;
}

export type ParserKind = "claude" | "copilot" | "codex";

export interface StreamResult {
  /** texto de la respuesta final de la IA (o la salida cruda si no se pudo interpretar) */
  text: string;
  usage: AiUsage | null;
  isError: boolean;
  /** el CLI emitió eventos que sabemos leer */
  parsed: boolean;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const base = (p: unknown): string => String(p ?? "").split(/[\\/]/).pop()!.slice(0, 80);
const cut = (s: unknown, n = 90): string => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Una línea de evento → líneas legibles para la persona (vacío si el evento no aporta). */
export function describeEvent(kind: ParserKind, line: string): string[] {
  let j: Json;
  try {
    j = JSON.parse(line) as Json;
  } catch {
    return [];
  }
  if (!j || typeof j !== "object") return [];
  const out: string[] = [];
  if (kind === "claude") {
    if (j.type === "assistant") {
      for (const c of (j.message?.content ?? []) as Json[]) {
        if (c.type === "tool_use") out.push(toolLine(String(c.name), c.input ?? {}));
        else if (c.type === "text" && c.text) out.push(`responde (${String(c.text).length} caracteres)`);
      }
    } else if (j.type === "system" && j.subtype === "init") out.push(`sesión iniciada${j.model ? ` con ${j.model}` : ""}`);
  } else if (kind === "copilot") {
    if (j.type === "assistant.message") {
      for (const r of (j.data?.toolRequests ?? []) as Json[]) out.push(toolLine(String(r?.name ?? "herramienta"), r?.arguments ?? {}));
      if (typeof j.data?.content === "string" && j.data.content) out.push(`responde (${j.data.content.length} caracteres)`);
    }
  } else {
    const it = j.item as Json | undefined;
    if (j.type === "item.completed" && it) {
      if (it.type === "command_execution") out.push(`ejecuta: ${cut(it.command)}`);
      else if (it.type === "file_change") out.push(`modifica ${(it.changes ?? []).map((c: Json) => base(c.path)).join(", ") || "archivos"}`);
      else if (it.type === "agent_message") out.push(`responde (${String(it.text ?? "").length} caracteres)`);
      else if (it.type === "reasoning") out.push("razona…");
    }
  }
  return out;
}

function toolLine(name: string, input: Json): string {
  const file = base(input.file_path ?? input.path ?? input.filePath ?? input.notebook_path);
  const n = name.toLowerCase();
  if (n === "read" || n === "view") return `lee ${file || "un archivo"}`;
  if (n === "write" || n === "create") return `escribe ${file || "un archivo"}`;
  if (n === "edit" || n === "multiedit" || n === "str_replace_editor") return `edita ${file || "un archivo"}`;
  if (n === "glob" || n === "grep" || n === "search") return `busca ${cut(input.pattern ?? input.query ?? "", 60)}`;
  if (n === "bash" || n === "shell") return `ejecuta: ${cut(input.command, 80)}`;
  return `${name}${file ? " " + file : ""}`;
}

/** Usage total de Claude: `modelUsage` suma todos los turnos; `usage` puede reflejar solo el último. */
export function claudeUsage(j: Json): AiUsage {
  const models = j.modelUsage && typeof j.modelUsage === "object" ? (Object.values(j.modelUsage) as Json[]) : [];
  const sum = (k: string): number => models.reduce((n, m) => n + num(m?.[k]), 0);
  const u: AiUsage = models.length
    ? { input: sum("inputTokens"), output: sum("outputTokens"), cacheRead: sum("cacheReadInputTokens"), cacheWrite: sum("cacheCreationInputTokens") }
    : { input: num(j.usage?.input_tokens), output: num(j.usage?.output_tokens), cacheRead: num(j.usage?.cache_read_input_tokens), cacheWrite: num(j.usage?.cache_creation_input_tokens) };
  if (typeof j.total_cost_usd === "number") u.costUsd = j.total_cost_usd;
  if (typeof j.num_turns === "number") u.turns = j.num_turns;
  return u;
}

function copilotCheckpoint(d: Json | undefined): AiUsage | null {
  if (!d || typeof d !== "object") return null;
  const t = (d.accountingSnapshot?.tokenDetails ?? {}) as Json;
  const n = (k: string): number => num(t[k]?.tokenCount);
  const nano = Number(d.totalNanoAiu);
  const u: AiUsage = { input: n("input"), output: n("output"), cacheRead: n("cache_read"), cacheWrite: n("cache_write") };
  if (Number.isFinite(nano) && nano > 0) u.aiCredits = Math.round(nano / 1e6) / 1e3;
  if (Number.isFinite(Number(d.totalPremiumRequests))) u.premiumRequests = Number(d.totalPremiumRequests);
  return u;
}

/** Interpreta la salida completa de un CLI (todas las líneas JSONL): respuesta final y consumo. */
export function parseOutput(kind: ParserKind, stdout: string): StreamResult {
  const events: Json[] = [];
  for (const l of String(stdout ?? "").split("\n")) {
    const t = l.trim();
    if (!t.startsWith("{")) continue;
    try {
      events.push(JSON.parse(t) as Json);
    } catch {
      /* línea parcial */
    }
  }
  const typed = events.filter((e) => typeof e?.type === "string");
  if (!typed.length) return { text: stdout, usage: null, isError: false, parsed: false };
  let text = "";
  let usage: AiUsage | null = null;
  let isError = false;
  if (kind === "claude") {
    const r = [...typed].reverse().find((e) => e.type === "result");
    if (r) {
      if (typeof r.result === "string") text = r.result;
      usage = claudeUsage(r);
      isError = r.is_error === true;
    }
  } else if (kind === "copilot") {
    let cum: AiUsage | null = null;
    let result: Json | undefined;
    for (const e of typed) {
      if (e.type === "assistant.message" && typeof e.data?.content === "string" && e.data.content.trim()) text = e.data.content;
      else if (e.type === "session.usage_checkpoint") {
        // Los contadores son acumulados: se queda con el máximo de cada campo (un checkpoint posterior puede venir sin desglose de tokens).
        const c = copilotCheckpoint(e.data);
        if (c) cum = cum ? { input: Math.max(cum.input, c.input), output: Math.max(cum.output, c.output), cacheRead: Math.max(cum.cacheRead, c.cacheRead), cacheWrite: Math.max(cum.cacheWrite, c.cacheWrite), ...(Math.max(cum.aiCredits ?? 0, c.aiCredits ?? 0) ? { aiCredits: Math.max(cum.aiCredits ?? 0, c.aiCredits ?? 0) } : {}), ...(cum.premiumRequests !== undefined || c.premiumRequests !== undefined ? { premiumRequests: Math.max(cum.premiumRequests ?? 0, c.premiumRequests ?? 0) } : {}) } : c;
      }
      else if (e.type === "result") result = e;
    }
    usage = cum;
    const prem = Number(result?.usage?.premiumRequests);
    if (Number.isFinite(prem)) usage = { ...(usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }), premiumRequests: prem };
    isError = typeof result?.exitCode === "number" && result.exitCode !== 0 && !text;
  } else {
    let acc: AiUsage | null = null;
    for (const e of typed) {
      if (e.type === "item.completed" && e.item?.type === "agent_message" && typeof e.item.text === "string") text = e.item.text;
      else if (e.type === "turn.completed" && e.usage) {
        acc = acc ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
        acc.input += num(e.usage.input_tokens) - num(e.usage.cached_input_tokens);
        acc.cacheRead += num(e.usage.cached_input_tokens);
        acc.output += num(e.usage.output_tokens);
        acc.turns = (acc.turns ?? 0) + 1;
      } else if (e.type === "turn.failed" || e.type === "error") isError = true;
    }
    usage = acc;
  }
  return { text: text || stdout, usage, isError, parsed: true };
}

/** Tokens que cuentan de verdad para el gasto: entrada, salida y escritura en caché (leer de caché es casi gratis). */
export const billedTokens = (u: AiUsage | null | undefined): number => (u ? u.input + u.output + u.cacheWrite : 0);

export function sumUsage(list: Array<AiUsage | null | undefined>): AiUsage | null {
  const found = list.filter((u): u is AiUsage => !!u);
  if (!found.length) return null;
  const out: AiUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const u of found) {
    out.input += u.input;
    out.output += u.output;
    out.cacheRead += u.cacheRead;
    out.cacheWrite += u.cacheWrite;
    for (const k of ["costUsd", "aiCredits", "premiumRequests", "turns"] as const) if (u[k] !== undefined) out[k] = (out[k] ?? 0) + (u[k] as number);
  }
  // Las sumas de decimales arrastran ruido (2.6500000000000004): se redondea.
  if (out.premiumRequests !== undefined) out.premiumRequests = Math.round(out.premiumRequests * 100) / 100;
  if (out.aiCredits !== undefined) out.aiCredits = Math.round(out.aiCredits * 100) / 100;
  if (out.costUsd !== undefined) out.costUsd = Math.round(out.costUsd * 10000) / 10000;
  return out;
}

/** Una ejecución de una etapa, tal como se guarda y se enseña. */
export interface StageRun {
  at: string;
  stage: string;
  provider: string;
  model: string;
  ms: number;
  ok: boolean;
  usage: AiUsage | null;
}

export const usageFile = (appDir: string): string => join(chipDir(appDir), "ai-usage.jsonl");

export function recordRun(appDir: string, run: StageRun): void {
  try {
    const f = usageFile(appDir);
    mkdirSync(dirname(f), { recursive: true });
    appendFileSync(f, JSON.stringify(run) + "\n");
    // El registro de consumo es local: no debe acabar en git. Si la carpeta ya tiene .gitignore, se añade la línea.
    const gi = join(dirname(f), ".gitignore");
    if (existsSync(gi) && !readFileSync(gi, "utf8").split("\n").some((l) => l.trim() === "ai-usage.jsonl")) appendFileSync(gi, `${readFileSync(gi, "utf8").endsWith("\n") ? "" : "\n"}ai-usage.jsonl\n`);
  } catch {
    /* medir no debe romper la ejecución */
  }
}

export interface StageSummary {
  stage: string;
  runs: number;
  last: StageRun | null;
  total: AiUsage | null;
  ms: number;
}

/** Resumen por etapa de todo lo registrado (la última ejecución y los totales). */
export function summarizeUsage(appDir: string): { stages: StageSummary[]; total: AiUsage | null } {
  const f = usageFile(appDir);
  const runs: StageRun[] = [];
  if (existsSync(f)) {
    for (const l of readFileSync(f, "utf8").split("\n")) {
      if (!l.trim()) continue;
      try {
        runs.push(JSON.parse(l) as StageRun);
      } catch {
        /* línea rota */
      }
    }
  }
  const by = new Map<string, StageRun[]>();
  for (const r of runs) by.set(r.stage, [...(by.get(r.stage) ?? []), r]);
  const stages = [...by.entries()].map(([stage, list]) => ({ stage, runs: list.length, last: list[list.length - 1] ?? null, total: sumUsage(list.map((r) => r.usage)), ms: list.reduce((n, r) => n + r.ms, 0) }));
  return { stages, total: sumUsage(runs.map((r) => r.usage)) };
}

const fmtN = (n: number): string => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(Math.round(n)));

/** «12,3k tokens · ≈ $0.12» — una línea con lo que el CLI informó (y solo eso). */
export function formatUsage(u: AiUsage | null | undefined): string {
  if (!u) return "sin datos de consumo (este CLI no los informa)";
  const parts = billedTokens(u) > 0 ? [`${fmtN(billedTokens(u))} tokens (entrada ${fmtN(u.input)}, salida ${fmtN(u.output)}${u.cacheRead ? `, caché leída ${fmtN(u.cacheRead)}` : ""})`] : [];
  if (!parts.length && u.costUsd === undefined && u.aiCredits === undefined && u.premiumRequests === undefined) return "sin datos de consumo (este CLI no los informa)";
  if (u.costUsd !== undefined) parts.push(`≈ $${u.costUsd.toFixed(u.costUsd < 0.1 ? 3 : 2)} equivalente`);
  if (u.aiCredits !== undefined) parts.push(`${u.aiCredits.toFixed(2)} AI credits`);
  if (u.premiumRequests !== undefined) parts.push(`${Math.round(u.premiumRequests * 100) / 100} premium request${u.premiumRequests === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
