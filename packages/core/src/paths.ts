import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

export const CHIPCHOP_DIR = ".chipchop";

/** Folder that ships inside the package: schemas, AI guides, UI. */
const here = dirname(fileURLToPath(import.meta.url));
export const packageRoot = join(here, "..");
export const assetsDir = join(packageRoot, "assets");
export const schemasDir = join(assetsDir, "schemas");
export const skillsDir = join(assetsDir, "skills");
export const uiDir = join(packageRoot, "ui");

export function chipDir(appDir: string): string {
  return join(appDir, CHIPCHOP_DIR);
}

export function globalDir(): string {
  return join(process.env.CHIPCHOP_HOME ?? join(homedir(), CHIPCHOP_DIR));
}
