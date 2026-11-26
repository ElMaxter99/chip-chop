// Chip Chop · proceso principal de Electron. Abre siempre la pantalla de Inicio (proyectos, IA, ajustes y
// actualizaciones); al abrir un proyecto arranca la app local de chip-chop (la misma que `chip-chop ui`) dentro de este
// proceso y la muestra en la misma ventana. Sin Node ni terminal.
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, screen, shell } from "electron";
import electronUpdater from "electron-updater";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RELEASES_URL, feedForVersion, updateMode } from "./update-logic.mjs";
import { installLinuxPackage, linuxPackageKind } from "./pkg-update.mjs";

const { autoUpdater } = electronUpdater;
const here = path.dirname(fileURLToPath(import.meta.url));
const coreDir = process.env.CHIPCHOP_CORE || (app.isPackaged ? path.join(process.resourcesPath, "core") : path.join(here, "..", "packages", "core"));
const requireCore = createRequire(path.join(coreDir, "package.json"));
const statePath = () => path.join(app.getPath("userData"), "state.json");
const HOME_GO = "chipchop-home:";

const SMOKE = process.env.CHIPCHOP_SMOKE === "1";
if (SMOKE) app.setPath("userData", mkdtempSync(path.join(tmpdir(), "cc-smoke-data-"))); // la prueba automática no toca el estado real

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let ui = null;
let core = null;
let installingChromium = false;
let runningJobs = 0;

// ───────── Ventana: recordar tamaño y posición ─────────
function restoredBounds() {
  const b = readState().window;
  const def = { width: 1280, height: 860 };
  if (!b || !Number.isFinite(b.width) || !Number.isFinite(b.height)) return def;
  const out = { width: Math.max(900, b.width), height: Math.max(600, b.height) };
  if (Number.isFinite(b.x) && Number.isFinite(b.y)) {
    // solo se restaura la posición si sigue cayendo dentro de alguna pantalla (por si se desconectó un monitor)
    const visible = screen.getAllDisplays().some((d) => b.x >= d.bounds.x - 50 && b.y >= d.bounds.y - 50 && b.x < d.bounds.x + d.bounds.width - 100 && b.y < d.bounds.y + d.bounds.height - 100);
    if (visible) Object.assign(out, { x: b.x, y: b.y });
  }
  return { ...out, maximized: Boolean(b.maximized) };
}
let saveTimer = null;
function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  const maximized = win.isMaximized();
  const b = maximized ? readState().window ?? win.getNormalBounds() : win.getNormalBounds();
  writeState({ window: { x: b.x, y: b.y, width: b.width, height: b.height, maximized } });
}
const saveWindowSoon = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveWindowState, 400);
};

// ───────── Avisos del sistema al terminar un trabajo largo ─────────
const JOB_NAMES = { capture: "La captura", compare: "La comparación", ai: "La generación con IA" };
function onJob({ title, state }) {
  if (state === "start") return void runningJobs++;
  runningJobs = Math.max(0, runningJobs - 1);
  const name = JOB_NAMES[title];
  if (!name || !Notification.isSupported() || (win && !win.isDestroyed() && win.isFocused())) return;
  const n = new Notification({ title: state === "done" ? `${name} ha terminado` : `${name} ha fallado`, body: state === "done" ? "Vuelve a Chip Chop para ver el resultado." : "Abre Chip Chop para ver el error.", silent: false });
  n.on("click", () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  n.show();
}

// ───────── Abrir una carpeta desde la línea de comandos o arrastrándola ─────────
const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
function folderFromArgs(argv, cwd) {
  const args = argv.slice(app.isPackaged ? 1 : 2).filter((a) => a && !a.startsWith("-"));
  for (const a of args) {
    const p = path.resolve(cwd || process.cwd(), a);
    if (isDir(p)) return p;
  }
  return null;
}
async function openFolder(dir) {
  try {
    await openProject(dir);
  } catch (e) {
    dialog.showErrorBox("No se pudo abrir la carpeta", String(e?.message || e));
  }
}

// ───────── Estado guardado (lista de proyectos) ─────────
const readState = () => {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8"));
  } catch {
    return {};
  }
};
const writeState = (s) => {
  mkdirSync(path.dirname(statePath()), { recursive: true });
  writeFileSync(statePath(), JSON.stringify({ ...readState(), ...s }, null, 2));
};
const projects = () => {
  const st = readState();
  const list = Array.isArray(st.projects) ? st.projects : [];
  if (st.appDir && !list.some((p) => p.path === st.appDir)) list.push({ path: st.appDir, lastOpened: 0 }); // venía de una versión anterior
  return list;
};
const saveProjects = (list) => writeState({ projects: list, appDir: undefined });

