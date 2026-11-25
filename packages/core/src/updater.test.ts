import assert from "node:assert/strict";
import { test } from "node:test";
import { checkForUpdate, compareVersions, pickRelease, platformAsset, type Release } from "./updater.js";

const rel = (tag: string, pre = false, draft = false): Release => ({
  tag_name: tag,
  prerelease: pre,
  draft,
  html_url: `https://example.test/${tag}`,
  assets: [{ name: `chip-chop-${tag.slice(1)}-linux.tar.gz`, browser_download_url: "u1" }, { name: `chip-chop-${tag.slice(1)}-windows.zip`, browser_download_url: "u2" }, { name: `chip-chop-${tag.slice(1)}-macos.tar.gz`, browser_download_url: "u3" }],
});

test("semver precedence incl. release candidates", () => {
  assert.ok(compareVersions("0.2.0", "0.2.0-rc.1") > 0);
  assert.ok(compareVersions("0.2.0-rc.2", "0.2.0-rc.1") > 0);
  assert.ok(compareVersions("0.2.0-rc.10", "0.2.0-rc.9") > 0);
  assert.ok(compareVersions("0.2.0-rc.1", "0.1.9") > 0);
  assert.ok(compareVersions("v0.1.1", "0.1.1") === 0);
});

const all = [rel("v0.1.1"), rel("v0.2.0-rc.1", true), rel("v0.1.0"), rel("v0.3.0-rc.1", true, true)];

test("stable channel ignores release candidates and drafts", () => {
  assert.equal(pickRelease(all, "stable")?.tag_name, "v0.1.1");
});

test("all channel takes the newest, release candidate or final", () => {
  assert.equal(pickRelease(all, "latest")?.tag_name, "v0.2.0-rc.1");
  assert.equal(pickRelease([...all, rel("v0.2.0")], "latest")?.tag_name, "v0.2.0");
  assert.equal(pickRelease([...all, rel("v0.2.0")], "stable")?.tag_name, "v0.2.0");
});

test("checkForUpdate: available, current and per-platform asset", async () => {
  const a = await checkForUpdate({ channel: "latest", current: "0.1.1", releases: all, platform: "win32" });
  assert.equal(a.available, true);
  assert.equal(a.prerelease, true);
  assert.equal(a.asset, "chip-chop-0.2.0-rc.1-windows.zip");
  const s = await checkForUpdate({ channel: "stable", current: "0.1.1", releases: all });
  assert.equal(s.available, false);
  const rc = await checkForUpdate({ channel: "stable", current: "0.2.0-rc.1", releases: [rel("v0.2.0")] });
  assert.equal(rc.available, true);
  assert.equal(platformAsset(rel("v1.0.0"), "freebsd"), undefined);
});

test("macOS picks the -macos.tar.gz asset (sin validar en un Mac real)", async () => {
  const r = await checkForUpdate({ channel: "stable", current: "0.1.1", releases: [rel("v0.2.0")], platform: "darwin" });
  assert.equal(r.asset, "chip-chop-0.2.0-macos.tar.gz");
});
