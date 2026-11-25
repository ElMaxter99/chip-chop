#!/usr/bin/env node
// Prepara lo que el instalador lleva dentro: el núcleo de chip-chop ya compilado y con sus dependencias de producción
// (todas JavaScript puro; el navegador se descarga la primera vez que se abre la app).
//   npm run build   →   node desktop/prepare-core.mjs   →   (cd desktop && npx electron-builder)
// También copia la versión del núcleo a desktop/package.json (lo que lee electron-builder).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const out = join(root, "desktop", "app-core");
const win = process.platform === "win32";
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit", shell: win && cmd === "npm" });

const pack = mkdtempSync(join(tmpdir(), "cc-core-"));
try {
  run("npm", ["pack", "--workspace", "chip-chop", "--pack-destination", pack, "--silent"], root);
  const tgz = execFileSync("node", ["-e", `console.log(require("fs").readdirSync(${JSON.stringify(pack)}).find(f=>f.endsWith(".tgz")))`], { encoding: "utf8" }).trim();
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  run("tar", ["xzf", join(pack, tgz), "--strip-components=1", "-C", out], root);
  run("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], out);
} finally {
  rmSync(pack, { recursive: true, force: true });
}

const version = JSON.parse(readFileSync(join(out, "package.json"), "utf8")).version;
const deskPath = join(root, "desktop", "package.json");
const desk = JSON.parse(readFileSync(deskPath, "utf8"));
desk.version = version;
writeFileSync(deskPath, JSON.stringify(desk, null, 2) + "\n");
console.log(`desktop/app-core listo (chip-chop ${version})`);