/** Al abrir la app desde el menú/Finder el PATH es mínimo: se toma el del shell de la persona para que se vean git, node y sus herramientas. */
function fixPath() {
  if (process.platform === "win32") return Promise.resolve();
  // Un shell interactivo y de login (carga .bashrc/.zshrc, nvm…) puede tardar segundos: se hace sin bloquear la ventana.
  return new Promise((resolve) => {
    let out = "";
    let child;
    try {
      child = spawn(process.env.SHELL || "/bin/sh", ["-ilc", 'printf "%s" "$PATH"'], { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return resolve();
    }
    const timer = setTimeout(() => { child.kill(); resolve(); }, 4000);
    child.stdout.on("data", (d) => (out += d));
    child.on("error", () => { clearTimeout(timer); resolve(); });
    child.on("close", () => {
      clearTimeout(timer);
      const p = out.trim().split("\n").pop();
      if (p && p.includes("/")) process.env.PATH = p;
      resolve();
    });
  });
}

async function loadCore() {
  const url = (f) => pathToFileURL(path.join(coreDir, "dist", f)).href;
  const [server, updater, ai, doctor, init, aiInfo] = await Promise.all([import(url("server.js")), import(url("updater.js")), import(url("ai.js")), import(url("doctor.js")), import(url("init.js")), import(url("aiInfo.js"))]);
  return { startUi: server.startUi, checkForUpdate: updater.checkForUpdate, getChannel: updater.getChannel, setChannel: updater.setChannel, currentVersion: updater.currentVersion, loadAiConfig: ai.loadAiConfig, globalAiPath: ai.globalAiPath, doctor: doctor.doctor, aiInfo: aiInfo.aiInfo, aiProblems: aiInfo.aiProblems, initProject: init.initProject };
}

// ───────── Chromium (Playwright): se descarga la primera vez, desde la pantalla de Inicio ─────────
// `playwright` no exporta «./cli.js»: se resuelve el paquete y se busca el archivo al lado.
function playwrightCli() {
  const cli = path.join(path.dirname(requireCore.resolve("playwright")), "cli.js");
  if (!existsSync(cli)) throw new Error(`No se encuentra ${cli}`);
  return cli;
}
const chromiumInstalled = () => {
  try {
    return existsSync(requireCore("playwright").chromium.executablePath());
  } catch {
    return false;
  }
};
const send = (line) => win && !win.isDestroyed() && win.webContents.send("home:log", line);

function installChromium() {
  if (installingChromium) return Promise.resolve(false);
  installingChromium = true;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [playwrightCli(), "install", "chromium"], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    const feed = (buf) => {
      const last = String(buf).replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean).pop();
      if (last) send(`chromium:${last}`);
    };
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    child.on("error", () => resolve(false));
    child.on("exit", (c) => resolve(c === 0));
  }).finally(() => {
    installingChromium = false;
  });
}

// ───────── Proyectos + servidor local ─────────
async function openProject(appDir, tab) {
  if (!chromiumInstalled()) throw new Error("Falta el navegador de capturas: espera a que termine la descarga.");
  if (ui) await ui.close().catch(() => {});
  ui = await core.startUi(appDir, 0, { installUpdate, onJob });
  const list = projects().filter((p) => p.path !== appDir);
  list.unshift({ path: appDir, lastOpened: Date.now() });
  saveProjects(list);
  win.setTitle(`Chip Chop · ${path.basename(appDir)}`);
  await win.loadURL(ui.url);
  if (tab) await showUiTab(tab);
}

/** Cambia de pestaña en la interfaz del proyecto (la misma que se usa con el ratón). Solo nombres conocidos. */
async function showUiTab(tab) {
  if (!["informes", "comparar", "ia"].includes(tab)) return false;
  return win.webContents.executeJavaScript(`(function(){var b=document.querySelector('[data-tab="${tab}"]');if(!b)return false;b.click();return true})()`).catch(() => false);
}

