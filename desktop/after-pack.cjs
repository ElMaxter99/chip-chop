"use strict";
// electron-builder no copia `node_modules` con extraResources: el núcleo necesita las suyas.
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const { appOutDir, packager } = context;
  const resources = packager.platform.name === "mac" ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, "Contents", "Resources") : path.join(appOutDir, "resources");
  const from = path.join(__dirname, "app-core", "node_modules");
  if (!fs.existsSync(from)) throw new Error("Falta desktop/app-core: ejecuta «node desktop/prepare-core.mjs» antes de empaquetar.");
  fs.cpSync(from, path.join(resources, "core", "node_modules"), { recursive: true, dereference: true });
};
