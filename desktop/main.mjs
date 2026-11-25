// Chip Chop · proceso principal de Electron: elige la carpeta del proyecto, arranca la app local de chip-chop
// (la misma que `chip-chop ui`) dentro de este proceso y la muestra en una ventana. Sin Node ni terminal.
import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import electronUpdater from "electron-updater";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RELEASES_URL, feedForVersion, updateMode } from "./update-logic.mjs";

const { autoUpdater } = electronUpdater;
const here = path.dirname(fileURLToPath(import.meta.url));
const coreDir = process.env.CHIPCHOP_CORE || (app.isPackaged ? path.join(process.resourcesPath, "core") : path.join(here, "..", "packages", "core"));
const requireCore = createRequire(path.join(coreDir, "package.json"));
const statePath = () => path.join(app.getPath("userData"), "state.json");

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let ui = null;
let core = null;

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

/** Al abrir la app desde el menú/Finder el PATH es mínimo: se toma el del shell de la persona para que se vean git, node y sus herramientas. */
function fixPath() {
  if (process.platform === "win32") return;
  try {
    const shell = process.env.SHELL || "/bin/sh";
    const r = spawnSync(shell, ["-ilc", 'printf "%s" "$PATH"'], { encoding: "utf8", timeout: 4000 });
    const p = String(r.stdout || "").trim().split("\n").pop();
    if (p && p.includes("/")) process.env.PATH = p;
  } catch {
    /* se queda con el PATH heredado */
  }
}

async function loadCore() {
  const url = (f) => pathToFileURL(path.join(coreDir, "dist", f)).href;
  const [server, updater] = await Promise.all([import(url("server.js")), import(url("updater.js"))]);
  return { startUi: server.startUi, checkForUpdate: updater.checkForUpdate };
}

// ───────── Chromium (Playwright): se descarga la primera vez ─────────
async function ensureChromium(parent) {
  const { chromium } = requireCore("playwright");
  if (existsSync(chromium.executablePath())) return;
  const splash = new BrowserWindow({ width: 440, height: 160, resizable: false, minimizable: false, maximizable: false, title: "Chip Chop", autoHideMenuBar: true, parent, show: true });
  splash.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(`<body style="margin:0;display:grid;place-items:center;height:100vh;background:#F1DFB8;color:#2B1B0E;font:15px system-ui"><div style="text-align:center"><b>Descargando el navegador de capturas…</b><br><small>Solo la primera vez (unos 150 MB).</small></div></body>`));
  const cli = requireCore.resolve("playwright/cli.js");
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, "install", "chromium"], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: "ignore" });
    child.on("error", () => resolve(1));
    child.on("exit", (c) => resolve(c ?? 1));
  });
  splash.destroy();
  if (code !== 0) {
    dialog.showMessageBoxSync({ type: "warning", message: "No se pudo descargar el navegador de capturas.", detail: "Puedes seguir usando la app, pero capturar no funcionará hasta que se descargue. Comprueba la conexión y vuelve a abrirla, o ejecuta «npx playwright install chromium»." });
  }
}

// ───────── Proyecto + servidor local ─────────
async function pickProject(parent) {
  const r = await dialog.showOpenDialog(parent ?? undefined, { title: "Elige la carpeta del proyecto (la app que quieres auditar)", properties: ["openDirectory", "createDirectory"], defaultPath: readState().appDir });
  return r.canceled ? null : r.filePaths[0];
}

async function startFor(appDir) {
  if (ui) await ui.close().catch(() => {});
  ui = await core.startUi(appDir, 0, { installUpdate });
  writeState({ appDir });
  if (!win || win.isDestroyed()) createWindow();
  win.setTitle(`Chip Chop · ${path.basename(appDir)}`);
  await win.loadURL(ui.url);
}

function createWindow() {
  win = new BrowserWindow({ width: 1280, height: 860, minWidth: 900, minHeight: 600, backgroundColor: "#F1DFB8", title: "Chip Chop", icon: path.join(here, "build", "icon.png"), webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (ui && url.startsWith(new URL(ui.url).origin)) return { action: "allow" }; // los informes se abren en otra ventana
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (ui && !url.startsWith(new URL(ui.url).origin)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  win.on("closed", () => (win = null));
}

async function openProject() {
  const dir = await pickProject(win);
  if (dir) await startFor(dir);
}

// ───────── Actualizaciones ─────────
// El núcleo decide qué versión toca según el canal («Solo estables» / «Últimas»); aquí se instala.
async function installUpdate(log) {
  const info = await core.checkForUpdate();
  if (!info.available) {
    log(`ya estás al día (${info.current}, canal ${info.channel})`);
    return info;
  }
  const mode = updateMode({ platform: process.platform, appImage: Boolean(process.env.APPIMAGE) });
  if (!app.isPackaged || mode === "manual") {
    log(`hay una versión nueva (${info.latest}): se abre la página de descargas para instalarla a mano`);
    await shell.openExternal(info.url || RELEASES_URL);
    return info;
  }
  const feed = feedForVersion(info.latest);
  autoUpdater.autoDownload = false;
  autoUpdater.allowPrerelease = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.setFeedURL({ provider: "generic", url: feed.url, channel: feed.channel });
  log(`descargando ${info.latest}`);
  const found = await autoUpdater.checkForUpdates();
  if (!found?.updateInfo) throw new Error("el actualizador no encontró la versión");
  await autoUpdater.downloadUpdate();
  log("descargada; la app se reinicia para instalar");
  setTimeout(() => autoUpdater.quitAndInstall(false, true), 800);
  return info;
}

function buildMenu() {
  const mac = process.platform === "darwin";
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(mac ? [{ role: "appMenu" }] : []),
      { label: "Archivo", submenu: [{ label: "Abrir proyecto…", accelerator: "CmdOrCtrl+O", click: () => openProject() }, { type: "separator" }, mac ? { role: "close" } : { role: "quit", label: "Salir" }] },
      { label: "Ver", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "togglefullscreen" }] },
      { label: "Ayuda", submenu: [{ label: "Versiones publicadas", click: () => shell.openExternal(RELEASES_URL) }, { label: "Documentación", click: () => shell.openExternal("https://github.com/ElMaxter99/chip-chop#readme") }, { label: `Versión ${app.getVersion()}`, enabled: false }] },
    ]),
  );
}

app.on("second-instance", () => {
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
  fixPath();
  buildMenu();
  try {
    core = await loadCore();
    const smoke = process.env.CHIPCHOP_SMOKE === "1"; // prueba automática: sin diálogos ni descargas
    if (!smoke) await ensureChromium(null);
    let dir = smoke ? process.env.CHIPCHOP_APP_DIR : readState().appDir;
    if (!dir || !existsSync(dir)) dir = await pickProject(null);
    if (!dir) return app.quit();
    await startFor(dir);
    if (smoke) {
      const title = await win.webContents.executeJavaScript("document.title");
      const version = await win.webContents.executeJavaScript('fetch("/api/project").then(r=>r.json()).then(j=>String(j.version||"ok"))').catch((e) => `ERR ${e}`);
      console.log(`SMOKE_OK title=${title} project=${version} app=${app.getVersion()}`);
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
