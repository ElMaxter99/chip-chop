import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { loadAiConfig } from "./ai.js";
import { resolveCommand, versionOf } from "./tools.js";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  required: boolean;
}

function version(cmd: string, args: string[] = ["--version"]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15000 }, (err, stdout) => resolve(err ? undefined : stdout.toString().trim().split("\n")[0]));
  });
}

export async function doctor(appDir: string): Promise<Check[]> {
  const checks: Check[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "node", ok: major >= 22, detail: `v${process.versions.node} (needs >= 22)`, required: true });
  const git = await version("git");
  checks.push({ name: "git", ok: !!git, detail: git ?? "not found on PATH", required: true });

  let chromium = "";
  try {
    const { chromium: c } = await import("playwright");
    const p = c.executablePath();
    chromium = existsSync(p) ? p : "";
  } catch {
    /* playwright missing */
  }
  checks.push({ name: "chromium", ok: !!chromium, detail: chromium || "not installed. Run: npx playwright install chromium", required: true });

  const cfg = loadAiConfig(appDir);
  const seen = new Set<string>();
  for (const [name, p] of Object.entries(cfg.providers)) {
    if (p.type === "custom" && !p.command) continue;
    const cmd = p.command ?? p.type;
    if (seen.has(cmd)) continue;
    seen.add(cmd);
    const found = await resolveCommand(cmd);
    const v = found ? await versionOf(found.path) : undefined;
    const where = found ? ` (${found.path}${found.via === "path" ? "" : found.via === "system" ? " · system PATH" : found.via === "shell" ? " · login shell" : ""})` : "";
    checks.push({ name: `ai: ${name} (${cmd})`, ok: !!v, detail: v ? `${v}${where}` : found ? `found at ${found.path} but it did not answer --version` : "not found on PATH (only needed if a stage uses it)", required: false });
  }
  return checks;
}
