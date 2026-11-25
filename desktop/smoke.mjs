// Arranca la app EMPAQUETADA (salida de `electron-builder --dir`) contra una carpeta de proyecto vacía y comprueba
// que la ventana carga la interfaz de chip-chop. Linux: ejecutar con `xvfb-run -a node desktop/smoke.mjs`.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const rel = path.resolve("release");
const candidates = [
  path.join(rel, "linux-unpacked", "chip-chop-desktop"),
  path.join(rel, "win-unpacked", "Chip Chop.exe"),
  ...readdirSync(rel).filter((d) => d.startsWith("mac")).map((d) => path.join(rel, d, "Chip Chop.app", "Contents", "MacOS", "Chip Chop")),
];
const exe = candidates.find((c) => existsSync(c));
if (!exe) throw new Error(`No se encuentra el ejecutable empaquetado en ${rel}`);
const proj = mkdtempSync(path.join(tmpdir(), "cc-smoke-"));
const args = process.platform === "linux" ? ["--no-sandbox"] : [];
const r = spawnSync(exe, args, { env: { ...process.env, CHIPCHOP_SMOKE: "1", CHIPCHOP_APP_DIR: proj }, encoding: "utf8", timeout: 90_000 });
const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
if (r.status !== 0 || !out.includes("SMOKE_OK")) {
  console.error(out || r.error);
  process.exit(1);
}
console.log(out.split("\n").find((l) => l.includes("SMOKE_OK")));
