import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { packageRoot } from "./paths.js";

export const REPO = "ElMaxter99/chip-chop";
/** stable = «Solo estables»; latest = «Últimas» (la más reciente, sea candidata -rc.N o final). */
export type Channel = "stable" | "latest";
export const normalizeChannel = (v: unknown): Channel => (v === "latest" || v === "all" || v === "beta" ? "latest" : "stable");

export interface Release {
  tag_name: string;
  prerelease: boolean;
  draft: boolean;
  html_url: string;
  published_at?: string;
  assets: { name: string; browser_download_url: string }[];
}

interface Semver {
  major: number;
  minor: number;
  patch: number;
  pre: (string | number)[];
}

export function parseSemver(v: string): Semver | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(v.trim());
  if (!m) return undefined;
  const pre = m[4] ? m[4].split(".").map((x) => (/^\d+$/.test(x) ? Number(x) : x)) : [];
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre };
}

/** SemVer 2.0 precedence: 1.0.0-rc.1 < 1.0.0-rc.2 < 1.0.0. Returns <0, 0, >0. */
export function compareVersions(a: string, b: string): number {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) throw new Error(`not a semantic version: ${!x ? a : b}`);
  for (const k of ["major", "minor", "patch"] as const) if (x[k] !== y[k]) return x[k] - y[k];
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (typeof p === "number" && typeof q === "number") return p - q;
    if (typeof p === "number") return -1;
    if (typeof q === "number") return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

/**
 * stable: solo versiones finales. latest: además las candidatas «X.Y.Z-rc.N»; entre todas gana la mayor, y la final
 * de X.Y.Z gana a sus RC. Los borradores nunca cuentan; otros sufijos (beta, alpha…) se ignoran.
 */
export function pickRelease(releases: Release[], channel: Channel): Release | undefined {
  const ok = releases.filter((r) => {
    const v = parseSemver(r.tag_name);
    if (r.draft || !v) return false;
    if (!v.pre.length) return true;
    return channel === "latest" && /^rc$/.test(String(v.pre[0])) && v.pre.length === 2 && typeof v.pre[1] === "number";
  });
  return ok.sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0];
}

export function platformAsset(release: Release, platform: NodeJS.Platform = process.platform): { name: string; browser_download_url: string } | undefined {
  const suffix = platform === "win32" ? "-windows.zip" : platform === "linux" ? "-linux.tar.gz" : platform === "darwin" ? "-macos.tar.gz" : undefined;
  return suffix ? release.assets.find((a) => a.name.endsWith(suffix)) : undefined;
}

// ---------- settings ----------

function settingsPath(): string {
  return join(process.env.CHIPCHOP_HOME ?? join(homedir(), ".chipchop"), "settings.json");
}

export function getChannel(): Channel {
  try {
    const j = JSON.parse(readFileSync(settingsPath(), "utf8")) as { updateChannel?: string };
    return normalizeChannel(j.updateChannel);
  } catch {
    return "stable";
  }
}

export function setChannel(channel: Channel): void {
  const p = settingsPath();
  let j: Record<string, unknown> = {};
  try {
    j = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    /* new file */
  }
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, JSON.stringify({ ...j, updateChannel: channel }, null, 2) + "\n");
}

export function currentVersion(): string {
  return (JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version: string }).version;
}

// ---------- check and install ----------

/** URL de la API de releases. `CHIPCHOP_RELEASES_URL` la sustituye (SOLO para pruebas: e2e contra un servidor local). */
export function releasesUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.CHIPCHOP_RELEASES_URL?.trim() || `https://api.github.com/repos/${REPO}/releases?per_page=50`;
}

export async function fetchReleases(): Promise<Release[]> {
  const res = await fetch(releasesUrl(), {
    headers: { accept: "application/vnd.github+json", "user-agent": "chip-chop-updater" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`the releases server answered ${res.status} while listing releases`);
  return (await res.json()) as Release[];
}

export interface UpdateInfo {
  current: string;
  channel: Channel;
  latest?: string;
  prerelease?: boolean;
  url?: string;
  available: boolean;
  asset?: string;
  note?: string;
}

export async function checkForUpdate(opts: { channel?: Channel; releases?: Release[]; current?: string; platform?: NodeJS.Platform } = {}): Promise<UpdateInfo> {
  const channel = opts.channel ?? getChannel();
  const current = opts.current ?? currentVersion();
  const best = pickRelease(opts.releases ?? (await fetchReleases()), channel);
  if (!best) return { current, channel, available: false, note: "no releases found for this channel" };
  const asset = platformAsset(best, opts.platform);
  const available = compareVersions(best.tag_name, current) > 0;
  return {
    current,
    channel,
    latest: best.tag_name.replace(/^v/, ""),
    prerelease: best.prerelease,
    url: best.html_url,
    available,
    ...(asset ? { asset: asset.name } : {}),
    ...(available && !asset ? { note: `release ${best.tag_name} has no bundle for ${process.platform}` } : {}),
  };
}

function run(cmd: string, args: string[], cwd: string, log: (l: string) => void, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    c.stdout.on("data", (d: Buffer) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => log(`  ${l}`)));
    c.stderr.on("data", (d: Buffer) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => log(`  ${l}`)));
    c.on("error", reject);
    c.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
  });
}

/** Downloads the bundle for this OS and runs its installer over the current installation. */
export async function installUpdate(opts: { channel?: Channel; log?: (l: string) => void } = {}): Promise<UpdateInfo> {
  const log = opts.log ?? (() => {});
  const channel = opts.channel ?? getChannel();
  const releases = await fetchReleases();
  const info = await checkForUpdate({ channel, releases });
  if (!info.available) {
    log(`already up to date (${info.current}, channel ${channel})`);
    return info;
  }
  const best = pickRelease(releases, channel)!;
  const asset = platformAsset(best);
  if (!asset) throw new Error(info.note ?? "no bundle for this platform");
  log(`downloading ${asset.name} (${best.tag_name})`);
  const res = await fetch(asset.browser_download_url, { headers: { "user-agent": "chip-chop-updater" }, signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const dir = mkdtempSync(join(tmpdir(), "chip-chop-update-"));
  try {
    const file = join(dir, asset.name);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    // bsdtar on Windows 10+ extracts zip files too.
    await run("tar", [asset.name.endsWith(".zip") ? "-xf" : "-xzf", file, "-C", dir], dir, log);
    const folder = readdirSync(dir).find((d) => d.startsWith("chip-chop-") && existsSync(join(dir, d, process.platform === "win32" ? "install.ps1" : "install.sh")));
    if (!folder) throw new Error("the downloaded bundle has no installer");
    const env = { ...process.env, CHIPCHOP_SKIP_BROWSER: "1" };
    log("installing over the current version");
    if (process.platform === "win32") await run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(dir, folder, "install.ps1")], dir, log, { ...env, CHIPCHOP_SKIP_PATH: "1" });
    else await run("bash", [join(dir, folder, "install.sh")], dir, log, env);
  } finally {
    rmSync(dir, { recursive: true, force: true }); // el instalador descargado no se queda ocupando espacio
  }
  log(`updated to ${info.latest}. Restart chip-chop to use it.`);
  return info;
}
