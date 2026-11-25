import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { schemasDir, chipDir } from "./paths.js";
import { exists, listFiles, readStructured } from "./fsutil.js";
import { findFirst } from "./catalog.js";
import type { Config, Flow, Mock, State, StatesCatalog } from "./types.js";

const require = createRequire(import.meta.url);
// Ajv 8 ships CommonJS with a `default` export on the module object.
const Ajv2020 = (require("ajv/dist/2020") as { default: new (o: object) => AjvLike }).default;

interface AjvLike {
  compile(schema: object): ValidateFn;
  addSchema(schema: object): void;
  getSchema(ref: string): ValidateFn | undefined;
  errorsText(errors?: unknown): string;
}
interface ValidateFn {
  (data: unknown): boolean;
  errors?: { instancePath: string; message?: string; params?: Record<string, unknown> }[] | null;
}

export interface Issue {
  severity: "error" | "warning";
  file: string;
  message: string;
}

type Kind = "config" | "states" | "flow" | "mock" | "ai" | "report";

let cache: { validators: Record<Kind, ValidateFn>; step: ValidateFn } | undefined;

function validators() {
  if (cache) return cache;
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true, validateFormats: false });
  const load = (file: string): object => JSON.parse(readFileSync(join(schemasDir, file), "utf8")) as object;
  const flowSchema = load("flow.schema.json");
  const v = {
    config: ajv.compile(load("config.schema.json")),
    states: ajv.compile(load("states.schema.json")),
    flow: ajv.compile(flowSchema),
    mock: ajv.compile(load("mock.schema.json")),
    ai: ajv.compile(load("ai.schema.json")),
    report: ajv.compile(load("report.schema.json")),
  } as Record<Kind, ValidateFn>;
  const step = ajv.getSchema("urn:chip-chop:schema:flow#/$defs/step");
  if (!step) throw new Error("internal: flow step schema not found");
  cache = { validators: v, step };
  return cache;
}

function describe(fn: ValidateFn): string[] {
  return (fn.errors ?? []).map((e) => {
    const where = e.instancePath ? e.instancePath : "(root)";
    const extra = e.params && "additionalProperty" in e.params ? ` "${String(e.params.additionalProperty)}"` : "";
    return `${where}: ${e.message ?? "invalid"}${extra}`;
  });
}

export function validateAgainst(kind: Kind, data: unknown): string[] {
  const fn = validators().validators[kind];
  return fn(data) ? [] : describe(fn);
}