async function goHome() {
  if (!win || win.isDestroyed()) createWindow();
  if (ui) {
    await ui.close().catch(() => {});
    ui = null;
  }
  win.setTitle("Chip Chop");
  await win.loadFile(path.join(here, "home", "index.html"));
}

function createWindow() {
  const rb = restoredBounds();
  win = new BrowserWindow({ width: rb.width, height: rb.height, ...(rb.x !== undefined ? { x: rb.x, y: rb.y } : {}), minWidth: 900, minHeight: 600, autoHideMenuBar: process.platform !== "darwin", backgroundColor: "#F1DFB8", title: "Chip Chop", icon: path.join(here, "build", "icon.png"), webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(here, "preload.cjs") } });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(HOME_GO)) {
      goHome();
      return { action: "deny" };
    }
    if (ui && url.startsWith(new URL(ui.url).origin)) return { action: "allow" }; // los informes se abren en otra ventana
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith("file:")) return;
    if (!ui || !url.startsWith(new URL(ui.url).origin)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  // En la interfaz de un proyecto se añade un botón para volver al Inicio.
  win.webContents.on("did-finish-load", () => {
    if (!ui || !win.webContents.getURL().startsWith(new URL(ui.url).origin)) return;
    win.webContents.executeJavaScript(`(function(){var t=document.querySelector('.top-in');if(!t||document.getElementById('cc-home'))return;var b=document.createElement('button');b.id='cc-home';b.className='ver';b.textContent='‹ Inicio';b.onclick=function(){window.open('${HOME_GO}//go')};t.prepend(b)})()`).catch(() => {});
  });
  if (rb.maximized) win.maximize();
  for (const ev of ["resize", "move", "maximize", "unmaximize"]) win.on(ev, saveWindowSoon);
  win.on("close", (e) => {
    saveWindowState();
    if (runningJobs > 0 && process.env.CHIPCHOP_SMOKE !== "1") {
      const r = dialog.showMessageBoxSync(win, { type: "warning", buttons: ["Seguir esperando", "Cerrar y cancelar"], defaultId: 0, cancelId: 0, title: "Hay un trabajo en marcha", message: "Hay una captura, comparación o generación en curso.", detail: "Si cierras ahora se cancelará y tendrás que repetirla." });
      if (r === 0) e.preventDefault();
    }
  });
  win.on("closed", () => (win = null));
}

// ───────── Actualizaciones ─────────
// El núcleo decide qué versión toca según el canal («Solo estables» / «Últimas»); aquí se instala.
async function installUpdate(log) {
  const info = await core.checkForUpdate();
  if (!info.available) {
    log(`ya estás al día (${info.current}, canal ${info.channel})`);
    return info;
  }
  const pkgKind = process.platform === "linux" && !process.env.APPIMAGE ? linuxPackageKind() : null;
  const mode = updateMode({ platform: process.platform, appImage: Boolean(process.env.APPIMAGE), packageKind: pkgKind });
  if (app.isPackaged && mode === "package") {
    // .deb/.rpm: descarga, pide la contraseña de administrador (polkit), instala y reabre la app sola.
    try {
      await installLinuxPackage({ version: info.latest, kind: pkgKind, log });
    } catch (e) {
      if (e.code === "NO_ASSET") {
        log("este paquete no tiene instalador automático: se abre la página de descargas");
        await shell.openExternal(info.url || RELEASES_URL);
        return { ...info, manual: true };
      }
      throw e;
    }
    log("descargada e instalada; reiniciando chip-chop");
    setTimeout(() => { app.relaunch(); app.exit(0); }, 1500);
    return { ...info, restart: true };
  }
  if (!app.isPackaged || mode === "manual") {
    log(`hay una versión nueva (${info.latest}): se abre la página de descargas para instalarla a mano`);
    await shell.openExternal(info.url || RELEASES_URL);
    return { ...info, manual: true };
  }
  const feed = feedForVersion(info.latest);
  autoUpdater.autoDownload = false;
  autoUpdater.allowPrerelease = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.setFeedURL({ provider: "generic", url: feed.url, channel: feed.channel });
  log(`descargando ${info.latest}`);
  autoUpdater.removeAllListeners("download-progress");
  autoUpdater.on("download-progress", (p) => log(`progreso: ${Math.round(p.percent)}%`));
  const found = await autoUpdater.checkForUpdates();
  if (!found?.updateInfo) throw new Error("el actualizador no encontró la versión");
  await autoUpdater.downloadUpdate();
  log("descargada; la app se reinicia para instalar");
  setTimeout(() => autoUpdater.quitAndInstall(false, true), 800);
  return { ...info, restart: true };
}

