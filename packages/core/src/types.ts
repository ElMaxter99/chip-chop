// TypeScript view of the JSON Schemas in packages/schemas.
// The schemas are the source of truth; keep these in sync with them.

export type Framework = "angularjs" | "angular" | "react" | "other";

export interface Target {
  role?: string;
  name?: string;
  text?: string;
  testId?: string;
  selector?: string;
}

export interface Viewport {
  name: string;
  width: number;
  height: number;
}

export interface Config {
  app: string;
  framework: Framework;
  build?: { install?: string; command?: string; cwd?: string; nodeVersion?: string };
  serve: { command: string; url: string; readyPath?: string; timeoutMs?: number };
  viewports?: Viewport[];
  determinism?: {
    fixedTime?: string;
    timezone?: string;
    locale?: string;
    disableAnimations?: boolean;
    randomSeed?: number;
  };
  auth?: {
    mode?: "mocked" | "storage" | "none";
    mock?: string;
    storage?: {
      localStorage?: Record<string, string>;
      sessionStorage?: Record<string, string>;
      cookies?: { name: string; value: string; path?: string }[];
    };
  };
  passthrough?: string[];
  externalAssets?: {
    mode?: "placeholder" | "download" | "block";
    other?: "download" | "passthrough" | "block";
    defaultSize?: { width?: number; height?: number };
    sizes?: { match: string; width: number; height: number }[];
  };
  ready?: { networkIdleMs?: number; settleMs?: number };
  compare?: {
    pixelThreshold?: number;
    maxDiffPixelRatio?: number;
    ignoreAntialiasing?: boolean;
    structural?: { aria?: boolean; requests?: boolean; consoleErrors?: boolean };
  };
}

export type StateKind = "page" | "modal" | "drawer" | "tab" | "state";

export interface State {
  id: string;
  title: string;
  kind: StateKind;
  description?: string;
  route?: string;
  opensFrom?: string;
  via?: FlowStep[];
  mocks?: string[];
  ready?: { visible?: Target; networkIdleMs?: number };
  mask?: Target[];
  viewports?: string[];
  source?: { file?: string; symbol?: string };
}

export interface StatesCatalog {
  states: State[];
}

export type FlowStep =
  | { goto: string; note?: string }
  | { click: Target; note?: string }
  | { fill: { target: Target; value: string }; note?: string }
  | { select: { target: Target; option: string }; note?: string }
  | { press: string; note?: string }
  | { wait: { visible?: Target; hidden?: Target; networkIdleMs?: number }; note?: string }
  | { capture: string; note?: string };

export interface Flow {
  id: string;
  title: string;
  description?: string;
  mocks?: string[];
  viewports?: string[];
  steps: FlowStep[];
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface MockEntry {
  match: {
    method: HttpMethod;
    url: string;
    query?: Record<string, string>;
    bodyContains?: Record<string, unknown>;
  };
  response: {
    status: number;
    headers?: Record<string, string>;
    json?: unknown;
    text?: string;
    file?: string;
    delayMs?: number;
  };
  responseSchema?: Record<string, unknown>;
}

export interface Mock {
  id: string;
  description?: string;
  scenario?: string;
  generatedFrom?: { file: string; symbol?: string }[];
  requests: MockEntry[];
}

export type StateStatus = "identical" | "visual-only" | "structural" | "added" | "removed" | "failed";

export interface StateResult {
  id: string;
  viewport: string;
  status: StateStatus;
  visual?: {
    diffPixels?: number;
    diffRatio?: number;
    baseImage?: string;
    headImage?: string;
    diffImage?: string;
  };
  structural?: {
    ariaChanged?: boolean;
    requestsAdded?: string[];
    requestsRemoved?: string[];
    newConsoleErrors?: string[];
  };
  error?: string;
}

export interface Report {
  app: string;
  base: { name: string; commit?: string };
  head: { name: string; commit?: string };
  mode: "restyle" | "flow-audit";
  generatedAt: string;
  summary: {
    identical: number;
    visualOnly: number;
    structural: number;
    added: number;
    removed: number;
    failed: number;
  };
  states: StateResult[];
  unmockedRequests?: { ref: "base" | "head"; state: string; method: string; url: string }[];
  flowGraph?: {
    addedStates?: string[];
    removedStates?: string[];
    addedTransitions?: { from: string; to: string; via?: string }[];
    removedTransitions?: { from: string; to: string; via?: string }[];
  };
}

// ---------- AI settings ----------

export type StageName = "discover" | "flows" | "mocks" | "repair";

export interface ProviderConfig {
  type: "claude" | "copilot" | "codex" | "custom";
  command?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
  allowedTools?: string[];
  permissionMode?: string;
  /** codex only: read-only | workspace-write | danger-full-access. Default: workspace-write. */
  sandbox?: string;
  allowTools?: string[];
  denyTools?: string[];
  args?: string[];
  promptVia?: "arg" | "stdin";
}

export interface StageConfig {
  provider: string;
  model?: string;
  extraArgs?: string[];
}

export interface AiSettings {
  providers?: Record<string, ProviderConfig>;
  stages?: Partial<Record<StageName, StageConfig>>;
  settings?: { maxRepairs?: number; promptsDir?: string };
}

// ---------- Capture runs ----------

export interface CaptureResult {
  id: string;
  viewport: string;
  ok: boolean;
  error?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  via?: string;
}

export interface RunInfo {
  label: string;
  ref?: string;
  commit?: string;
  baseUrl: string;
  catalogSource: "cwd" | "ref";
  states: { id: string; kind: StateKind; title: string }[];
  viewports: string[];
  results: CaptureResult[];
  graph: { nodes: string[]; edges: GraphEdge[] };
  unmocked: { state: string; method: string; url: string }[];
  assetFailures: { url: string; error: string }[];
}
