#!/usr/bin/env node
// Genera las capturas de la documentación (docs/screenshots/*.png) con la interfaz REAL de chip-chop:
// monta la app de demostración, compara dos ramas de verdad, arranca la app local y fotografía cada pestaña.
// La pantalla de Inicio de la app de escritorio se fotografía con datos de ejemplo (no hay Electron aquí).
//   npm run build && node scripts/docs-screenshots.mjs
// Para que las fuentes sean las de verdad hay que haber ejecutado antes `npm run build` con las dependencias
// instaladas (el workflow «Docs screenshots» lo hace). Al terminar guarda el hash de la interfaz en
// docs/screenshots/.ui-hash, que `npm run docs:check` compara para avisar cuando las capturas se quedan viejas.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { uiHash } from "./lib/docs-utils.mjs";
import { ROOT } from "./lib/release-utils.mjs";

const core = join(ROOT, "packages", "core");
const out = join(ROOT, "docs", "screenshots");
const dist = (f) => import(pathToFileURL(join(core, "dist", f)).href);
const { chromium } = createRequire(join(core, "package.json"))("playwright");
if (!existsSync(join(core, "ui", "fonts")) || !readdirSync(join(core, "ui", "fonts")).length) {
  console.warn("aviso: no hay fuentes en packages/core/ui/fonts; las capturas saldrán con tipografías del sistema (ejecuta `npm run build` con las dependencias instaladas)");
}

const { makeRepo } = await dist("demoRepo.js");
const { runCompare } = await dist("pipeline.js");
const { startUi } = await dist("server.js");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1) Una comparación real: develop frente a la rama que añade un modal «Compartir».
const app = makeRepo();
console.log("comparando develop con feature…");
const { dir: reportDir } = await runCompare({ appDir: app, base: { label: "develop", ref: "develop" }, head: { label: "feature", ref: "feature" }, mode: "flow-audit", install: false });

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME, args: ["--no-sandbox"] } : { args: process.platform === "linux" ? ["--no-sandbox"] : [] });
const shot = async (page, name, opts = {}) => {
  await page.screenshot({ path: join(out, `${name}.png`), ...opts });
  console.log("  ", `${name}.png`);
};

