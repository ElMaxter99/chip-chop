import { spawn } from "node:child_process";
import { needsShell, quoteForCmd, resolveCommand } from "./tools.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { exists, readStructured } from "./fsutil.js";
import { chipDir } from "./paths.js";
import type { AiSettings, ProviderConfig, StageConfig, StageName } from "./types.js";
import { formatIssues, validateAgainst, validateCatalogDir } from "./validate.js";
import { readFileSync } from "node:fs";

export const STAGES: StageName[] = ["discover", "flows", "mocks", "repair"];

export const DEFAULT_AI: Required<Pick<AiSettings, "providers" | "stages">> & { settings: { maxRepairs: number; promptsDir?: string } } = {
  providers: {
    claude: { type: "claude", command: "claude", timeoutMs: 900000 },
    copilot: { type: "copilot", command: "copilot", timeoutMs: 900000 },
    codex: { type: "codex", command: "codex", timeoutMs: 900000 },
  },
  stages: {
    discover: { provider: "claude", model: "sonnet" },
    flows: { provider: "claude", model: "haiku" },
    mocks: { provider: "claude", model: "sonnet" },
    repair: { provider: "claude", model: "sonnet" },
  },
  settings: { maxRepairs: 3 },
};

export function globalAiPath(): string {
  return join(process.env.CHIPCHOP_HOME ?? join(homedir(), ".chipchop"), "ai.yaml");
}

function read(path: string): AiSettings {
  if (!exists(path)) return {};
  return (readStructured<AiSettings>(path) ?? {}) as AiSettings;
}

/** defaults < ~/.chipchop/ai.yaml < <app>/.chipchop/ai.yaml. Stages and providers merge per key. */
export function loadAiConfig(appDir: string): { providers: Record<string, ProviderConfig>; stages: Partial<Record<StageName, StageConfig>>; settings: { maxRepairs: number; promptsDir?: string } } {
  const layers = [read(globalAiPath()), read(join(chipDir(appDir), "ai.yaml"))];
  const providers: Record<string, ProviderConfig> = { ...DEFAULT_AI.providers };
  const stages: Partial<Record<StageName, StageConfig>> = { ...DEFAULT_AI.stages };
  const settings = { ...DEFAULT_AI.settings } as { maxRepairs: number; promptsDir?: string };
  for (const l of layers) {
    for (const [k, v] of Object.entries(l.providers ?? {})) providers[k] = { ...(providers[k] ?? {}), ...v };
    for (const [k, v] of Object.entries(l.stages ?? {})) stages[k as StageName] = { ...(stages[k as StageName] ?? { provider: "claude" }), ...v } as StageConfig;
    Object.assign(settings, l.settings ?? {});
  }
  const problems = validateAgainst("ai", { providers, stages, settings });
  if (problems.length) throw new Error(`invalid AI configuration: ${problems.join("; ")}`);
  return { providers, stages, settings };
}

export interface Invocation {
  command: string;
  args: string[];
  stdin?: string;
  env: Record<string, string>;
  timeoutMs: number;
}

/** Turns provider + stage settings into a concrete process to spawn. Pure, so it is unit-testable. */
export function buildInvocation(p: ProviderConfig, stage: StageConfig, prompt: string): Invocation {
  const model = stage.model;
  const extra = [...(p.extraArgs ?? []), ...(stage.extraArgs ?? [])];
  const env = p.env ?? {};
  const timeoutMs = p.timeoutMs ?? 900000;
  if (p.type === "claude") {
    const args = ["-p", ...(model ? ["--model", model] : []), "--output-format", "text", "--permission-mode", p.permissionMode ?? "acceptEdits", "--allowedTools", (p.allowedTools ?? ["Read", "Glob", "Grep", "Write", "Edit"]).join(","), ...extra];
    return { command: p.command ?? "claude", args, stdin: prompt, env, timeoutMs };
  }
  if (p.type === "copilot") {
    const args = ["-p", prompt, ...(model ? ["--model", model] : []), ...(p.allowTools ?? ["write"]).map((t) => `--allow-tool=${t}`), ...(p.denyTools ?? ["shell"]).map((t) => `--deny-tool=${t}`), "-s", ...extra];
    return { command: p.command ?? "copilot", args, env, timeoutMs };
  }
  if (p.type === "codex") {
    // `codex exec` es el modo no interactivo; el prompt entra por stdin ("-"). Necesita poder escribir .chipchop/, pero nada más.
    const args = ["exec", "--sandbox", p.sandbox ?? "workspace-write", "--skip-git-repo-check", "--color", "never", ...(model ? ["--model", model] : []), ...extra, "-"];
    return { command: p.command ?? "codex", args, stdin: prompt, env, timeoutMs };
  }
  if (!p.command) throw new Error("custom provider needs a `command`");
  const sub = (s: string): string => s.replaceAll("{prompt}", prompt).replaceAll("{model}", model ?? "");
  const viaStdin = p.promptVia === "stdin";
  const args = (p.args ?? []).map(sub).filter((a, i, all) => !(a === "" && all[i - 1]?.startsWith("--"))).concat(extra);
  return { command: p.command, args, ...(viaStdin ? { stdin: prompt } : {}), env, timeoutMs };
}

