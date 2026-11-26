import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { hasCatalog, loadCatalog, resolveConfig, type Catalog, type ResolvedConfig } from "./catalog.js";
import type { Config } from "./types.js";
import { readStructured } from "./fsutil.js";
import { findFirst } from "./catalog.js";
import { chipDir } from "./paths.js";

export interface Target {
  label: string;
  ref?: string;
  url?: string;
}

export interface PrepareOptions {
  hostAppDir: string;
  target: Target;
  catalog: "auto" | "cwd" | "ref";
  install: boolean;
  keepWorktree: boolean;
  log: (line: string) => void;
}

export interface PreparedTarget {
  label: string;
  ref?: string;
  commit?: string;
  baseUrl: string;
  catalogSource: "cwd" | "ref";
  catalog: Catalog;
  cleanup(): Promise<void>;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function listRefs(appDir: string): { branches: string[]; tags: string[]; current?: string } {
  const lines = (a: string[]): string[] => {
    try {
      return git(appDir, a).split("\n").map((s) => s.trim()).filter(Boolean);
    } catch {
      return [];
    }
  };
  let current: string | undefined;
  try {
    current = git(appDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  } catch {
    current = undefined;
  }
  return {
    branches: lines(["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"]).filter((b) => !b.endsWith("/HEAD")),
    tags: lines(["tag", "--list"]),
    ...(current ? { current } : {}),
  };
}

const usedPorts = new Set<number>();

/** A free port that this process has not handed out before (a just-killed server may still hold the old one). */
export async function freePort(): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const p = await probePort();
    if (!usedPorts.has(p)) {
      usedPorts.add(p);
      return p;
    }
  }
  throw new Error("could not find an unused port");
}

function probePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Wraps a command so it runs under another Node version through nvm (POSIX only). */
function withNode(command: string, nodeVersion: string | undefined, log: (l: string) => void): string {
  if (!nodeVersion) return command;
  const major = process.version.replace(/^v/, "").split(".")[0];
  if (major === nodeVersion.split(".")[0]) return command;
  if (process.platform === "win32") {
    log(`warning: build.nodeVersion=${nodeVersion} is ignored on Windows; run chip-chop under that Node version instead`);
    return command;
  }
  const script = `. "\${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null 2>&1 && nvm use ${nodeVersion} >/dev/null && ${command}`;
  return `bash -c ${shq(script)}`;
}

export function runShell(command: string, cwd: string, log: (l: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    log(`$ ${command}`);
    const child = spawn(command, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    const pipe = (chunk: Buffer): void => {
      for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) log(`  ${line}`);
    };
    child.stdout.on("data", pipe);
    child.stderr.on("data", pipe);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`command failed (${code}): ${command}`))));
  });
}

function killTree(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.pid === undefined) return resolve();
    try {
      if (process.platform === "win32") {
        const k = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        k.on("close", () => resolve());
        k.on("error", () => resolve());
      } else {
        process.kill(-child.pid, "SIGTERM");
        resolve();
      }
    } catch {
      resolve(); // already gone
    }
  });
}