try {
  // 2) La interfaz local (la misma que abre `chip-chop ui` y la app de escritorio dentro de un proyecto).
  const ui = await startUi(app, 0);
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1, locale: "es-ES" });
  const page = await ctx.newPage();
  await page.goto(ui.url);
  await page.waitForSelector("#proyecto > *");
  await page.waitForTimeout(600);
  await shot(page, "ui-proyecto");
  for (const [tab, name] of [["ia", "ui-ia"], ["comparar", "ui-comparar"], ["informes", "ui-informes"]]) {
    await page.click(`nav button[data-tab="${tab}"]`);
    await page.waitForTimeout(500);
    await shot(page, name);
  }

  // 3) El informe HTML que genera la comparación.
  const report = await ctx.newPage();
  await report.setViewportSize({ width: 1100, height: 900 });
  await report.goto(new URL(`/reports/${encodeURIComponent(reportDir.split(/[\\/]/).pop())}/report.html`, ui.url).href);
  await report.waitForTimeout(800);
  await shot(report, "report", { clip: { x: 0, y: 0, width: 1100, height: 900 } });
  await shot(report, "report-full", { fullPage: true });

  // 4) Una de las imágenes de diferencia que produce el motor (si existe).
  const diffs = [];
  const walk = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(join(d, e.name)) : /\.desktop\.png$/.test(e.name) && /[\\/]diff$/.test(d) && diffs.push(join(d, e.name))));
  walk(reportDir);
  const pick = diffs.find((f) => /passwords-delete-modal/.test(f)) ?? diffs[0];
  if (pick) {
    cpSync(pick, join(out, "diff-example.png"));
    console.log("   diff-example.png");
  }
  await ui.close();

  // 5) La pantalla de Inicio de la app de escritorio, con datos de ejemplo.
  const home = (over) => ({
    version: "0.4.3", os: "linux", platform: "linux x64", channel: "stable", updateMode: "auto",
    cssHref: pathToFileURL(join(core, "ui", "style.css")).href, aiEditorHref: pathToFileURL(join(core, "ui", "ai-editor.js")).href, logoHref: pathToFileURL(join(ROOT, "desktop", "build", "icon.png")).href,
    chromium: { installed: true }, smoke: true, setupDone: true,
    checks: [{ name: "node", ok: true, detail: "v22.12.0", required: true }, { name: "git", ok: true, detail: "git version 2.45", required: true }, { name: "ai: claude (claude)", ok: true, detail: "1.0.0", required: false }, { name: "ai: copilot (copilot)", ok: false, detail: "not found on PATH (only needed if a stage uses it)", required: false }],
    ai: { providers: { claude: { type: "claude" }, copilot: { type: "copilot" }, codex: { type: "codex" } }, stages: { discover: { provider: "claude", model: "sonnet" }, flows: { provider: "claude", model: "haiku" }, mocks: { provider: "claude", model: "sonnet" }, repair: { provider: "claude", model: "sonnet" } }, globalPath: "~/.chipchop/ai.yaml", error: "", problems: [], info: { claude: { type: "claude", command: "claude", found: { path: "C:\\Users\\ana\\.local\\bin\\claude.exe", via: "known" }, version: "2.1.332 (Claude Code)", models: { source: "builtin", note: "Lista incluida con chip-chop. Si tu Claude Code tiene otro modelo, elige «Otro…» y escribe su nombre.", options: [{ value: "sonnet", label: "Sonnet", hint: "equilibrado" }, { value: "opus", label: "Opus", hint: "el más capaz" }, { value: "haiku", label: "Haiku", hint: "rápido y barato" }] } }, copilot: { type: "copilot", command: "copilot", found: null, models: { source: "builtin", options: [], note: "Instala Copilot CLI para ver sus modelos. Mientras, escribe el nombre." } }, codex: { type: "codex", command: "codex", found: { path: "C:\\Users\\ana\\AppData\\Roaming\\npm\\codex.cmd", via: "system" }, version: "0.1.0", models: { source: "builtin", options: [], note: "Déjalo en «Predeterminado» para usar el modelo de tu ~/.codex/config.toml." } } } },
    projects: [], ...over,
  });
  const scenes = {
    "home-configuracion-inicial": home({ setupDone: false }),
    "home-vacio": home({}),
    "home-proyectos": home({ projects: [
      { path: "C:\\proyectos\\portal-clientes", name: "portal-clientes", lastOpened: Date.now() - 3600e3, exists: true, initialized: true, framework: "angularjs", lastReport: { dir: "a", base: "develop", head: "restyle-nuevo", mode: "restyle", generatedAt: Date.now() - 86400e3, states: 42, result: "changes" } },
      { path: "C:\\proyectos\\backoffice", name: "backoffice", lastOpened: Date.now() - 5 * 86400e3, exists: true, initialized: true, framework: "angular", lastReport: { dir: "b", base: "develop", head: "desarrollo-2", mode: "flow-audit", generatedAt: Date.now() - 6 * 86400e3, states: 58, result: "identical" } },
      { path: "C:\\proyectos\\tienda", name: "tienda", lastOpened: 0, exists: true, initialized: false, framework: "react", lastReport: null } ] }),
  };
  for (const [name, state] of Object.entries(scenes)) {
    const p = await browser.newPage({ viewport: { width: 1100, height: 760 }, locale: "es-ES" });
    await p.addInitScript((st) => { window.chipchop = { invoke: (c) => (c === "home:state" ? Promise.resolve(st) : c === "home:aiInfo" ? Promise.resolve({ info: st.ai.info, problems: [] }) : Promise.resolve(null)), onLog() {}, pathForFile: () => "" }; }, state);
    await p.goto(pathToFileURL(join(ROOT, "desktop", "home", "index.html")).href);
    await p.waitForSelector(name === "home-configuracion-inicial" ? "#setupFoot > *" : "#proyectos > *");
    await p.waitForTimeout(500);
    await shot(p, name);
    if (name === "home-proyectos") {
      for (const [id, n] of [["ia", "home-ia"], ["ajustes", "home-ajustes"]]) {
        await p.click(`#tab-${id}`);
        await p.waitForTimeout(300);
        await shot(p, n);
      }
    }
  }
} finally {
  await browser.close();
  rmSync(app, { recursive: true, force: true });
}

writeFileSync(join(out, ".ui-hash"), uiHash(ROOT) + "\n");
console.log(`capturas en docs/screenshots (hash ${uiHash(ROOT)})`);
