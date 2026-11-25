// Copies the schemas and the AI guides into packages/core/assets so the engine
// ships as one self-contained package. Runs before every build and pack.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
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

// UI fonts (SIL OFL), copied next to the UI so the app works offline. Skipped when not installed.
const fonts = [
  ["bricolage-grotesque", [400, 600, 800]],
  ["jetbrains-mono", [400, 700]],
];
const fontsOut = join(root, "packages", "core", "ui", "fonts");
rmSync(fontsOut, { recursive: true, force: true });
mkdirSync(fontsOut, { recursive: true });
let copied = 0;
for (const [name, weights] of fonts) {
  const dir = [join(root, "node_modules", "@fontsource", name, "files"), join(root, "packages", "core", "node_modules", "@fontsource", name, "files")].find(existsSync);
  if (!dir) {
    console.warn(`warning: @fontsource/${name} not installed; the UI falls back to system fonts`);
    continue;
  }
  for (const w of weights) {
    const f = `${name}-latin-${w}-normal.woff2`;
    if (existsSync(join(dir, f))) {
      cpSync(join(dir, f), join(fontsOut, f));
      copied++;
    } else console.warn(`warning: ${f} not found`);
  }
}
console.log(`assets synced to packages/core/assets (${copied} font files)`);