async function waitForUrl(url: string, timeoutMs: number, child?: ChildProcess): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let exited: number | null | undefined;
  child?.once("exit", (code) => (exited = code));
  while (Date.now() < deadline) {
    if (exited !== undefined) throw new Error(`server exited early (code ${String(exited)}) before ${url} answered`);
    // On Windows "localhost" can resolve to ::1 while the dev server listens on IPv4 only (or the reverse).
    for (const candidate of new Set([url, url.replace("//localhost", "//127.0.0.1")])) {
      try {
        const res = await fetch(candidate, { signal: AbortSignal.timeout(3000) });
        if (res.status < 500) return;
      } catch {
        /* not up yet */
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`timed out after ${timeoutMs} ms waiting for ${url}`);
}

function readConfigOnly(appDir: string): ResolvedConfig | undefined {
  const f = findFirst(chipDir(appDir), "config");
  return f ? resolveConfig(readStructured<Config>(f)) : undefined;
}

export async function prepareTarget(opts: PrepareOptions): Promise<PreparedTarget> {
  const { hostAppDir, target, log } = opts;

  // An app that is already running: nothing to build or serve.
  if (target.url) {
    return {
      label: target.label,
      baseUrl: target.url.replace(/\/+$/, ""),
      catalogSource: "cwd",
      catalog: loadCatalog(hostAppDir),
      cleanup: async () => {},
    };
  }

  const ref = target.ref;
  if (!ref) throw new Error(`target "${target.label}" needs a ref or a url`);

  // Windows may mix 8.3 short names (RUNNER~1) and long names; resolve both sides to the same form.
  const gitRoot = realpathSync.native(git(hostAppDir, ["rev-parse", "--show-toplevel"]));
  const rel = relative(gitRoot, realpathSync.native(hostAppDir));
  const revision = git(hostAppDir, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]);
  const commit = git(hostAppDir, ["rev-parse", "--short", revision]);
  const worktree = mkdtempSync(join(tmpdir(), "chip-chop-wt-"));
  log(`checking out ${ref} (${commit})`);
  git(gitRoot, ["worktree", "add", "--detach", "--force", worktree, revision]);
  const appDir = join(worktree, rel);

  let server: ChildProcess | undefined;
  const cleanup = async (): Promise<void> => {
    if (server) await killTree(server);
    if (!opts.keepWorktree) {
      try {
        git(gitRoot, ["worktree", "remove", "--force", worktree]);
      } catch {
        rmSync(worktree, { recursive: true, force: true });
      }
    } else {
      log(`worktree kept at ${worktree}`);
    }
  };

  try {
    const useRef = opts.catalog === "ref" || (opts.catalog === "auto" && hasCatalog(appDir));
    const catalogSource: "cwd" | "ref" = useRef ? "ref" : "cwd";
    const catalog = useRef ? loadCatalog(appDir) : loadCatalog(hostAppDir);
    const config = catalog.config;
    log(`catalog taken from ${catalogSource === "ref" ? "the ref" : "the working directory"}`);

    const buildCwd = join(appDir, config.build?.cwd ?? ".");
    if (opts.install && config.build?.install) {
      const inst = config.build.install;
      try {
        await runShell(withNode(inst, config.build.nodeVersion, log), buildCwd, log);
      } catch (e) {
        // `npm ci` exige un package-lock.json al día con package.json; si la rama no lo cumple, `npm install` sí funciona.
        if (!/\bnpm\s+ci\b/.test(inst)) throw e;
        log("npm ci ha fallado (suele ser un package-lock.json ausente o desincronizado en esta rama); reintento con npm install");
        await runShell(withNode(inst.replace(/\bnpm\s+ci\b/, "npm install"), config.build.nodeVersion, log), buildCwd, log);
      }
    }
    if (config.build?.command) {
      await runShell(withNode(config.build.command, config.build.nodeVersion, log), buildCwd, log);
    }

    const port = await freePort();
    const serveCmd = config.serve.command.replace(/\{port\}/g, String(port));
    const baseUrl = config.serve.url.replace(/\{port\}/g, String(port)).replace(/\/+$/, "");
    log(`serving: ${serveCmd}`);
    server = spawn(serveCmd, {
      cwd: appDir,
      shell: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PORT: String(port) },
    });
    server.stdout?.on("data", () => {});
    server.stderr?.on("data", () => {});
    await waitForUrl(baseUrl + (config.serve.readyPath ?? "/"), config.serve.timeoutMs ?? 120000, server);
    log(`ready at ${baseUrl}`);

    return { label: target.label, ref, commit, baseUrl, catalogSource, catalog, cleanup };
  } catch (e) {
    await cleanup();
    throw e;
  }
}

export { readConfigOnly };
