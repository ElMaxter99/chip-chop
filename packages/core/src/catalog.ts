import { join, relative } from "node:path";
import { chipDir } from "./paths.js";
import { exists, listFiles, readStructured } from "./fsutil.js";
import type { Config, Flow, Mock, State, StatesCatalog, Viewport } from "./types.js";

export interface Catalog {
  appDir: string;
  config: ResolvedConfig;
  states: State[];
  flows: Flow[];
  mocks: Mock[];
}

export type ResolvedConfig = Config & {
  viewports: Viewport[];
  determinism: Required<NonNullable<Config["determinism"]>>;
  ready: Required<NonNullable<Config["ready"]>>;
  compare: {
    pixelThreshold: number;
    maxDiffPixelRatio: number;
    ignoreAntialiasing: boolean;
    structural: { aria: boolean; requests: boolean; consoleErrors: boolean };
  };
  externalAssets: {
    mode: "placeholder" | "download" | "block";
    other: "download" | "passthrough" | "block";
    defaultSize: { width: number; height: number };
    sizes: { match: string; width: number; height: number }[];
  };
  passthrough: string[];
};

export function findFirst(dir: string, base: string): string | undefined {
  for (const ext of [".yaml", ".yml", ".json"]) {
    const p = join(dir, base + ext);
    if (exists(p)) return p;
  }
  return undefined;
}

export function resolveConfig(config: Config): ResolvedConfig {
  const d = config.determinism ?? {};
  const c = config.compare ?? {};
  const e = config.externalAssets ?? {};
  return {
    ...config,
    viewports: config.viewports ?? [{ name: "desktop", width: 1440, height: 900 }],
    determinism: {
      fixedTime: d.fixedTime ?? "2026-01-15T10:00:00Z",
      timezone: d.timezone ?? "UTC",
      locale: d.locale ?? "en-US",
      disableAnimations: d.disableAnimations ?? true,
      randomSeed: d.randomSeed ?? 1,
    },
    ready: {
      networkIdleMs: config.ready?.networkIdleMs ?? 500,
      settleMs: config.ready?.settleMs ?? 200,
    },
    compare: {
      pixelThreshold: c.pixelThreshold ?? 0.1,
      maxDiffPixelRatio: c.maxDiffPixelRatio ?? 0,
      ignoreAntialiasing: c.ignoreAntialiasing ?? true,
      structural: {
        aria: c.structural?.aria ?? true,
        requests: c.structural?.requests ?? true,
        consoleErrors: c.structural?.consoleErrors ?? true,
      },
    },
    externalAssets: {
      mode: e.mode ?? "placeholder",
      other: e.other ?? "download",
      defaultSize: { width: e.defaultSize?.width ?? 300, height: e.defaultSize?.height ?? 200 },
      sizes: e.sizes ?? [],
    },
    passthrough: config.passthrough ?? [],
  };
}

/** Does `<appDir>/.chipchop/` hold a usable catalog? */
export function hasCatalog(appDir: string): boolean {
  return findFirst(chipDir(appDir), "config") !== undefined;
}

export function loadCatalog(appDir: string): Catalog {
  const dir = chipDir(appDir);
  const configFile = findFirst(dir, "config");
  if (!configFile) throw new Error(`No config found in ${dir} (expected config.yaml)`);
  const config = resolveConfig(readStructured<Config>(configFile));

  const statesFile = findFirst(dir, "states");
  const states = statesFile ? (readStructured<StatesCatalog>(statesFile).states ?? []) : [];

  const flows = listFiles(join(dir, "flows"))
    .filter((f) => /\.flow\.(ya?ml|json)$/.test(f))
    .map((f) => readStructured<Flow>(f));

  const mocks = listFiles(join(dir, "mocks"))
    .filter((f) => f.endsWith(".mock.json"))
    .map((f) => readStructured<Mock>(f));

  return { appDir, config, states, flows, mocks };
}

/** Relative path of a file inside .chipchop, for messages. */
export function shortPath(appDir: string, file: string): string {
  return relative(appDir, file) || file;
}
