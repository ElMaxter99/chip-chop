// Actualización de la app instalada con un paquete .deb / .rpm (Linux): descarga con progreso, instalación con permisos de
// administrador pedidos al usuario (polkit/pkexec) y errores explicados. Sin dependencias de Electron para poder probarlo.
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync, openSync, readSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RELEASES_URL } from "./update-logic.mjs";

export const PKG_NAME = "chip-chop-desktop";

/** Con qué paquete se instaló esta app: "deb", "rpm" o null (carpeta suelta, AppImage…). `env` se inyecta en las pruebas. */
export function linuxPackageKind(env = {}) {
  const exists = env.exists ?? existsSync;
  const has = env.has ?? ((c) => spawnSync("sh", ["-c", `command -v ${c}`]).status === 0);
  const rpmOwns = env.rpmOwns ?? (() => spawnSync("rpm", ["-q", PKG_NAME]).status === 0);
  if (exists(`/var/lib/dpkg/info/${PKG_NAME}.list`)) return "deb";
  if (has("rpm") && rpmOwns()) return "rpm";
  return null;
}

/** URL del paquete de esa versión (solo se publican para x64). */
export function packageAssetUrl(version, kind, arch = "x64") {
  const v = String(version ?? "").replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(v) || arch !== "x64") return null;
  const file = kind === "deb" ? `chip-chop-${v}-linux-amd64.deb` : kind === "rpm" ? `chip-chop-${v}-linux-x86_64.rpm` : null;
  return file ? { url: `${process.env.CHIPCHOP_DOWNLOAD_BASE ?? RELEASES_URL}/download/v${v}/${file}`, file } : null;
}

/** Comando (sin pkexec) que instala el paquete local. `has` indica qué gestores hay. */
export function installCommand(kind, file, has = () => true) {
  if (kind === "deb") return { cmd: "env", args: ["DEBIAN_FRONTEND=noninteractive", "apt-get", "install", "-y", file] };
  if (has("dnf")) return { cmd: "dnf", args: ["install", "-y", file] };
  if (has("zypper")) return { cmd: "zypper", args: ["--non-interactive", "--no-gpg-checks", "install", "--allow-unsigned-rpm", file] };
  return { cmd: "rpm", args: ["-U", file] };
}

/** Traduce lo que devuelve pkexec a algo que entienda el usuario. */
export function describeExit(code, tail = "") {
  if (code === 126) return "Cancelaste la petición de contraseña de administrador. No se ha instalado nada; puedes volver a intentarlo.";
  if (code === 127) return "No se pudieron obtener permisos de administrador (contraseña incorrecta o sin autorización). No se ha instalado nada; puedes volver a intentarlo.";
  const t = String(tail).trim().split("\n").slice(-3).join(" · ");
  if (/lock|bloqueo|another process/i.test(t)) return `Otro programa está usando el gestor de paquetes (¿Actualizaciones de software abierto?). Espera a que termine y reintenta. (${t})`;
  return `La instalación falló (código ${code}). ${t}`.trim();
}

/** Descarga con progreso («progreso: N%»). Devuelve la ruta. Comprueba que el fichero es de verdad un paquete. */
export async function downloadPackage(url, file, log, { fetchImpl = fetch, tmp = tmpdir() } = {}) {
  const dir = mkdtempSync(join(tmp, "chip-chop-update-"));
  chmodSync(dir, 0o755); // apt corre como otro usuario: que pueda leer el paquete
  const dest = join(dir, file);
  log(`descargando ${file}`);
  let res;
  try {
    res = await fetchImpl(url, { headers: { "user-agent": "chip-chop-updater" }, redirect: "follow" });
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`Se cortó la descarga: ${e.cause?.message ?? e.message}. Comprueba tu conexión y reintenta.`);
  }
  if (!res.ok || !res.body) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`No se pudo descargar la actualización (HTTP ${res.status}). Comprueba tu conexión.`);
  }
  const total = Number(res.headers.get("content-length")) || 0;
  let got = 0, last = -1;
  const out = createWriteStream(dest, { mode: 0o644 });
  try {
    for await (const chunk of res.body) {
      got += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
      if (total) {
        const p = Math.floor((got / total) * 100);
        if (p !== last) { last = p; log(`progreso: ${p}%`); }
      }
    }
    await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`Se cortó la descarga: ${e.message}. Comprueba tu conexión y reintenta.`);
  }
  if (got < 1024 * 100 || (total && got !== total)) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error("La descarga llegó incompleta. Reintenta.");
  }
  const fd = openSync(dest, "r"); const head = Buffer.alloc(8); readSync(fd, head, 0, 8, 0); closeSync(fd);
  const okMagic = file.endsWith(".deb") ? head.toString("latin1") === "!<arch>\n" : head.readUInt32BE(0) === 0xedabeedb;
  if (!okMagic) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error("El archivo descargado no es un paquete válido.");
  }
  return { dest, dir };
}

/** Ejecuta un comando con permisos de administrador (ventana de contraseña del sistema). Resuelve al terminar bien. */
export function runElevated(cmd, args, log, { spawnImpl = spawn, hasPkexec = true } = {}) {
  return new Promise((resolve, reject) => {
    if (!hasPkexec) return reject(Object.assign(new Error("NO_PKEXEC"), { code: "NO_PKEXEC" }));
    log("permisos: esperando tu contraseña de administrador");
    const child = spawnImpl("pkexec", [cmd, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let tail = "", okShown = false;
    const feed = (b) => {
      const s = b.toString();
      tail = (tail + s).slice(-1500);
      if (!okShown) { okShown = true; log("permisos-ok"); }
      for (const l of s.split("\n")) if (l.trim()) log(`instalando: ${l.trim()}`);
    };
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    child.on("error", (e) => reject(new Error(`No se pudo pedir permisos de administrador: ${e.message}`)));
    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(Object.assign(new Error(describeExit(code, tail)), { exit: code }));
    });
  });
}

/**
 * Actualiza una instalación por paquete: descarga → permisos → instala. Devuelve cuando está instalada (el llamador reinicia).
 * Sin pkexec deja el paquete descargado y explica el comando a mano.
 */
export async function installLinuxPackage({ version, kind, log, arch = process.arch, onManual, impl = {} }) {
  const asset = packageAssetUrl(version, kind, arch);
  if (!asset) throw Object.assign(new Error("NO_ASSET"), { code: "NO_ASSET" });
  const { dest, dir } = await (impl.download ?? downloadPackage)(asset.url, asset.file, log);
  const has = impl.has ?? ((c) => spawnSync("sh", ["-c", `command -v ${c}`]).status === 0);
  const { cmd, args } = installCommand(kind, dest, has);
  try {
    await (impl.elevate ?? runElevated)(cmd, args, log, { hasPkexec: has("pkexec") });
  } catch (e) {
    if (e.code === "NO_PKEXEC") {
      if (onManual) onManual(dest);
      const manual = kind === "deb" ? `sudo apt install "${dest}"` : `sudo dnf install "${dest}"`;
      throw new Error(`Este equipo no puede pedir la contraseña de administrador desde la app. Ya se descargó el paquete; instálalo tú con: ${manual}`);
    }
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  rmSync(dir, { recursive: true, force: true });
}
