// Chip Chop · proceso principal de Electron. Abre siempre la pantalla de Inicio (proyectos, IA, ajustes y
// actualizaciones); al abrir un proyecto arranca la app local de chip-chop (la misma que `chip-chop ui`) dentro de este
// proceso y la muestra en la misma ventana. Sin Node ni terminal.
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
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
const HOME_GO = "chipchop-home:";

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let ui = null;
let core = null;
let installingChromium = false;

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
  if (process.platform === "win32") return;
  try {
    const sh = process.env.SHELL || "/bin/sh";
    const r = spawnSync(sh, ["-ilc", 'printf "%s" "$PATH"'], { encoding: "utf8", timeout: 4000 });
    const p = String(r.stdout || "").trim().split("\n").pop();
    if (p && p.includes("/")) process.env.PATH = p;
  } catch {
    /* se queda con el PATH heredado */
  }
}

async function loadCore() {
  const url = (f) => pathToFileURL(path.join(coreDir, "dist", f)).href;
  const [server, updater, ai, doctor] = await Promise.all([import(url("server.js")), import(url("updater.js")), import(url("ai.js")), import(url("doctor.js"))]);
  return { startUi: server.startUi, checkForUpdate: updater.checkForUpdate, getChannel: updater.getChannel, setChannel: updater.setChannel, currentVersion: updater.currentVersion, loadAiConfig: ai.loadAiConfig, globalAiPath: ai.globalAiPath, doctor: doctor.doctor };
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
async function openProject(appDir) {
  if (!chromiumInstalled()) throw new Error("Falta el navegador de capturas: espera a que termine la descarga.");
  if (ui) await ui.close().catch(() => {});
  ui = await core.startUi(appDir, 0, { installUpdate });
  const list = projects().filter((p) => p.path !== appDir);
  list.unshift({ path: appDir, lastOpened: Date.now() });
  saveProjects(list);
  win.setTitle(`Chip Chop · ${path.basename(appDir)}`);
  await win.loadURL(ui.url);
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
  win = new BrowserWindow({ width: 1280, height: 860, minWidth: 900, minHeight: 600, backgroundColor: "#F1DFB8", title: "Chip Chop", icon: path.join(here, "build", "icon.png"), webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(here, "preload.cjs") } });
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

// ───────── Pantalla de Inicio: lo que pide la interfaz ─────────
async function homeState() {
  const checks = await core.doctor(app.getPath("userData")).catch(() => []);
  let ai = { providers: {}, stages: {}, globalPath: core.globalAiPath() };
  try {
    const cfg = core.loadAiConfig(app.getPath("userData"));
    ai = { providers: cfg.providers, stages: cfg.stages, globalPath: core.globalAiPath() };
  } catch {
    /* el ai.yaml global está mal escrito: se muestran los valores vacíos */
  }
  return {
    version: app.getVersion(),
    platform: `${process.platform} ${process.arch}`,
    channel: core.getChannel(),
    updateMode: updateMode({ platform: process.platform, appImage: Boolean(process.env.APPIMAGE) }),
    cssHref: pathToFileURL(path.join(coreDir, "ui", "style.css")).href,
    logoHref: pathToFileURL(path.join(here, "build", "icon.png")).href,
    chromium: { installed: chromiumInstalled() },
    projects: projects().map((p) => ({ path: p.path, name: path.basename(p.path), lastOpened: p.lastOpened || 0, exists: existsSync(p.path), initialized: existsSync(path.join(p.path, ".chipchop")) })),
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

function registerIpc() {
  ipcMain.handle("home:state", () => homeState());
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
    registerIpc();
    await goHome();
    if (process.env.CHIPCHOP_SMOKE === "1") {
      // prueba automática: sin diálogos ni descargas. Comprueba Inicio (preload + estado) y la interfaz de un proyecto.
      playwrightCli();
      const title = await win.webContents.executeJavaScript("document.title");
      const st = await win.webContents.executeJavaScript('window.chipchop.invoke("home:state").then(s=>s.version+" "+s.projects.length)');
      await ui?.close();
      ui = await core.startUi(process.env.CHIPCHOP_APP_DIR, 0, { installUpdate });
      await win.loadURL(ui.url);
      const uiTitle = await win.webContents.executeJavaScript("document.title");
      const proj = await win.webContents.executeJavaScript('fetch("/api/project").then(r=>r.json()).then(j=>"ok")').catch((e) => `ERR ${e}`);
      console.log(`SMOKE_OK home=${title} state=${st} ui=${uiTitle} project=${proj} app=${app.getVersion()}`);
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
