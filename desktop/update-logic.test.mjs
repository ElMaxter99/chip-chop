import test from "node:test";
import assert from "node:assert/strict";
import { feedForVersion, updateMode } from "./update-logic.mjs";

test("updateMode: auto en Windows y AppImage, manual en el resto", () => {
  assert.equal(updateMode({ platform: "win32" }), "auto");
  assert.equal(updateMode({ platform: "linux", appImage: true }), "auto");
  assert.equal(updateMode({ platform: "linux" }), "manual");
  assert.equal(updateMode({ platform: "darwin" }), "manual");
});

test("feedForVersion: final → latest, candidata → rc", () => {
  assert.deepEqual(feedForVersion("v0.4.0"), { url: "https://github.com/ElMaxter99/chip-chop/releases/download/v0.4.0/", channel: "latest" });
  assert.equal(feedForVersion("0.4.0-rc.2").channel, "rc");
  assert.equal(feedForVersion("0.4.0-rc.2").url.endsWith("/v0.4.0-rc.2/"), true);
  assert.equal(feedForVersion("basura"), null);
});
