import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import YAML from "yaml";

export function readStructured<T = unknown>(path: string): T {
  const text = readFileSync(path, "utf8");
  return (path.endsWith(".json") ? JSON.parse(text) : YAML.parse(text)) as T;
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function writeText(path: string, content: string): void {
  ensureDir(dirname(path));
  writeFileSync(path, content);
}

export function writeJson(path: string, value: unknown): void {
  writeText(path, JSON.stringify(value, null, 2) + "\n");
}

export function exists(path: string): boolean {
  return existsSync(path);
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** All files under `dir` (recursive), sorted, as absolute paths. */
export function listFiles(dir: string): string[] {
  if (!isDirectory(dir)) return [];
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (isDirectory(p)) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
}

export function safeLabel(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "run";
}
