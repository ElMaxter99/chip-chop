// Copies the schemas and the AI guides into packages/core/assets so the engine
// ships as one self-contained package. Runs before every build and pack.
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "packages", "core", "assets");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "schemas"), { recursive: true });

const schemasSrc = join(root, "packages", "schemas");
for (const f of readdirSync(schemasSrc)) {
  if (f.endsWith(".schema.json")) cpSync(join(schemasSrc, f), join(out, "schemas", f));
}
cpSync(join(schemasSrc, "examples"), join(out, "schemas", "examples"), { recursive: true });

const skillsSrc = join(root, "packages", "skills");
mkdirSync(join(out, "skills"), { recursive: true });
cpSync(join(skillsSrc, "SKILL.md"), join(out, "skills", "SKILL.md"));
cpSync(join(skillsSrc, "guides"), join(out, "skills", "guides"), { recursive: true });

console.log("assets synced to packages/core/assets");