// ───────── Pantalla de Inicio: lo que pide la interfaz ─────────
const FRAMEWORKS = ["angularjs", "angular", "react", "other"];

/** Última comparación guardada de un proyecto (la del report.json más reciente), o null. Nunca lanza. */
function lastReport(dir) {
  const root = path.join(dir, ".chipchop", "reports");
  let best = null;
  try {
    for (const d of readdirSync(root)) {
      try {
        const r = JSON.parse(readFileSync(path.join(root, d, "report.json"), "utf8"));
        const at = Date.parse(r.generatedAt);
        if (!r.summary || Number.isNaN(at) || (best && at <= best.at)) continue;
        const s = r.summary;
        const n = (k) => Number(s[k]) || 0;
        const changed = n("visualOnly") + n("structural") + n("added") + n("removed");
        best = { at, dir: d, base: String(r.base?.name ?? "?"), head: String(r.head?.name ?? "?"), mode: r.mode === "flow-audit" ? "flow-audit" : "restyle", states: n("identical") + changed + n("failed"), failed: n("failed"), changed, result: n("failed") > 0 ? "failed" : changed > 0 ? "changes" : "identical" };
      } catch {
        /* informe ilegible: se ignora */
      }
    }
  } catch {
    /* no hay carpeta de informes */
  }
  return best && { ...best, generatedAt: best.at, at: undefined };
}

/** Elige el marco por las dependencias del package.json; si no se reconoce, «other». */
function guessFramework(dir) {
  try {
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    const d = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    if (d["@angular/core"]) return "angular";
    if (d.angular) return "angularjs";
    if (d.react || d.next) return "react";
  } catch {
    /* sin package.json legible */
  }
  return "other";
}

function gitCheck() {
  const r = spawnSync("git", ["--version"], { encoding: "utf8", timeout: 8000 });
  const v = r.error || r.status !== 0 ? "" : String(r.stdout).trim();
  return { name: "git", ok: !!v, detail: v || "not found on PATH", required: true };
}

async function homeState(refreshAi = false) {
  let checks = [];
  let aiError = "";
  // doctor (git, navegador, herramientas) y la lectura de modelos de la IA tardan: se lanzan a la vez.
  let cfg0 = null;
  try {
    cfg0 = core.loadAiConfig(app.getPath("userData"));
  } catch {
    /* el error se explica más abajo */
  }
  const infoP = cfg0 ? core.aiInfo(cfg0, refreshAi).catch(() => ({})) : null;
  try {
    checks = await core.doctor(app.getPath("userData"));
  } catch (e) {
    // doctor lee el ai.yaml global: si está roto no hay lista de herramientas, pero git sí se puede comprobar
    aiError = String(e?.message ?? e);
    checks = [gitCheck()];
  }
  let ai = { providers: {}, stages: {}, globalPath: core.globalAiPath(), error: "" };
  try {
    const cfg = core.loadAiConfig(app.getPath("userData"));
    ai = { providers: cfg.providers, stages: cfg.stages, globalPath: core.globalAiPath(), error: "", info: {}, problems: [] };
    ai.info = (await infoP) ?? (await core.aiInfo(cfg, refreshAi).catch(() => ({})));
    ai.problems = core.aiProblems(cfg, ai.info);
  } catch (e) {
    ai.error = String(e?.message ?? e) || aiError; // el ai.yaml global está mal escrito: la pantalla de IA lo explica
  }
  return {
    smoke: SMOKE,
    setupDone: SMOKE || Boolean(readState().setupDone) || projects().length > 0,
    os: process.platform,
    version: app.getVersion(),
    platform: `${process.platform} ${process.arch}`,
    channel: core.getChannel(),
    updateMode: updateMode({ platform: process.platform, appImage: Boolean(process.env.APPIMAGE), packageKind: process.platform === "linux" && !process.env.APPIMAGE ? linuxPackageKind() : null }),
    cssHref: pathToFileURL(path.join(coreDir, "ui", "style.css")).href,
    aiEditorHref: pathToFileURL(path.join(coreDir, "ui", "ai-editor.js")).href,
    updateModalHref: pathToFileURL(path.join(coreDir, "ui", "update-modal.js")).href,
    logoHref: pathToFileURL(path.join(here, "build", "icon.png")).href,
    chromium: { installed: chromiumInstalled() },
    projects: projects().map((p) => ({ path: p.path, name: path.basename(p.path), lastOpened: p.lastOpened || 0, exists: existsSync(p.path), initialized: existsSync(path.join(p.path, ".chipchop")), framework: guessFramework(p.path), lastReport: lastReport(p.path) })),
    checks: checks.filter((c) => c.name !== "chromium"),
    ai,
  };
}