/** Validates one app's .chipchop folder: schemas first, then cross-references. */
export function validateCatalogDir(appDir: string): Issue[] {
  const issues: Issue[] = [];
  const dir = chipDir(appDir);
  const rel = (f: string): string => relative(appDir, f);
  const add = (severity: Issue["severity"], file: string, message: string): void => {
    issues.push({ severity, file: rel(file), message });
  };
  const { validators: v, step } = validators();

  const read = <T>(file: string): T | undefined => {
    try {
      return readStructured<T>(file);
    } catch (e) {
      add("error", file, `cannot parse: ${(e as Error).message}`);
      return undefined;
    }
  };

  // --- config
  const configFile = findFirst(dir, "config");
  let config: Config | undefined;
  if (!configFile) {
    issues.push({ severity: "error", file: rel(join(dir, "config.yaml")), message: "missing; run `chip-chop init`" });
  } else {
    config = read<Config>(configFile);
    if (config) for (const m of validateAgainst("config", config)) add("error", configFile, m);
  }

  const viewportNames = new Set((config?.viewports ?? [{ name: "desktop" }]).map((x) => x.name));

  // --- mocks
  const mockIds = new Set<string>();
  const mocksRoot = join(dir, "mocks");
  for (const file of listFiles(mocksRoot).filter((f) => f.endsWith(".mock.json"))) {
    const mock = read<Mock>(file);
    if (!mock) continue;
    for (const m of validateAgainst("mock", mock)) add("error", file, m);
    if (!mock.id) continue;
    if (mockIds.has(mock.id)) add("error", file, `duplicate mock id "${mock.id}"`);
    mockIds.add(mock.id);
    const expected = relative(mocksRoot, file).replace(/\\/g, "/").replace(/\.mock\.json$/, "");
    if (mock.id !== expected) add("error", file, `mock id "${mock.id}" must equal its path "${expected}"`);
    // response bodies must satisfy their own inferred schema
    const dataAjv = new Ajv2020({ strict: false, validateFormats: false });
    for (const entry of mock.requests ?? []) {
      if (!entry.responseSchema || entry.response?.json === undefined) continue;
      try {
        const check = dataAjv.compile(entry.responseSchema);
        if (!check(entry.response.json)) {
          add("error", file, `${entry.match.method} ${entry.match.url}: response does not match its responseSchema (${describe(check).join("; ")})`);
        }
      } catch (e) {
        add("error", file, `${entry.match.method} ${entry.match.url}: invalid responseSchema (${(e as Error).message})`);
      }
    }
  }

  // --- states
  const statesFile = findFirst(dir, "states");
  const states: State[] = [];
  if (!statesFile) {
    issues.push({ severity: "error", file: rel(join(dir, "states.yaml")), message: "missing; run `chip-chop init`" });
  } else {
    const catalog = read<StatesCatalog>(statesFile);
    if (catalog) {
      for (const m of validateAgainst("states", catalog)) add("error", statesFile, m);
      states.push(...(catalog.states ?? []));
    }
  }
  const stateIds = new Set<string>();
  for (const s of states) {
    if (stateIds.has(s.id)) add("error", statesFile ?? dir, `duplicate state id "${s.id}"`);
    stateIds.add(s.id);
  }
  for (const s of states) {
    const f = statesFile ?? dir;
    if (s.opensFrom && !stateIds.has(s.opensFrom)) add("error", f, `state "${s.id}": opensFrom "${s.opensFrom}" does not exist`);
    for (const m of s.mocks ?? []) if (!mockIds.has(m)) add("error", f, `state "${s.id}": unknown mock "${m}"`);
    for (const vp of s.viewports ?? []) if (!viewportNames.has(vp)) add("error", f, `state "${s.id}": unknown viewport "${vp}"`);
    (s.via ?? []).forEach((st, i) => {
      if (!step(st)) add("error", f, `state "${s.id}": via[${i}] is not a valid step (${describe(step).join("; ")})`);
    });
    // overlay chains must not loop
    const seen = new Set<string>([s.id]);
    let cur: State | undefined = s;
    while (cur?.opensFrom) {
      if (seen.has(cur.opensFrom)) {
        add("error", f, `state "${s.id}": opensFrom chain loops through "${cur.opensFrom}"`);
        break;
      }
      seen.add(cur.opensFrom);
      cur = states.find((x) => x.id === cur?.opensFrom);
    }
  }

  // --- flows
  const flowIds = new Set<string>();
  for (const file of listFiles(join(dir, "flows")).filter((f) => /\.flow\.(ya?ml|json)$/.test(f))) {
    const flow = read<Flow>(file);
    if (!flow) continue;
    for (const m of validateAgainst("flow", flow)) add("error", file, m);
    if (!flow.id) continue;
    if (flowIds.has(flow.id)) add("error", file, `duplicate flow id "${flow.id}"`);
    flowIds.add(flow.id);
    const expected = basename(file).replace(/\.flow\.(ya?ml|json)$/, "");
    if (flow.id !== expected) add("warning", file, `flow id "${flow.id}" differs from its file name "${expected}"`);
    for (const m of flow.mocks ?? []) if (!mockIds.has(m)) add("error", file, `unknown mock "${m}"`);
    for (const vp of flow.viewports ?? []) if (!viewportNames.has(vp)) add("error", file, `unknown viewport "${vp}"`);
    for (const st of flow.steps ?? []) {
      if ("capture" in st && !stateIds.has(st.capture)) add("error", file, `capture of unknown state "${st.capture}"`);
    }
  }

  // --- auth
  if (config?.auth?.mock && !mockIds.has(config.auth.mock)) {
    add("error", configFile ?? dir, `auth.mock "${config.auth.mock}" does not exist`);
  }
  if (config?.auth?.mode === "mocked" && !config.auth.mock) {
    add("warning", configFile ?? dir, "auth.mode is mocked but auth.mock is not set");
  }

  // --- AI settings (optional)
  const aiFile = findFirst(dir, "ai");
  if (aiFile && exists(aiFile)) {
    const ai = read<unknown>(aiFile);
    if (ai) for (const m of validateAgainst("ai", ai)) add("error", aiFile, m);
  }

  return issues;
}

export function formatIssues(issues: Issue[]): string {
  if (issues.length === 0) return "No problems found.";
  return issues.map((i) => `${i.severity === "error" ? "error  " : "warning"} ${i.file}: ${i.message}`).join("\n");
}