export async function execInvocation(inv: Invocation, cwd: string, log: (l: string) => void): Promise<{ code: number; stdout: string; stderr: string }> {
  // Localiza el ejecutable aunque no esté en el PATH de esta app (instalador nativo de Claude Code, npm, winget…).
  const found = await resolveCommand(inv.command);
  const exe = found?.path ?? inv.command;
  const shell = needsShell(exe);
  return new Promise((resolve, reject) => {
    const child = shell
      ? spawn(quoteForCmd(exe), inv.args.map(quoteForCmd), { cwd, env: { ...process.env, ...inv.env }, stdio: ["pipe", "pipe", "pipe"], shell: true, windowsHide: true })
      : spawn(exe, inv.args, { cwd, env: { ...process.env, ...inv.env }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${inv.command} timed out after ${Math.round(inv.timeoutMs / 1000)}s`));
    }, inv.timeoutMs);
    child.stdout.on("data", (d: Buffer) => {
      const s = d.toString();
      out += s;
      for (const line of s.split("\n")) if (line.trim()) log(`  ai: ${line}`);
    });
    child.stderr.on("data", (d: Buffer) => {
      err = (err + d.toString()).slice(-4000);
      log(`  ai! ${d.toString().trimEnd()}`);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`could not start "${inv.command}": ${e.message}. Is it installed? chip-chop also looks in the usual install folders; you can set the full path in "command:" of ai.yaml.`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: out, stderr: err });
    });
    if (inv.stdin !== undefined) child.stdin.end(inv.stdin);
    else child.stdin.end();
  });
}

const DEFAULT_PROMPTS: Record<StageName, string> = {
  discover: `Read .chipchop/ai/SKILL.md and the guide for this app's framework in .chipchop/ai/guides/.
Then read the source code and write .chipchop/config.yaml (fix build/serve/node settings) and .chipchop/states.yaml
with every capturable state (pages, modals, drawers, tabs). Keep existing state ids. Do not run shell commands.
{{extra}}`,
  flows: `Read .chipchop/ai/guides/states-and-flows.md and .chipchop/states.yaml.
Write one .chipchop/flows/<id>.flow.yaml per user journey, using only state ids that exist. {{extra}}`,
  mocks: `Read .chipchop/ai/guides/mocks.md, .chipchop/states.yaml and .chipchop/flows/.
Read the source code that performs network calls and write typed .chipchop/mocks/**/<id>.mock.json files,
each with a responseSchema inferred from the code and a matching response. Include login. {{extra}}`,
  repair: `chip-chop validate reported these problems in .chipchop/. Fix the files, not the schemas. Problems:
{{problems}}
{{extra}}`,
};

export function promptFor(stage: StageName, appDir: string, vars: { extra?: string; problems?: string }, promptsDir?: string): string {
  let t = DEFAULT_PROMPTS[stage];
  if (promptsDir) {
    const dir = promptsDir.startsWith("/") ? promptsDir : join(appDir, promptsDir);
    const f = join(dir, `${stage}.md`);
    if (exists(f)) t = readFileSync(f, "utf8");
  }
  return t.replaceAll("{{extra}}", vars.extra ?? "").replaceAll("{{problems}}", vars.problems ?? "");
}

export interface AiRunOptions {
  appDir: string;
  stages?: StageName[];
  extra?: string;
  log?: (l: string) => void;
  dryRun?: boolean;
}

/** discover -> flows -> mocks, then validate and repair until clean or out of attempts. */
export async function runAi(opts: AiRunOptions): Promise<{ ok: boolean; issues: string }> {
  const log = opts.log ?? (() => {});
  const cfg = loadAiConfig(opts.appDir);
  const stages = opts.stages ?? (["discover", "flows", "mocks"] as StageName[]);
  const run = async (stage: StageName, vars: { extra?: string; problems?: string }): Promise<void> => {
    const sc = cfg.stages[stage];
    if (!sc) throw new Error(`no configuration for stage "${stage}"`);
    const provider = cfg.providers[sc.provider];
    if (!provider) throw new Error(`stage "${stage}" uses unknown provider "${sc.provider}"`);
    const inv = buildInvocation(provider, sc, promptFor(stage, opts.appDir, vars, cfg.settings.promptsDir));
    log(`== ${stage}: ${sc.provider}${sc.model ? ` / ${sc.model}` : ""}`);
    if (opts.dryRun) {
      log(`  would run: ${inv.command} ${inv.args.map((a) => (a.length > 60 ? `${a.slice(0, 57)}...` : a)).join(" ")}`);
      return;
    }
    const r = await execInvocation(inv, opts.appDir, log);
    if (r.code !== 0) throw new Error(`${stage} stage failed (exit ${r.code})`);
  };
  for (const s of stages) await run(s, { extra: opts.extra });
  if (opts.dryRun) return { ok: true, issues: "" };
  for (let i = 0; i <= cfg.settings.maxRepairs; i++) {
    const issues = validateCatalogDir(opts.appDir);
    const errors = issues.filter((x) => x.severity === "error");
    if (errors.length === 0) return { ok: true, issues: "" };
    const text = formatIssues(errors);
    if (i === cfg.settings.maxRepairs) return { ok: false, issues: text };
    log(`validation found ${errors.length} problem(s); repair attempt ${i + 1}/${cfg.settings.maxRepairs}`);
    await run("repair", { problems: text, extra: opts.extra });
  }
  return { ok: false, issues: "" };
}

/** Small round-trip to confirm a provider answers with the configured model. */
export interface TestResult {
  ok: boolean;
  output: string;
  /** la herramienta responde bien sin indicar modelo: lo que falla es el modelo elegido */
  modelRejected?: boolean;
  /** lo que el programa escribió por stderr (el motivo real cuando falla) */
  stderr: string;
  /** qué se ejecutó, para enseñarlo al usuario */
  command: string;
  args: string[];
  prompt: string;
  model: string;
  foundAt: string | null;
  ms: number;
  exitCode: number | null;
}

export async function testProvider(appDir: string, providerName: string, model?: string): Promise<TestResult> {
  const cfg = loadAiConfig(appDir);
  const p = cfg.providers[providerName];
  if (!p) throw new Error(`unknown provider "${providerName}"`);
  const prompt = "Reply with exactly: chip-chop-ok";
  const inv = buildInvocation({ ...p, allowedTools: [], allowTools: [], denyTools: ["shell", "write"] }, { provider: providerName, ...(model ? { model } : {}) }, prompt);
  const found = await resolveCommand(inv.command);
  const base = { command: inv.command, args: inv.args.map((a) => (a === prompt ? "<prompt>" : a)), prompt, model: model ?? "", foundAt: found?.path ?? null };
  const t0 = Date.now();
  try {
    const r = await execInvocation(inv, appDir, () => {});
    const good = r.code === 0 && r.stdout.includes("chip-chop-ok");
    if (!good && model) {
      // ¿falla la herramienta (sesión, red…) o solo ese modelo? Se prueba otra vez con el modelo por defecto.
      const inv2 = buildInvocation({ ...p, allowedTools: [], allowTools: [], denyTools: ["shell", "write"] }, { provider: providerName }, prompt);
      const r2 = await execInvocation(inv2, appDir, () => {}).catch(() => null);
      if (r2 && r2.code === 0 && r2.stdout.includes("chip-chop-ok")) return { ...base, ok: false, modelRejected: true, output: r.stdout.trim().slice(0, 800), stderr: r.stderr.trim().slice(-1200), ms: Date.now() - t0, exitCode: r.code };
    }
    return { ...base, ok: good, output: r.stdout.trim().slice(0, 800), stderr: r.stderr.trim().slice(-1200), ms: Date.now() - t0, exitCode: r.code };
  } catch (e) {
    return { ...base, ok: false, output: (e as Error).message, stderr: "", ms: Date.now() - t0, exitCode: null };
  }
}