function saveAi(stages) {
  const yaml = requireCore("yaml");
  const file = core.globalAiPath();
  const known = Object.keys(core.loadAiConfig(app.getPath("userData")).providers);
  let cur = {};
  try {
    cur = yaml.parse(readFileSync(file, "utf8")) ?? {};
  } catch {
    /* no había fichero */
  }
  cur.stages = cur.stages ?? {};
  for (const [stage, v] of Object.entries(stages ?? {})) {
    if (!["discover", "flows", "mocks", "repair"].includes(stage) || !known.includes(v.provider)) throw new Error(`Valor no válido para ${stage}`);
    cur.stages[stage] = { ...(cur.stages[stage] ?? {}), provider: v.provider, ...(v.model ? { model: v.model } : {}) };
    if (!v.model) delete cur.stages[stage].model;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, yaml.stringify(cur));
  core.loadAiConfig(app.getPath("userData")); // lanza si el resultado no valida
}

/** Equivalente a `chip-chop init` (sin --force: nunca pisa nada). */
function initProjectIn(dir, framework) {
  if (!projects().some((p) => p.path === dir)) throw new Error("Proyecto desconocido");
  if (!existsSync(dir)) throw new Error("La carpeta ya no existe");
  if (existsSync(path.join(dir, ".chipchop"))) throw new Error("Este proyecto ya está inicializado");
  const fw = framework === undefined ? guessFramework(dir) : framework;
  if (!FRAMEWORKS.includes(fw)) throw new Error("Marco no válido");
  const r = core.initProject(dir, { framework: fw });
  return { created: r.created, skipped: r.skipped, framework: fw };
}

