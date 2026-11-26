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
  /**
   * De dónde sale la lista. Nunca va incluida en chip-chop: una lista fija se queda atrás y provoca errores.
   * `cli`: leída del propio CLI · `api`: pedida a la API del proveedor · `partial`: solo lo que la CLI documenta (p. ej. alias),
   * puede haber más · `none`: no se pudo obtener (solo «Predeterminado» y «Otro…»).
   */
  source: "cli" | "api" | "partial" | "none";
  note?: string;
}
export interface ProviderInfo {
  type: string;
  command: string;
  found: Found | null;
  version?: string;
  models: ModelList;
}



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

/** Alias de `--model` en `claude --help` (p. ej. 'sonnet' o 'opus'); los ejemplos con versión se descartan porque envejecen. */
export function parseModelAliases(help: string): string[] {
  const i = help.indexOf("--model");
  if (i < 0) return [];
  const rest = help.slice(i);
  const next = rest.slice(7).search(/\n\s+(-\w\b|--[\w-]+)/);
  const block = (next < 0 ? rest : rest.slice(0, next + 7)).replace(/\s+/g, " ");
  const out: string[] = [];
  for (const m of block.matchAll(/["'`]([a-z]+)["'`]/g)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}

/** Modelos de la cuenta, tal como los devuelve la API de Anthropic. */
async function anthropicModels(key: string): Promise<ModelOption[]> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=100", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const j = (await res.json()) as { data?: { id: string; display_name?: string }[] };
    return (j.data ?? []).map((m) => ({ value: m.id, label: m.display_name ?? m.id }));
  } catch {
    return [];
  }
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
      let models: ModelList = { options: [], source: "none", note: "No se pudo leer la lista de modelos. Déjalo en «Predeterminado» o elige «Otro…» y escribe el nombre exacto que acepte tu herramienta." };
      if (!found) models = { options: [], source: "none", note: `No se encuentra «${command}»: instálala para ver sus modelos.` };
      else if (p.type === "claude") {
        // Claude Code no tiene un comando que liste modelos: sus alias salen de `claude --help` y, si hay clave de API, la lista completa de /v1/models.
        const aliases = parseModelAliases(await helpText(found.path));
        const key = p.env?.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
        const api = key ? await anthropicModels(key) : [];
        if (api.length) models = { options: [...aliases.map((a) => ({ value: a, label: a, hint: "alias: siempre el último" })), ...api], source: "api", note: "Lista pedida a la API de Anthropic con tu clave." };
        else if (aliases.length) models = { options: aliases.map((a) => ({ value: a, label: a, hint: "alias: siempre el último" })), source: "partial", note: "Solo los alias que documenta Claude Code. Para un modelo concreto, elige «Otro…» y escribe su nombre, o define ANTHROPIC_API_KEY para ver la lista completa." };
      } else if (p.type === "copilot") {
        const names = [...new Set([...parseCopilotModels(await helpText(found.path)), ...parseCopilotConfigModels(await helpText(found.path, "config"))])];
        if (names.length) models = { options: names.map((n) => ({ value: n, label: n })), source: "cli", note: "Lista leída de tu Copilot CLI. Según tu plan puede que algún modelo no esté habilitado." };
        else models = { options: [], source: "none", note: "Tu Copilot CLI no publica la lista de modelos. Déjalo en «Predeterminado» o elige «Otro…» y escribe el nombre exacto (puedes verlo con /model dentro de copilot)." };
      } else if (p.type === "codex") {
        models = { options: [], source: "none", note: "Codex no publica su lista de modelos. Déjalo en «Predeterminado» (usa tu ~/.codex/config.toml) o elige «Otro…» y escribe el nombre exacto (-m)." };
      }
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
 * que la propia herramienta no lista (solo se puede afirmar cuando la lista es completa: salió del CLI o de la API).
 */
export function aiProblems(cfg: ReturnType<typeof loadAiConfig>, info: Record<string, ProviderInfo>, only?: string[]): AiProblem[] {
  const out: AiProblem[] = [];
  for (const [stage, sc] of Object.entries(cfg.stages)) {
    if (!sc || (only && !only.includes(stage))) continue;
    const i = info[sc.provider];
    if (!i || !i.found) {
      out.push({ stage, provider: sc.provider, reason: "tool-missing", message: `«${sc.provider}» no está instalada o no se encuentra` });
    } else if (sc.model && (i.models.source === "cli" || i.models.source === "api") && i.models.options.length && !i.models.options.some((o) => o.value === sc.model)) {
      out.push({ stage, provider: sc.provider, model: sc.model, reason: "model-unknown", message: `el modelo «${sc.model}» ya no está disponible en ${sc.provider}` });
    }
  }
  return out;
}
