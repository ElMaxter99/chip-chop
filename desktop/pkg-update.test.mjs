import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { describeExit, downloadPackage, installCommand, installLinuxPackage, linuxPackageKind, packageAssetUrl, runElevated } from "./pkg-update.mjs";

const fakeDeb = (n = 300000) => Buffer.concat([Buffer.from("!<arch>\n"), Buffer.alloc(n)]);
const serve = (handler) => new Promise((ok) => { const s = createServer(handler).listen(0, "127.0.0.1", () => ok({ s, url: `http://127.0.0.1:${s.address().port}/p.deb` })); });

test("linuxPackageKind distingue deb, rpm y nada", () => {
  assert.equal(linuxPackageKind({ exists: () => true }), "deb");
  assert.equal(linuxPackageKind({ exists: () => false, has: () => true, rpmOwns: () => true }), "rpm");
  assert.equal(linuxPackageKind({ exists: () => false, has: () => true, rpmOwns: () => false }), null);
  assert.equal(linuxPackageKind({ exists: () => false, has: () => false }), null);
});

test("packageAssetUrl: nombres de los paquetes publicados y solo x64", () => {
  assert.equal(packageAssetUrl("v0.4.5", "deb").file, "chip-chop-0.4.5-linux-amd64.deb");
  assert.equal(packageAssetUrl("0.4.5", "rpm").file, "chip-chop-0.4.5-linux-x86_64.rpm");
  assert.ok(packageAssetUrl("0.5.0-rc.1", "deb").url.endsWith("/download/v0.5.0-rc.1/chip-chop-0.5.0-rc.1-linux-amd64.deb"));
  assert.equal(packageAssetUrl("0.4.5", "deb", "arm64"), null);
  assert.equal(packageAssetUrl("basura", "deb"), null);
});

test("installCommand elige apt-get, dnf, zypper o rpm", () => {
  assert.deepEqual(installCommand("deb", "/t/a.deb").args.slice(-3), ["install", "-y", "/t/a.deb"]);
  assert.equal(installCommand("rpm", "/t/a.rpm", (c) => c === "dnf").cmd, "dnf");
  assert.equal(installCommand("rpm", "/t/a.rpm", (c) => c === "zypper").cmd, "zypper");
  assert.equal(installCommand("rpm", "/t/a.rpm", () => false).cmd, "rpm");
});

test("describeExit explica contraseña cancelada, sin autorización y bloqueo de apt", () => {
  assert.match(describeExit(126), /Cancelaste/);
  assert.match(describeExit(127), /permisos de administrador/);
  assert.match(describeExit(100, "E: Could not get lock /var/lib/dpkg/lock"), /Otro programa/);
  assert.match(describeExit(2, "boom"), /código 2/);
});

test("downloadPackage descarga con progreso y valida el paquete", async () => {
  const body = fakeDeb();
  const { s, url } = await serve((_q, r) => { r.writeHead(200, { "content-length": body.length }); r.end(body); });
  const lines = [];
  const { dest, dir } = await downloadPackage(url, "a.deb", (l) => lines.push(l));
  try {
    assert.ok(existsSync(dest));
    assert.ok(lines.some((l) => l === "progreso: 100%"));
    assert.ok(lines[0].startsWith("descargando"));
  } finally { s.closeAllConnections(); s.close(); }
});

test("downloadPackage rechaza HTTP 404, ficheros que no son paquetes y descargas incompletas", async () => {
  let s = await serve((_q, r) => { r.writeHead(404); r.end("no"); });
  await assert.rejects(downloadPackage(s.url, "a.deb", () => {}), /HTTP 404/);
  s.s.closeAllConnections(); s.s.close();
  s = await serve((_q, r) => { const b = Buffer.alloc(300000, 1); r.writeHead(200, { "content-length": b.length }); r.end(b); });
  await assert.rejects(downloadPackage(s.url, "a.deb", () => {}), /no es un paquete válido/);
  s.s.closeAllConnections(); s.s.close();
  s = await serve((_q, r) => { const b = fakeDeb(); r.writeHead(200, { "content-length": b.length + 5000 }); r.write(b); r.destroy(); });
  await assert.rejects(downloadPackage(s.url, "a.deb", () => {}), /cortó|incompleta/);
  s.s.closeAllConnections(); s.s.close();
});

function fakeSpawn(code, out = "") {
  return () => {
    const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter();
    setImmediate(() => { if (out) c.stdout.emit("data", Buffer.from(out)); c.emit("close", code); });
    return c;
  };
}

test("runElevated: éxito, contraseña cancelada (126), sin autorización (127) y sin pkexec", async () => {
  const lines = [];
  await runElevated("apt-get", ["install"], (l) => lines.push(l), { spawnImpl: fakeSpawn(0, "Unpacking x\nSetting up x\n") });
  assert.equal(lines[0], "permisos: esperando tu contraseña de administrador");
  assert.ok(lines.includes("permisos-ok"));
  assert.ok(lines.includes("instalando: Setting up x"));
  await assert.rejects(runElevated("x", [], () => {}, { spawnImpl: fakeSpawn(126) }), /Cancelaste/);
  await assert.rejects(runElevated("x", [], () => {}, { spawnImpl: fakeSpawn(127) }), /permisos de administrador/);
  await assert.rejects(runElevated("x", [], () => {}, { hasPkexec: false }), (e) => e.code === "NO_PKEXEC");
});

test("installLinuxPackage: instala, o deja el paquete y explica el comando si no hay pkexec", async () => {
  const log = [];
  const download = async () => ({ dest: "/tmp/x/a.deb", dir: "/tmp/__no_existe__" });
  await installLinuxPackage({ version: "0.4.5", kind: "deb", arch: "x64", log: (l) => log.push(l), impl: { download, has: () => true, elevate: async () => {} } });
  let manual = "";
  await assert.rejects(
    installLinuxPackage({ version: "0.4.5", kind: "deb", arch: "x64", log: () => {}, onManual: (f) => (manual = f), impl: { download, has: (c) => c !== "pkexec", elevate: (c, a, l, o) => runElevated(c, a, l, o) } }),
    /sudo apt install "\/tmp\/x\/a\.deb"/,
  );
  assert.equal(manual, "/tmp/x/a.deb");
  await assert.rejects(installLinuxPackage({ version: "0.4.5", kind: "deb", arch: "arm64", log: () => {} }), (e) => e.code === "NO_ASSET");
});
