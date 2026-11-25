"use strict";
// Puente mínimo entre la pantalla de Inicio y el proceso principal: solo canales conocidos.
const { contextBridge, ipcRenderer } = require("electron");

const INVOKE = new Set(["home:state", "home:addProject", "home:openProject", "home:removeProject", "home:initProject", "home:openReports", "home:checkUpdate", "home:installUpdate", "home:setChannel", "home:installChromium", "home:saveAi", "home:openExternal"]);
contextBridge.exposeInMainWorld("chipchop", {
  invoke: (channel, ...args) => (INVOKE.has(channel) ? ipcRenderer.invoke(channel, ...args) : Promise.reject(new Error(`canal no permitido: ${channel}`))),
  onLog: (fn) => ipcRenderer.on("home:log", (_e, line) => fn(String(line))),
});
