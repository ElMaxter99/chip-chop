// Comprueba que el empaquetado sin instalador (`electron-builder --dir`) lleva todo lo que la app necesita.
// Uso: node desktop/verify-pack.mjs   (desde la raíz, después de `electron-builder --dir`)
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve("release");
const unpacked = readdirSync(out).find((d) => /^(win|linux|mac)/.test(d) && existsSync(path.join(out, d)));
if (!unpacked) throw new Error("No hay salida de electron-builder en release/");
const base = path.join(out, unpacked);
const resources = existsSync(path.join(base, "resources")) ? path.join(base, "resources") : path.join(base, readdirSync(base).find((n) => n.endsWith(".app")), "Contents", "Resources");
const need = ["app.asar", "core/package.json", "core/dist/server.js", "core/dist/cli.js", "core/ui/index.html", "core/node_modules/playwright/cli.js", "core/node_modules/pngjs", "core/node_modules/pixelmatch", "core/node_modules/ajv"];
const missing = need.filter((f) => !existsSync(path.join(resources, f)));
if (missing.length) {
  console.error("Faltan en el paquete:\n - " + missing.join("\n - "));
  process.exit(1);
}
console.log(`OK: ${unpacked}`);
