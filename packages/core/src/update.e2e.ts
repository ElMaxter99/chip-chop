import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { packageRoot } from "./paths.js";
import { compareVersions, currentVersion } from "./updater.js";

// Update end to end, hermetic: a local server plays GitHub (releases JSON + bundles), the bundle is a minimal fake with the real
// layout and the REAL scripts/install.sh|install.ps1 (only the chip-chop/ payload is fake), and the real built CLI runs
// `chip-chop update --check` and `chip-chop update` against it with CHIPCHOP_PREFIX in a temp dir.

const win = process.platform === "win32";
const suffix = win ? "windows.zip" : process.platform === "darwin" ? "macos.tar.gz" : "linux.tar.gz";
const cli = join(packageRoot, "dist", "cli.js");
const scripts = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts");

const STABLE = "99.0.0";
const RC = "100.0.0-rc.1";
const DRAFT = "101.0.0";
const OLD = "0.0.1";

let root: string;
let server: Server;
let base: string;
const downloads: string[] = [];

/** Fake bundle `chip-chop-<v>-<os>/{install.*, chip-chop/{package.json,dist/cli.js}}`, packed like make-bundle.sh does. */
function makeBundle(version: string, dir: string, opts: { broken?: boolean; realCore?: boolean } = {}): string {
  const work = mkdtempSync(join(dir, "pack-"));
  const folder = join(work, `chip-chop-${version}-${suffix.split(".")[0]}`);
  mkdirSync(folder, { recursive: true });
  const installer = win ? "install.ps1" : "install.sh";
  cpSync(join(scripts, installer), join(folder, installer));
  if (opts.realCore) {
    // the real built core as payload (no node_modules: the sandbox lives inside the repo, so Node resolves them from there)
    for (const f of ["dist", "assets", "ui", "package.json"].filter((n) => existsSync(join(packageRoot, n)))) cpSync(join(packageRoot, f), join(folder, "chip-chop", f), { recursive: true });
  } else if (!opts.broken) {
    mkdirSync(join(folder, "chip-chop", "dist"), { recursive: true });
    writeFileSync(join(folder, "chip-chop", "package.json"), JSON.stringify({ name: "chip-chop", version, type: "module" }));
    writeFileSync(join(folder, "chip-chop", "dist", "cli.js"), `console.log(${JSON.stringify(version)});\n`);
  }
  const file = join(dir, `chip-chop-${version}-${suffix}`);
  // bsdtar (Windows 10+) packs zip with -a; GNU/BSD tar on Linux/macOS makes the .tar.gz
  execFileSync("tar", win ? ["-a", "-cf", file, "-C", work, readdirSync(work)[0]!] : ["-czf", file, "-C", work, readdirSync(work)[0]!]);
  rmSync(work, { recursive: true, force: true });
  return file;
}

const release = (v: string, o: { prerelease?: boolean; draft?: boolean } = {}) => ({
  tag_name: `v${v}`,
  prerelease: o.prerelease ?? false,
  draft: o.draft ?? false,
  html_url: `${base}/release/v${v}`,
  assets: [{ name: `chip-chop-${v}-${suffix}`, browser_download_url: `${base}/dl/chip-chop-${v}-${suffix}` }],
});

before(async () => {
  root = mkdtempSync(join(tmpdir(), "chip-chop-update-e2e-"));
  for (const v of [STABLE, RC, DRAFT, OLD]) makeBundle(v, root);
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/releases") {
      res.setHeader("content-type", "application/json");
      // like GitHub: newest first, drafts included
      res.end(JSON.stringify([release(DRAFT, { draft: true }), release(RC, { prerelease: true }), release(STABLE), release(OLD)]));
    } else if (url.pathname.startsWith("/dl/") && existsSync(join(root, url.pathname.slice(4)))) {
      downloads.push(url.pathname.slice(4));
      res.end(readFileSync(join(root, url.pathname.slice(4))));
    } else {
      res.statusCode = 404;
      res.end("not found");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(root, { recursive: true, force: true });
});