function registerIpc() {
  ipcMain.handle("home:finishSetup", () => writeState({ setupDone: true }));
  ipcMain.handle("home:aiInfo", async () => { const cfg = core.loadAiConfig(app.getPath("userData")); const info = await core.aiInfo(cfg, true); return { info, problems: core.aiProblems(cfg, info) }; });
  ipcMain.handle("home:state", (_e, opts) => homeState(Boolean(opts && opts.refreshAi)));
  ipcMain.handle("home:addProject", async () => {
    const r = await dialog.showOpenDialog(win, { title: "Elige la carpeta del proyecto (la app que quieres auditar)", properties: ["openDirectory", "createDirectory"] });
    if (r.canceled) return null;
    await openProject(r.filePaths[0]);
    return r.filePaths[0];
  });
  ipcMain.handle("home:openProject", (_e, dir) => {
    if (!projects().some((p) => p.path === dir)) throw new Error("Proyecto desconocido");
    return openProject(dir);
  });
  ipcMain.handle("home:openReports", (_e, dir) => {
    if (!projects().some((p) => p.path === dir)) throw new Error("Proyecto desconocido");
    return openProject(dir, "informes");
  });
  ipcMain.handle("home:initProject", (_e, dir, framework) => initProjectIn(String(dir), framework === undefined ? undefined : String(framework)));
  ipcMain.handle("home:dropProject", async (_e, dir) => {
    if (typeof dir !== "string" || !isDir(dir)) throw new Error("Eso no es una carpeta: arrastra la carpeta de tu app, no un archivo.");
    await openProject(dir);
    return dir;
  });
  ipcMain.handle("home:removeProject", (_e, dir) => saveProjects(projects().filter((p) => p.path !== dir)));
  ipcMain.handle("home:checkUpdate", () => core.checkForUpdate().catch((e) => ({ error: e.message, channel: core.getChannel(), available: false })));
  ipcMain.handle("home:installUpdate", () => installUpdate(send));
  ipcMain.handle("home:setChannel", (_e, c) => {
    if (c !== "stable" && c !== "latest") throw new Error("Canal no válido");
    core.setChannel(c);
  });
  ipcMain.handle("home:installChromium", () => installChromium());
  ipcMain.handle("home:saveAi", (_e, stages) => saveAi(stages));
  ipcMain.handle("home:openExternal", (_e, url) => (/^https:\/\/github\.com\/ElMaxter99\//.test(String(url)) ? shell.openExternal(url) : undefined));
}

function buildMenu() {
  const mac = process.platform === "darwin";
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(mac ? [{ role: "appMenu" }] : []),
      { label: "Archivo", submenu: [{ label: "Inicio", accelerator: "CmdOrCtrl+H", click: () => goHome() }, { type: "separator" }, mac ? { role: "close" } : { role: "quit", label: "Salir" }] },
      { label: "Ver", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "togglefullscreen" }] },
      { label: "Ayuda", submenu: [{ label: "Versiones publicadas", click: () => shell.openExternal(RELEASES_URL) }, { label: "Documentación", click: () => shell.openExternal("https://github.com/ElMaxter99/chip-chop#readme") }, { label: `Versión ${app.getVersion()}`, enabled: false }] },
    ]),
  );
}

app.on("second-instance", (_e, argv, cwd) => {
  const dir = folderFromArgs(argv, cwd);
  if (dir && core) openFolder(dir);
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  ui?.close().catch(() => {});
});

