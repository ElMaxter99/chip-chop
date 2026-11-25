#!/usr/bin/env node
// Comprueba que la documentación no se ha quedado atrás:
//   · todos los enlaces e imágenes relativos del README y de docs/ existen;
//   · las capturas de docs/screenshots se hicieron con la interfaz actual (hash de su código).
// `--strict` (lo usa el workflow de release) convierte el aviso de capturas viejas en error.
//   node scripts/check-docs.mjs [--strict]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { brokenLinks, uiHash } from "./lib/docs-utils.mjs";
import { ROOT } from "./lib/release-utils.mjs";

const strict = process.argv.includes("--strict");
let errors = 0;

const mds = ["README.md", ...readdirSync(join(ROOT, "docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`)];
for (const md of mds) for (const b of brokenLinks(ROOT, md)) { console.error(`✖ enlace roto → ${b}`); errors++; }

const stamp = join(ROOT, "docs", "screenshots", ".ui-hash");
const now = uiHash(ROOT);
if (!existsSync(stamp)) {
  console.error("✖ Faltan las capturas de la documentación (docs/screenshots). Lanza el workflow «Docs screenshots».");
  errors++;
} else if (readFileSync(stamp, "utf8").trim() !== now) {
  const msg = "La interfaz cambió desde que se hicieron las capturas de docs/screenshots. Lanza el workflow «Docs screenshots» (Actions) o «npm run docs:screenshots» y sube el resultado.";
  if (strict) { console.error(`✖ ${msg}`); errors++; } else console.warn(`::warning::${msg}`);
}
if (errors) process.exit(1);
console.log("✔ Documentación al día (enlaces, imágenes y capturas).");
