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

/** Los nombres válidos de `--model` los imprime `copilot help` en la descripción de la opción. */
export function parseCopilotModels(help: string): string[] {
  const i = help.indexOf("--model");
  if (i < 0) return [];
  const rest = help.slice(i);
  const next = rest.slice(7).search(/\n\s+(-\w|--[\w-]+)/);
  const block = next < 0 ? rest : rest.slice(0, next + 7);
  const out: string[] = [];
  for (const m of block.matchAll(/["'`]([A-Za-z0-9][\w.:/-]*)["'`]/g)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out.filter((x) => !x.startsWith("--"));
}

function helpText(path: string): Promise<string> {
  return new Promise((resolve) => {
    const cb = (_e: Error | null, stdout: string | Buffer): void => resolve(stdout.toString());
    if (needsShell(path)) execFile(quoteForCmd(path), ["help"], { timeout: 20000, shell: true, windowsHide: true }, cb);
    else execFile(path, ["help"], { timeout: 20000, windowsHide: true }, cb);
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
        const names = found ? parseCopilotModels(await helpText(found.path)) : [];
        models = names.length
          ? { options: names.map((n) => ({ value: n, label: n })), source: "cli", note: "Lista leída de «copilot help». Según tu plan puede que algún modelo no esté habilitado." }
          : { options: [], source: "builtin", note: found ? "No se pudo leer la lista de «copilot help». Escribe el modelo (los válidos salen con ese comando o con /model)." : "Instala Copilot CLI para ver sus modelos. Mientras, escribe el nombre." };
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
