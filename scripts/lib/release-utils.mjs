import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const REPO_URL = "https://github.com/ElMaxter99/chip-chop";
export const read = (f) => readFileSync(resolve(ROOT, f), "utf8");
export const currentVersion = () => JSON.parse(read("packages/core/package.json")).version;
export const normalizeVersion = (raw) => {
  const v = String(raw ?? "").trim().replace(/^v\.?/i, "");
  if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error(`Versión no válida: «${raw}». Usa X.Y.Z (por ejemplo 0.3.0).`);
  return v;
};
export const takeOption = (args, flag) => {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  const [, value] = args.splice(i, 2);
  if (!value) throw new Error(`Falta el valor de ${flag}.`);
  return value;
};