/** A fresh sandbox: prefix, bin dir and CHIPCHOP_HOME (channel settings) all in a temp dir. */
function sandbox(parent = root) {
  const dir = mkdtempSync(join(parent, "sb-"));
  const prefix = join(dir, "prefix");
  const bin = join(dir, "bin");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CHIPCHOP_RELEASES_URL: `${base}/releases`,
    CHIPCHOP_PREFIX: prefix,
    CHIPCHOP_BIN: bin,
    CHIPCHOP_HOME: join(dir, "home"),
    CHIPCHOP_SKIP_BROWSER: "1",
    CHIPCHOP_SKIP_PATH: "1",
    NO_PROXY: "127.0.0.1",
    no_proxy: "127.0.0.1",
  };
  const launcher = win ? join(prefix, "bin", "chip-chop.cmd") : join(bin, "chip-chop");
  return { dir, prefix, env, launcher };
}

/** Async on purpose: the fake releases server lives in this process, a spawnSync would freeze it. */
interface Out { status: number; stdout: string; stderr: string }
const exec = (cmd: string, args: string[], env: NodeJS.ProcessEnv, shell = false): Promise<Out> =>
  new Promise((resolve) =>
    execFile(cmd, args, { env, encoding: "utf8", timeout: 120000, shell }, (err, stdout, stderr) =>
      resolve({ status: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr: stderr + (err && typeof err.code !== "number" ? String(err) : "") })));
const chipchop = (env: NodeJS.ProcessEnv, ...args: string[]) => exec(process.execPath, [cli, ...args], env);
/** Runs the installed launcher (a .cmd on Windows needs a shell). */
const installedVersion = async (launcher: string, env: NodeJS.ProcessEnv) => {
  const r = win ? await exec(`"${launcher}" --version`, [], env, true) : await exec(launcher, ["--version"], env);
  assert.equal(r.status, 0, `launcher failed: ${r.stdout}${r.stderr}`);
  return r.stdout.trim();
};
/** Installs a fake bundle with the real installer (same path as a first install by hand). */
async function installBundle(file: string, env: NodeJS.ProcessEnv, expectOk = true) {
  const dir = mkdtempSync(join(root, "x-"));
  execFileSync("tar", [win ? "-xf" : "-xzf", file, "-C", dir]);
  const folder = join(dir, readdirSync(dir)[0]!);
  const r = win
    ? await exec("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(folder, "install.ps1")], env)
    : await exec("bash", [join(folder, "install.sh")], env);
  if (expectOk) assert.equal(r.status, 0, `install failed: ${r.stdout}${r.stderr}`);
  return r;
}

test("the running core is older than the fake releases", () => {
  assert.ok(compareVersions(currentVersion(), STABLE) < 0);
});

test("update --check: stable ignores the rc and the draft; latest takes the rc", async () => {
  const sb = sandbox();
  const s = await chipchop(sb.env, "update", "--check", "--channel", "stable");
  assert.equal(s.status, 10, s.stdout + s.stderr); // 10 = update available
  assert.match(s.stdout, new RegExp(`${currentVersion().replace(/\./g, "\\.")} -> ${STABLE.replace(/\./g, "\\.")}\\b`));
  assert.doesNotMatch(s.stdout, /release candidate|rc\.1|101\.0\.0/);
  const l = await chipchop(sb.env, "update", "--check", "--channel", "latest");
  assert.equal(l.status, 10, l.stdout + l.stderr);
  assert.match(l.stdout, new RegExp(`-> ${RC.replace(/\./g, "\\.")} \\(release candidate\\)`));
  // the channel saved in settings is honoured too
  assert.equal((await chipchop(sb.env, "update", "channel", "latest")).status, 0);
  assert.match((await chipchop(sb.env, "update", "--check")).stdout, /100\.0\.0-rc\.1/);
  assert.equal((await chipchop(sb.env, "update", "channel", "stable")).status, 0);
  assert.match((await chipchop(sb.env, "update", "--check")).stdout, /-> 99\.0\.0\n/);
});

test("update --check fails clearly when the releases server is down", async () => {
  const sb = sandbox();
  const r = await chipchop({ ...sb.env, CHIPCHOP_RELEASES_URL: `${base}/nope` }, "update", "--check");
  assert.notEqual(r.status, 0);
  assert.notEqual(r.status, 10);
});

for (const [channel, want, other] of [["stable", STABLE, RC], ["latest", RC, STABLE]] as const) {
  test(`update installs the ${channel} release over an existing install and the launcher prints the new version`, async () => {
    const sb = sandbox();
    await installBundle(join(root, `chip-chop-${OLD}-${suffix}`), sb.env);
    assert.equal(await installedVersion(sb.launcher, sb.env), OLD);
    downloads.length = 0;
    const r = await chipchop(sb.env, "update", "--channel", channel);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, new RegExp(`updated to ${want.replace(/\./g, "\\.")}`));
    assert.deepEqual(downloads, [`chip-chop-${want}-${suffix}`]);
    assert.ok(!downloads.includes(`chip-chop-${other}-${suffix}`));
    assert.equal(await installedVersion(sb.launcher, sb.env), want);
    // nothing left behind next to the prefix, and the temp installer is gone
    assert.deepEqual(readdirSync(sb.dir).filter((n) => n.startsWith("prefix.")), []);
    assert.equal(JSON.parse(readFileSync(join(sb.prefix, "package.json"), "utf8")).version, want);
  });
}

