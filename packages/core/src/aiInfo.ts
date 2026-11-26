import { execFile } from "node:child_process";
import type { loadAiConfig } from "./ai.js";
import { needsShell, quoteForCmd, resolveCommand, versionOf, type Found } from "./tools.js";

export interface ModelOption {
  value: string;
  label: string;
  hint?: string;
}
export interface ModelList {
  options: ModelOption[];
  /** `cli`: leída del propio CLI; `builtin`: lista incluida en chip-chop (puede quedarse atrás) */
  source: "cli" | "builtin";
  note?: string;
}
export interface ProviderInfo {
  type: string;
  command: string;
  found: Found | null;
  version?: string;
  models: ModelList;
}

// Claude Code acepta alias y nombres completos; no tiene un comando para listarlos, así que va incluida.
const CLAUDE_MODELS: ModelOption[] = [
  { value: "sonnet", label: "Sonnet", hint: "equilibrado" },
  { value: "opus", label: "Opus", hint: "el más capaz" },
  { value: "haiku", label: "Haiku", hint: "rápido y barato" },
  { value: "opusplan", label: "Opus plan", hint: "Opus planifica, Sonnet ejecuta" },
  { value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", hint: "versión fija" },
  { value: "claude-opus-5-5", label: "Claude Opus 5.5", hint: "versión fija" },
  { value: "claude-haiku-5-5", label: "Claude Haiku 5.5", hint: "versión fija" },
  { value: "claude-fable-5-2", label: "Claude Fable 5.2", hint: "versión fija" },
];

/** Modelos que Copilot CLI suele ofrecer (según la documentación de GitHub); sirve de respaldo si `copilot help` no los lista. */
const COPILOT_MODELS: ModelOption[] = [
  { value: "auto", label: "Auto", hint: "Copilot elige según disponibilidad" },
  { value: "claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
  { value: "claude-haiku-4.5", label: "Claude Haiku 4.5", hint: "rápido" },
  { value: "gpt-5-mini", label: "GPT-5 mini", hint: "incluido en el plan" },
  { value: "gpt-4.1", label: "GPT-4.1", hint: "incluido en el plan" },
  { value: "claude-sonnet-4.6", label: "Claude Sonnet 4.6", hint: "no está en todos los planes" },
  { value: "claude-opus-4.6", label: "Claude Opus 4.6", hint: "el más capaz; no está en todos los planes" },
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
  { value: "gpt-5.2-codex", label: "GPT-5.2 Codex" },
  { value: "gpt-5.2", label: "GPT-5.2" },
  { value: "gemini-3-pro-preview", label: "Gemini 3 Pro (preview)" },
];

/** `copilot help config` describe el ajuste `model` con sus valores entre comillas: de ahí salen los modelos reales de esa versión. */
export function parseCopilotConfigModels(text: string): string[] {
  const m = /(^|\n)[ \t]*[`"']?model[`"']?[ \t]*(:|\n)/i.exec(text);
  if (!m) return [];
  const rest = text.slice(m.index + m[0].length);
  const end = rest.search(/\n[ \t]{0,4}[`"']?[a-z_]+[`"']?[ \t]*:[ \t]*\n|\n[ \t]{0,4}`[a-z_]+`/i);
  const block = end < 0 ? rest.slice(0, 4000) : rest.slice(0, end);
  const out: string[] = [];
  for (const q of block.matchAll(/["'`]([A-Za-z0-9][\w.:/-]*)["'`]/g)) if (!out.includes(q[1]!) && /[-.\d]/.test(q[1]!)) out.push(q[1]!);
  return out;
}

const ID = /^[A-Za-z0-9][\w.:/-]*$/;

/** Los nombres válidos de `--model` los imprime `copilot help` en la descripción de la opción (con comillas o tras «choices:»). */
export function parseCopilotModels(help: string): string[] {
  const i = help.indexOf("--model");
  if (i < 0) return [];
  const rest = help.slice(i);
  const next = rest.slice(7).search(/\n\s+(-\w\b|--[\w-]+)/);
  const block = (next < 0 ? rest : rest.slice(0, next + 7)).replace(/\s+/g, " ");
  const out: string[] = [];
  const add = (x: string): void => {
    if (ID.test(x) && !x.startsWith("--") && !out.includes(x)) out.push(x);
  };
  const choices = /\b(?:choices?|one of|options?|valores?)\s*:\s*([^)]*)\)?/i.exec(block);
  if (choices) for (const part of choices[1]!.split(/[,|]/)) add((part.trim().replace(/^["'`]|["'`]$/g, "").split(/\s+/)[0] ?? "").trim());
  for (const m of block.matchAll(/["'`]([^"'`]+)["'`]/g)) add((m[1]!.trim().split(/\s+/)[0] ?? ""));
  return out;
}

function helpText(path: string, topic?: string): Promise<string> {
  const args = topic ? ["help", topic] : ["help"];
  return new Promise((resolve) => {
    const cb = (_e: Error | null, stdout: string | Buffer): void => resolve(stdout.toString());
    if (needsShell(path)) execFile(quoteForCmd(path), args, { timeout: 20000, shell: true, windowsHide: true }, cb);
    else execFile(path, args, { timeout: 20000, windowsHide: true }, cb);
  });
}

const cache = new Map<string, { at: number; info: ProviderInfo }>();

/** Para cada proveedor: dónde está instalado, su versión y los modelos que se pueden elegir. */
export async function aiInfo(cfg: ReturnType<typeof loadAiConfig>, force = false): Promise<Record<string, ProviderInfo>> {
  const out: Record<string, ProviderInfo> = {};
  await Promise.all(
    Object.entries(cfg.providers).map(async ([name, p]) => {
      const command = p.command ?? p.type;
      const key = `${p.type}|${command}`;
      const hit = cache.get(key);
      if (hit && !force && Date.now() - hit.at < 120000) return void (out[name] = hit.info);
      const found = (await resolveCommand(command)) ?? null;
      const version = found ? await versionOf(found.path) : undefined;
      let models: ModelList = { options: [], source: "builtin", note: "Escribe el nombre del modelo que acepte tu herramienta." };
      if (p.type === "claude") models = { options: CLAUDE_MODELS, source: "builtin", note: "Lista incluida con chip-chop. Si tu Claude Code tiene otro modelo, elige «Otro…» y escribe su nombre." };
      if (p.type === "copilot") {
        const names = found ? [...new Set([...parseCopilotModels(await helpText(found.path)), ...parseCopilotConfigModels(await helpText(found.path, "config"))])] : [];
        if (names.length >= 4) models = { options: names.map((n) => ({ value: n, label: COPILOT_MODELS.find((m) => m.value === n)?.label ?? n, ...(COPILOT_MODELS.find((m) => m.value === n)?.hint ? { hint: COPILOT_MODELS.find((m) => m.value === n)!.hint! } : {}) })), source: "cli", note: "Lista leída de «copilot help». Según tu plan puede que algún modelo no esté habilitado." };
        else {
          const extra = names.filter((n) => !COPILOT_MODELS.some((m) => m.value === n)).map((n) => ({ value: n, label: n }));
          models = { options: [...COPILOT_MODELS, ...extra], source: "builtin", note: found ? "Lista habitual de Copilot CLI (no se pudo leer completa de «copilot help»). Según tu plan puede que algún modelo no esté habilitado; si usas otro, elige «Otro…» y escribe su nombre." : "Lista habitual de Copilot CLI. Instálalo para ver los modelos reales de tu plan." };
        }
      }
      if (p.type === "codex") models = { options: [], source: "builtin", note: "Déjalo en «Predeterminado» para usar el modelo de tu ~/.codex/config.toml, o elige «Otro…» y escribe el nombre exacto que acepte tu Codex (-m)." };
      const info: ProviderInfo = { type: p.type, command, found, ...(version ? { version } : {}), models };
      cache.set(key, { at: Date.now(), info });
      out[name] = info;
    }),
  );
  return out;
}

export interface AiProblem {
  stage: string;
  provider: string;
  model?: string;
  reason: "tool-missing" | "model-unknown";
  message: string;
}

/**
 * Qué impide usar la IA con la configuración actual: una etapa apunta a una herramienta que no se encuentra, o a un modelo
 * que la propia herramienta no lista (solo se puede afirmar cuando la lista salió del CLI; las incluidas pueden quedarse atrás).
 */
export function aiProblems(cfg: ReturnType<typeof loadAiConfig>, info: Record<string, ProviderInfo>, only?: string[]): AiProblem[] {
  const out: AiProblem[] = [];
  for (const [stage, sc] of Object.entries(cfg.stages)) {
    if (!sc || (only && !only.includes(stage))) continue;
    const i = info[sc.provider];
    if (!i || !i.found) {
      out.push({ stage, provider: sc.provider, reason: "tool-missing", message: `«${sc.provider}» no está instalada o no se encuentra` });
    } else if (sc.model && i.models.source === "cli" && i.models.options.length && !i.models.options.some((o) => o.value === sc.model)) {
      out.push({ stage, provider: sc.provider, model: sc.model, reason: "model-unknown", message: `el modelo «${sc.model}» ya no está disponible en ${sc.provider}` });
    }
  }
  return out;
}
