import test from "node:test";
import assert from "node:assert/strict";
import { buildBody, changelogSection, parseEntry, releaseChangelog, touchesProduct } from "./lib/changelog-utils.mjs";

test("parseEntry lee tipo y texto, y acepta none", () => {
  assert.deepEqual(parseEntry("---\ntype: fixed\n---\n**Algo** arreglado"), { type: "Fixed", text: "**Algo** arreglado" });
  assert.equal(parseEntry("---\ntype: none\n---\n").type, "none");
  assert.throws(() => parseEntry("sin cabecera"));
  assert.throws(() => parseEntry("---\ntype: raro\n---\nx"));
  assert.throws(() => parseEntry("---\ntype: Added\n---\n"));
});

test("releaseChangelog junta entradas, vacía Unreleased y no publica vacío", () => {
  const base = "# Changelog\n\n## Unreleased\n\n## [v0.1.0](u) - 2026-01-01\n### Added\n- viejo\n";
  const out = releaseChangelog(base, "0.2.0", "2026-02-02", [{ type: "Added", text: "nuevo" }, { type: "Fixed", text: "bug" }], "https://x");
  assert.match(out, /## Unreleased\n\n## \[v0\.2\.0\]\(https:\/\/x\/releases\/tag\/v0\.2\.0\) - 2026-02-02\n### Added\n- nuevo\n\n### Fixed\n- bug/);
  assert.ok(out.indexOf("v0.2.0") < out.indexOf("v0.1.0"));
  assert.throws(() => releaseChangelog(base, "0.2.0", "2026-02-02", [], "https://x"));
  assert.equal(buildBody("", [{ type: "none", text: "" }]), "");
});

test("changelogSection y touchesProduct", () => {
  const c = "## Unreleased\n\n## [v0.2.0](u) - d\n### Added\n- a\n\n## [v0.1.0](u) - d\n- b\n";
  assert.equal(changelogSection("0.2.0", c).body, "### Added\n- a");
  assert.equal(changelogSection("9.9.9", c), null);
  assert.ok(touchesProduct(["packages/core/src/cli.ts"]));
  assert.ok(!touchesProduct(["docs/USAGE.md"]));
});
