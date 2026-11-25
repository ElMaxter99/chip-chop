import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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

export function freePort(): Promise<number> {
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

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    } else {
      process.kill(-child.pid, "SIGTERM");
    }
  } catch {
    /* already gone */
  }
}

async function waitForUrl(url: string, timeoutMs: number, child?: ChildProcess): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let exited: number | null | undefined;
  child?.once("exit", (code) => (exited = code));
  while (Date.now() < deadline) {
    if (exited !== undefined) throw new Error(`server exited early (code ${String(exited)}) before ${url} answered`);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.status < 500) return;
    } catch {
      /* not up yet */
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

  const gitRoot = git(hostAppDir, ["rev-parse", "--show-toplevel"]);
  const rel = relative(gitRoot, hostAppDir);
  const commit = git(hostAppDir, ["rev-parse", "--short", ref]);
  const worktree = mkdtempSync(join(tmpdir(), "chip-chop-wt-"));
  log(`checking out ${ref} (${commit})`);
  git(gitRoot, ["worktree", "add", "--detach", "--force", worktree, ref]);
  const appDir = join(worktree, rel);

  let server: ChildProcess | undefined;
  const cleanup = async (): Promise<void> => {
    if (server) killTree(server);
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
      await runShell(withNode(config.build.install, config.build.nodeVersion, log), buildCwd, log);
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
