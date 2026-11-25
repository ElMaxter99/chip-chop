// Validates the JSON Schemas, the valid examples (must pass), the invalid
// examples (must fail), and the cross-references between example files.
// Run: npm run validate:schemas
import { createRequire } from "node:module";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020");
const YAML = require("yaml");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaDir = join(root, "packages", "schemas");
const exampleDir = join(schemaDir, "examples");
const invalidDir = join(exampleDir, "invalid");

// Formats (uri, date-time) are documented in the schemas but not enforced here.
// strictRequired is off because if/then branches legitimately require properties
// that are declared on the parent object.
const ajv = new Ajv2020({
  strict: true,
  strictRequired: false,
  allErrors: true,
  validateFormats: false,
});

const kinds = {
  config: "config.schema.json",
  states: "states.schema.json",
  flow: "flow.schema.json",
  mock: "mock.schema.json",
  report: "report.schema.json",
};

const validators = {};
for (const [kind, file] of Object.entries(kinds)) {
  const schema = JSON.parse(readFileSync(join(schemaDir, file), "utf8"));
  validators[kind] = ajv.compile(schema);
}

function kindOf(name) {
  if (name.endsWith(".flow.yaml")) return "flow";
  if (name.endsWith(".mock.json")) return "mock";
  if (name.startsWith("config")) return "config";
  if (name.includes("states")) return "states";
  if (name.startsWith("report")) return "report";
  return null;
}

function load(path) {
  const text = readFileSync(path, "utf8");
  return path.endsWith(".json") ? JSON.parse(text) : YAML.parse(text);
}

let failures = 0;
const fail = (msg) => {
  failures++;
  console.error("FAIL  " + msg);
};

// 1) Valid examples must pass
const loaded = {};
for (const name of readdirSync(exampleDir)) {
  const path = join(exampleDir, name);
  if (name === "invalid" || !/\.(ya?ml|json)$/.test(name)) continue;
  const kind = kindOf(name);
  if (!kind) {
    fail(`${name}: cannot tell which schema applies`);
    continue;
  }
  const data = load(path);
  loaded[name] = { kind, data };
  if (!validators[kind](data)) {
    fail(`${name} (${kind}): ${ajv.errorsText(validators[kind].errors)}`);
  } else {
    console.log(`ok    ${name} (${kind})`);
  }
}

// 2) Invalid examples must fail
if (existsSync(invalidDir)) {
  for (const name of readdirSync(invalidDir)) {
    const kind = kindOf(name);
    if (!kind) {
      fail(`invalid/${name}: cannot tell which schema applies`);
      continue;
    }
    const data = load(join(invalidDir, name));
    if (validators[kind](data)) {
      fail(`invalid/${name} (${kind}) passed validation but must fail`);
    } else {
      console.log(`ok    invalid/${name} rejected as expected`);
    }
  }
}

// 3) Mock responses must satisfy their own responseSchema
const dataAjv = new Ajv2020({ strict: false, validateFormats: false });
for (const [name, { kind, data }] of Object.entries(loaded)) {
  if (kind !== "mock") continue;
  for (const entry of data.requests) {
    if (!entry.responseSchema || entry.response.json === undefined) continue;
    const check = dataAjv.compile(entry.responseSchema);
    if (!check(entry.response.json)) {
      fail(`${name}: ${entry.match.method} ${entry.match.url} does not match its responseSchema: ${dataAjv.errorsText(check.errors)}`);
    }
  }
}

// 4) Cross-references between the example files
const mockIds = new Set(
  Object.values(loaded).filter((f) => f.kind === "mock").map((f) => f.data.id),
);
const states = Object.values(loaded).find((f) => f.kind === "states")?.data.states ?? [];
const stateIds = new Set(states.map((s) => s.id));
if (stateIds.size !== states.length) fail("states.example.yaml: duplicate state ids");
for (const s of states) {
  if (s.opensFrom && !stateIds.has(s.opensFrom)) fail(`state ${s.id}: opensFrom "${s.opensFrom}" does not exist`);
  for (const m of s.mocks ?? []) if (!mockIds.has(m)) fail(`state ${s.id}: unknown mock "${m}"`);
}
for (const [name, { kind, data }] of Object.entries(loaded)) {
  if (kind !== "flow") continue;
  for (const m of data.mocks ?? []) if (!mockIds.has(m)) fail(`${name}: unknown mock "${m}"`);
  for (const step of data.steps) {
    if (step.capture && !stateIds.has(step.capture)) fail(`${name}: capture of unknown state "${step.capture}"`);
  }
}
const cfg = Object.values(loaded).find((f) => f.kind === "config")?.data;
if (cfg?.auth?.mock && !mockIds.has(cfg.auth.mock)) fail(`config: auth.mock "${cfg.auth.mock}" does not exist`);

if (failures) {
  console.error(`\n${failures} problem(s).`);
  process.exit(1);
}
console.log("\nAll schema checks passed.");