app.whenReady().then(async () => {
  // La ventana sale ya, con el logo animado, y va contando qué está haciendo mientras arranca el resto.
  createWindow();
  await win.loadFile(path.join(here, "home", "splash.html")).catch(() => {});
  const boot = (m) => win?.webContents.executeJavaScript(`window.__boot&&window.__boot(${JSON.stringify(m)})`).catch(() => {});
  const t0 = Date.now();
  const lap = (what) => console.log(`[arranque] ${what}: ${Date.now() - t0} ms`);
  buildMenu();
  try {
    await boot("Preparando el entorno y tus herramientas…");
    await fixPath();
    lap("PATH del usuario");
    await boot("Cargando el motor de chip-chop…");
    core = await loadCore();
    registerIpc();
    lap("motor cargado");
    await boot("Abriendo la pantalla de inicio…");
    await goHome();
    lap("pantalla de inicio cargada");
    if (SMOKE) {
      // prueba automática: sin diálogos ni descargas. Comprueba Inicio (preload + estado + lo nuevo) y la interfaz de un proyecto.
      playwrightCli();
      const run = (js) => win.webContents.executeJavaScript(js);
      const must = (cond, msg) => {
        if (!cond) throw new Error(`smoke: ${msg}`);
      };
      const title = await run("document.title");
      // 1) proyecto nuevo sin .chipchop → «Inicializar» (misma función que `chip-chop init`)
      const proj = process.env.CHIPCHOP_APP_DIR;
      saveProjects([{ path: proj, lastOpened: 0 }]);
      let st = await run('window.chipchop.invoke("home:state")');
      must(st.projects.length === 1 && !st.projects[0].initialized && !st.projects[0].lastReport, "proyecto sin inicializar");
      const bad = await run(`window.chipchop.invoke("home:initProject", ${JSON.stringify(proj)}, "nope").then(()=>"sin error",e=>"error")`);
      must(bad === "error", "debe rechazar un marco desconocido");
      const bad2 = await run('window.chipchop.invoke("home:initProject", "/no/es/un/proyecto").then(()=>"sin error",e=>"error")');
      must(bad2 === "error", "debe rechazar proyectos desconocidos");
      const init = await run(`window.chipchop.invoke("home:initProject", ${JSON.stringify(proj)})`);
      must(init.created.includes("config.yaml") && existsSync(path.join(proj, ".chipchop", "config.yaml")), "init no creó config.yaml");
      const again = await run(`window.chipchop.invoke("home:initProject", ${JSON.stringify(proj)}).then(()=>"sin error",e=>"error")`);
      must(again === "error", "no debe reinicializar");
      // 2) último informe
      const rep = path.join(proj, ".chipchop", "reports", "main__vs__rama");
      mkdirSync(rep, { recursive: true });
      writeFileSync(path.join(rep, "report.json"), JSON.stringify({ app: "x", base: { name: "main" }, head: { name: "rama" }, mode: "restyle", generatedAt: "2026-01-15T10:00:00Z", summary: { identical: 2, visualOnly: 1, structural: 0, added: 0, removed: 0, failed: 0 }, states: [] }));
      writeFileSync(path.join(proj, ".chipchop", "reports", "roto.json"), "{");
      st = await run('window.chipchop.invoke("home:state")');
      const lr = st.projects[0].lastReport;
      must(st.projects[0].initialized && lr && lr.states === 3 && lr.result === "changes" && lr.dir === "main__vs__rama", "último informe");
      // 3) la pantalla pinta lo nuevo (recarga Inicio y espera a que se dibuje)
      await win.loadFile(path.join(here, "home", "index.html"));
      const dom = await run(`new Promise((ok)=>{var n=0;(function w(){var t=document.getElementById("proyectos");if(t&&t.querySelector(".proj")||n++>100)return ok({tabs:document.querySelectorAll('[role=tab]').length,sel:document.querySelectorAll('[role=tab][aria-selected=true]').length,rep:/3 estados/.test(t.textContent)&&/cambios/.test(t.textContent),btn:!!t.querySelector("[data-reports]"),init:!!t.querySelector("[data-init]")});setTimeout(w,50)})()})`);
      must(dom.tabs === 3 && dom.sel === 1 && dom.rep && dom.btn && !dom.init, `DOM de Inicio ${JSON.stringify(dom)}`);
      // 4) ai.yaml global roto: la pantalla de IA lo dice (y git se sigue comprobando)
      const home = mkdtempSync(path.join(tmpdir(), "cc-smoke-home-"));
      const prev = process.env.CHIPCHOP_HOME;
      process.env.CHIPCHOP_HOME = home;
      writeFileSync(path.join(home, "ai.yaml"), "stages: [\n  : :");
      const broken = await homeState();
      must(broken.ai.error && broken.checks.some((c) => c.name === "git"), "ai.yaml roto debe informar");
      await win.loadFile(path.join(here, "home", "index.html"));
      const ai = await run(`new Promise((ok)=>{var n=0;(function w(){var t=document.getElementById("ia");if(t&&t.querySelector("[data-ai-error]")||n++>100)return ok(!!(t&&t.querySelector("[data-ai-error]")&&!t.querySelector("#saveAi")));setTimeout(w,50)})()})`);
      must(ai === true, "la pantalla de IA debe mostrar el error del ai.yaml");
      if (prev === undefined) delete process.env.CHIPCHOP_HOME;
      else process.env.CHIPCHOP_HOME = prev;
      const st2 = `${st.version} ${st.projects.length}`;
      await ui?.close();
      ui = await core.startUi(proj, 0, { installUpdate });
      await win.loadURL(ui.url);
      must(await showUiTab("informes"), "no se pudo abrir la pestaña Informes del proyecto");
      const uiTitle = await win.webContents.executeJavaScript("document.title");
      const api = await win.webContents.executeJavaScript('fetch("/api/project").then(r=>r.json()).then(j=>"ok")').catch((e) => `ERR ${e}`);
      console.log(`SMOKE_OK home=${title} state=${st2} init=${init.created.length} report=${lr.result} aiError=${broken.ai.error ? "ok" : "no"} ui=${uiTitle} project=${api} app=${app.getVersion()}`);
      app.exit(0);
    }
  } catch (e) {
    if (process.env.CHIPCHOP_SMOKE === "1") {
      console.error(`SMOKE_FAIL ${e?.stack || e}`);
      app.exit(1);
    }
    dialog.showErrorBox("Chip Chop no pudo arrancar", String(e?.stack || e));
    app.quit();
  }
});
