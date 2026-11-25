import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brokenLinks, uiHash } from "./lib/docs-utils.mjs";

function repo() {
  const d = mkdtempSync(join(tmpdir(), "docs-"));
  mkdirSync(join(d, "packages/core/ui"), { recursive: true });
  mkdirSync(join(d, "docs"), { recursive: true });
  writeFileSync(join(d, "packages/core/ui/app.js"), "a\r\nb\r\n");
  return d;
}

test("uiHash ignora CRLF y cambia con el contenido", () => {
  const d = repo();
  const h1 = uiHash(d);
  writeFileSync(join(d, "packages/core/ui/app.js"), "a\nb\n");
  assert.equal(uiHash(d), h1);
  writeFileSync(join(d, "packages/core/ui/app.js"), "a\nc\n");
  assert.notEqual(uiHash(d), h1);
});

test("brokenLinks encuentra enlaces e imágenes rotos y respeta externos, anclas y bloques de código", () => {
  const d = repo();
  writeFileSync(join(d, "docs/ok.md"), "x");
  writeFileSync(join(d, "README.md"), ["[ok](docs/ok.md#a)", "![img](docs/falta.png)", "[web](https://x.y)", "[ancla](#fin)", "```", "[no](docs/ignorado.md)", "```"].join("\n"));
  assert.deepEqual(brokenLinks(d, "README.md"), ["README.md: docs/falta.png"]);
});
