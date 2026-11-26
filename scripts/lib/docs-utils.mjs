// Utilidades de las comprobaciones de documentación (sin tocar la red).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/** Ficheros que determinan el aspecto de las capturas de la documentación. */
export const UI_SOURCES = ["packages/core/ui/index.html", "packages/core/ui/app.js", "packages/core/ui/ai-editor.js", "packages/core/ui/update-modal.js", "packages/core/ui/style.css", "packages/core/ui/favicon.svg", "desktop/home", "desktop/build/icon.png", "docs/assets/logo.svg"];

function listFiles(root, rel) {
  const p = join(root, rel);
  if (!existsSync(p)) return [];
  if (statSync(p).isFile()) return [rel];
  return readdirSync(p).sort().flatMap((n) => listFiles(root, join(rel, n)));
}

/** Hash estable (ignora saltos de línea CRLF/LF) del código que dibuja la interfaz. */
export function uiHash(root) {
  const h = createHash("sha256");
  for (const f of UI_SOURCES.flatMap((s) => listFiles(root, s)).sort()) {
    h.update(f.replaceAll("\\", "/") + "\0");
    const buf = readFileSync(join(root, f));
    h.update(f.endsWith(".png") ? buf : Buffer.from(buf.toString("utf8").replace(/\r\n/g, "\n")));
    h.update("\0");
  }
  return h.digest("hex").slice(0, 16);
}

/** Enlaces e imágenes relativos de un Markdown que no existen en disco. */
export function brokenLinks(root, mdFile) {
  const text = readFileSync(join(root, mdFile), "utf8").replace(/```[\s\S]*?```/g, "");
  const out = [];
  for (const m of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/i.test(target)) continue;
    const file = decodeURIComponent(target.split("#")[0]);
    if (!file) continue;
    if (!existsSync(resolve(root, dirname(mdFile), file))) out.push(`${mdFile}: ${target}`);
  }
  return out;
}

export const relPath = (root, p) => relative(root, p).replaceAll("\\", "/");