test("self-update: `chip-chop update` run from the installed launcher replaces the installation it is running from", async () => {
  // Inside the repo so the installed core finds its node_modules by walking up; removed afterwards.
  const parent = mkdtempSync(join(packageRoot, ".e2e-update-"));
  try {
    const sb = sandbox(parent);
    const cur = currentVersion();
    await installBundle(makeBundle(cur, root, { realCore: true }), sb.env);
    assert.equal(await installedVersion(sb.launcher, sb.env), cur);
    const r = win ? await exec(`"${sb.launcher}" update --channel stable`, [], sb.env, true) : await exec(sb.launcher, ["update", "--channel", "stable"], sb.env);
    assert.equal(r.status, 0, r.stdout + r.stderr); // also: the old cmd.exe/bash must not choke on its replaced launcher
    assert.match(r.stdout + r.stderr, /updated to 99\.0\.0/);
    assert.equal(await installedVersion(sb.launcher, sb.env), STABLE);
    assert.deepEqual(readdirSync(sb.dir).filter((n) => n.startsWith("prefix.")), []);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("update on a clean prefix installs from scratch", async () => {
  const sb = sandbox();
  const r = await chipchop(sb.env, "update", "--channel", "stable");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(await installedVersion(sb.launcher, sb.env), STABLE);
});

test("a failed install keeps the previous installation working", async () => {
  const sb = sandbox();
  await installBundle(join(root, `chip-chop-${OLD}-${suffix}`), sb.env);
  const broken = makeBundle("0.0.2", root, { broken: true }); // installer without the chip-chop/ payload
  const r = await installBundle(broken, sb.env, false);
  assert.notEqual(r.status, 0);
  assert.equal(await installedVersion(sb.launcher, sb.env), OLD);
  assert.deepEqual(readdirSync(sb.dir).filter((n) => n.startsWith("prefix.")), []);
});

test("re-running the installer cleans up leftovers of an interrupted install", async () => {
  const sb = sandbox();
  await installBundle(join(root, `chip-chop-${OLD}-${suffix}`), sb.env);
  mkdirSync(sb.prefix + ".new", { recursive: true });
  writeFileSync(join(sb.prefix + ".new", "junk"), "x");
  mkdirSync(sb.prefix + ".old", { recursive: true });
  await installBundle(join(root, `chip-chop-${STABLE}-${suffix}`), sb.env);
  assert.equal(await installedVersion(sb.launcher, sb.env), STABLE);
  assert.deepEqual(readdirSync(sb.dir).filter((n) => n.startsWith("prefix.")), []);
});
