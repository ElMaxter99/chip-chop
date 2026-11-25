import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { formatIssues, validateCatalogDir } from "./validate.js";

const demo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../examples/angularjs-demo");

for (const name of ["chipchop-base", "chipchop-feature"]) {
  test(`examples/angularjs-demo/${name} is a valid catalog`, () => {
    const app = mkdtempSync(join(tmpdir(), "chipchop-angularjs-catalog-"));
    try {
      cpSync(join(demo, name), join(app, ".chipchop"), { recursive: true });
      const issues = validateCatalogDir(app);
      assert.deepEqual(issues, [], formatIssues(issues));
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });
}
