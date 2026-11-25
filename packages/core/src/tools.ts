import { execFile } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, extname } from "node:path";

const win = process.platform === "win32";

/** Windows: los ejecutables que Windows sabe lanzar, en el orden de PATHEXT (.exe antes que los .cmd de npm). */
function exts(): string[] {
  if (!win) return [""];
  const e = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").map((x) => x.toLowerCase()).filter((x) => x && x !== ".ps1" && x !== ".vbs" && x !== ".js");
  return [".exe", ...e.filter((x) => x !== ".exe")];
}

function expand(s: string): string {
  return s.replace(/%([^%]+)%/g, (m, k: string) => process.env[k] ?? m);
}

function run(cmd: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve) => execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => resolve(err ? "" : stdout.toString())));
}

/** Windows: el PATH «de verdad» (usuario + sistema) del registro. Una app abierta antes de instalar la herramienta no lo ve en su entorno. */
async function registryPath(): Promise<string[]> {
  if (!win) return [];
  const out: string[] = [];
  for (const key of ["HKCU\\Environment", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"]) {
    const txt = await run("reg", ["query", key, "/v", "Path"], 4000);
    const m = /Path\s+REG_(?:EXPAND_)?SZ\s+(.+)/i.exec(txt);
    if (m) out.push(...expand(m[1]!.trim()).split(";").filter(Boolean));
  }
  return out;
}

/** Sitios donde los instaladores habituales dejan estas herramientas aunque no estén en el PATH de la app. */
export function extraDirs(): string[] {
  const h = homedir();
  const env = process.env;
  const dirs = [join(h, ".local", "bin"), join(h, ".claude", "local"), join(h, ".bun", "bin"), join(h, ".volta", "bin"), join(h, ".npm-global", "bin"), join(h, ".cargo", "bin")];
  if (win) {
    const app = env.APPDATA ?? join(h, "AppData", "Roaming");
    const local = env.LOCALAPPDATA ?? join(h, "AppData", "Local");
    dirs.push(join(app, "npm"), join(local, "Microsoft", "WinGet", "Links"), join(local, "Programs", "claude"), join(local, "Programs", "Claude Code"), join(h, "scoop", "shims"), join(env.ProgramFiles ?? "C:\\Program Files", "nodejs"), join(env.ProgramFiles ?? "C:\\Program Files", "GitHub Copilot CLI"), join(env.ProgramFiles ?? "C:\\Program Files", "GitHub CLI"));
  } else {
    dirs.push("/usr/local/bin", "/opt/homebrew/bin", "/opt/homebrew/sbin", "/home/linuxbrew/.linuxbrew/bin", "/snap/bin", "/usr/bin");
    // nvm/fnm: una carpeta por versión de Node
    for (const root of [join(h, ".nvm", "versions", "node"), join(h, ".local", "share", "fnm", "node-versions")]) {
      try {
        for (const v of readdirSync(root).sort().reverse()) dirs.push(join(root, v, "bin"), join(root, v, "installation", "bin"));
      } catch {
        /* sin nvm/fnm */
      }
    }
  }
  return dirs;
}

function fileIn(dir: string, name: string): string | undefined {
  for (const e of exts()) {
    const f = join(dir, name + (name.toLowerCase().endsWith(e) ? "" : e));
    try {
      if (existsSync(f) && statSync(f).isFile()) return f;
    } catch {
      /* ilegible */
    }
  }
  return undefined;
}

/** macOS/Linux: si la app se abrió desde el escritorio, el PATH es mínimo; el shell de login conoce el de verdad. */
async function loginShellLookup(name: string): Promise<string | undefined> {
  if (win || !/^[A-Za-z0-9._+-]+$/.test(name)) return undefined;
  const sh = process.env.SHELL || "/bin/sh";
  const out = await run(sh, ["-ilc", `command -v ${name}`], 6000);
  const line = out.split("\n").map((l) => l.trim()).reverse().find((l) => l.startsWith("/"));
  return line && existsSync(line) ? line : undefined;
}

export interface Found {
  path: string;
  /** de dónde salió: PATH del proceso, PATH del sistema (registro), una carpeta habitual o el shell de login */
  via: "path" | "system" | "known" | "shell" | "explicit";
}

/**
 * Localiza un ejecutable. Mira, por este orden: una ruta explícita, el PATH del proceso, el PATH del sistema (en Windows,
 * el del registro), las carpetas donde instalan Claude Code / Copilot / npm / winget… y, en macOS y Linux, el shell de login.
 */
export async function resolveCommand(command: string): Promise<Found | undefined> {
  if (isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    const f = existsSync(command) ? command : exts().map((e) => command + e).find((x) => existsSync(x));
    return f ? { path: f, via: "explicit" } : undefined;
  }
  for (const d of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const f = fileIn(d, command);
    if (f) return { path: f, via: "path" };
  }
  for (const d of await registryPath()) {
    const f = fileIn(d, command);
    if (f) return { path: f, via: "system" };
  }
  for (const d of extraDirs()) {
    const f = fileIn(d, command);
    if (f) return { path: f, via: "known" };
  }
  const s = await loginShellLookup(command);
  return s ? { path: s, via: "shell" } : undefined;
}

/** `true` si en Windows hay que lanzarlo con shell (los .cmd/.bat de npm no se pueden ejecutar directamente). */
export const needsShell = (path: string): boolean => win && [".cmd", ".bat"].includes(extname(path).toLowerCase());

/** Comillas para cmd.exe al lanzar un .cmd/.bat con shell. */
export const quoteForCmd = (s: string): string => (/^[\w./:\\=+,@-]+$/.test(s) ? s : `"${s.replace(/"/g, '""').replace(/%/g, "%%")}"`);

/** Ejecuta `path --version` (con shell si es un .cmd) y devuelve la primera línea. */
export function versionOf(path: string, args: string[] = ["--version"]): Promise<string | undefined> {
  return new Promise((resolve) => {
    const cb = (err: Error | null, stdout: string | Buffer): void => resolve(err ? undefined : stdout.toString().trim().split("\n")[0]);
    if (needsShell(path)) execFile(quoteForCmd(path), args.map(quoteForCmd), { timeout: 20000, shell: true, windowsHide: true }, cb);
    else execFile(path, args, { timeout: 20000, windowsHide: true }, cb);
  });
}
