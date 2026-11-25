#!/usr/bin/env node
// CHANGELOG por ficheros (como en pdf-annotator): cada PR añade un fichero en changelog/unreleased/.
//   node scripts/changelog.mjs check [--base origin/main]
//   node scripts/changelog.mjs preview
//   node scripts/changelog.mjs release X.Y.Z [--date AAAA-MM-DD]
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildBody, parseEntry, releaseChangelog, touchesProduct } from "./lib/changelog-utils.mjs";
import { normalizeVersion, REPO_URL, ROOT, takeOption } from "./lib/release-utils.mjs";

const DIR = "changelog/unreleased";
const dirPath = join(ROOT, DIR);
const files = () => (existsSync(dirPath) ? readdirSync(dirPath).filter((n) => n.endsWith(".md") && n.toLowerCase() !== "readme.md").sort() : []);
const load = () => files().map((name) => ({ name, ...parseEntry(readFileSync(join(dirPath, name), "utf8"), `${DIR}/${name}`) }));
const unreleasedBody = (text) => {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^## Unreleased\s*$/.test(l));
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end === -1) end = lines.length;
  return lines.slice(start + 1, end).join("\n");
};

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "check") {
    const entries = load();
    console.log(`✔ ${entries.length} entradas válidas en ${DIR}/.`);
    const base = takeOption(rest, "--base");
    if (base) {
      const changed = execFileSync("git", ["diff", "--name-status", `${base}...HEAD`], { cwd: ROOT, encoding: "utf8" })
        .split("\n").filter(Boolean).map((l) => l.split("\t"));
      const names = changed.map((p) => p[p.length - 1]);
      const frag = new Set(files());
      const added = changed.filter((p) => p[0].startsWith("A") && p[p.length - 1].startsWith(`${DIR}/`) && frag.has(p[p.length - 1].slice(DIR.length + 1)));
      const consumed = changed.some((p) => p[0] === "D" && p[p.length - 1].startsWith(`${DIR}/`)) && names.includes("CHANGELOG.md");
      if (touchesProduct(names) && !added.length && !consumed) {
        console.error(`✖ Esta PR cambia la app pero no añade ningún fichero nuevo en ${DIR}/ (usa «type: none» si no necesita entrada). Ver changelog/README.md.`);
        process.exit(1);
      }
      console.log("✔ La PR trae su entrada (o no toca la app).");
    }
  } else if (command === "preview") {
    console.log(buildBody(unreleasedBody(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8")), load()) || "(sin entradas)");
  } else if (command === "release") {
    const version = normalizeVersion(rest.shift());
    const date = takeOption(rest, "--date") ?? new Date().toISOString().slice(0, 10);
    const entries = load();
    const path = join(ROOT, "CHANGELOG.md");
    writeFileSync(path, releaseChangelog(readFileSync(path, "utf8"), version, date, entries, REPO_URL));
    for (const e of entries) unlinkSync(join(dirPath, e.name));
    console.log(`✔ CHANGELOG.md: sección v${version} (${date}) con ${entries.length} entradas (borradas).`);
  } else {
    console.error("Uso: changelog.mjs check [--base ref] | preview | release X.Y.Z [--date AAAA-MM-DD]");
    process.exit(2);
  }
} catch (e) {
  console.error(`✖ ${e.message}`);
  process.exit(1);
}
