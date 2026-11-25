import { createHash } from "node:crypto";
import { join } from "node:path";
import { PNG } from "pngjs";
import { ensureDir, exists, readStructured, writeJson } from "./fsutil.js";
import { readFileSync, writeFileSync } from "node:fs";
import { matchUrl } from "./urlMatch.js";
import type { ResolvedConfig } from "./catalog.js";

const placeholderCache = new Map<string, Buffer>();

/** Solid light-grey PNG with a darker 2px frame, so layout is visible but never random. */
export function placeholderPng(width: number, height: number): Buffer {
  const key = `${width}x${height}`;
  const hit = placeholderCache.get(key);
  if (hit) return hit;
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge = x < 2 || y < 2 || x >= width - 2 || y >= height - 2;
      const v = edge ? 150 : 215;
      const i = (y * width + x) * 4;
      png.data[i] = v;
      png.data[i + 1] = v;
      png.data[i + 2] = v;
      png.data[i + 3] = 255;
    }
  }
  const buf = PNG.sync.write(png);
  placeholderCache.set(key, buf);
  return buf;
}

export function placeholderSize(config: ResolvedConfig, url: string): { width: number; height: number } {
  for (const s of config.externalAssets.sizes) {
    if (matchGlob(s.match, url)) return { width: s.width, height: s.height };
  }
  return config.externalAssets.defaultSize;
}

/** Glob for full URLs: ** crosses slashes, * stays inside a segment. */
export function matchGlob(pattern: string, url: string): boolean {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "*" && pattern[i + 1] === "*") {
      re += ".*";
      i++;
    } else if (ch === "*") re += "[^/]*";
    else re += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$").test(url) || (pattern.startsWith("**/") && matchUrl(pattern, url));
}

export interface CachedAsset {
  status: number;
  contentType: string;
  body: Buffer;
}

/** Downloads a URL once and replays it from `<assetsDir>/external/` afterwards. */
export async function downloadCached(assetsDir: string, url: string): Promise<CachedAsset> {
  const dir = join(assetsDir, "external");
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 16);
  const metaPath = join(dir, `${hash}.json`);
  const bodyPath = join(dir, `${hash}.body`);
  if (exists(metaPath) && exists(bodyPath)) {
    const meta = readStructured<{ status: number; contentType: string }>(metaPath);
    return { status: meta.status, contentType: meta.contentType, body: readFileSync(bodyPath) };
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const body = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  if (res.ok) {
    ensureDir(dir);
    writeFileSync(bodyPath, body);
    writeJson(metaPath, { url, status: res.status, contentType });
  }
  return { status: res.status, contentType, body };
}
