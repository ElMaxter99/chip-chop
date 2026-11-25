import { cpSync } from "node:fs";
import { join } from "node:path";
import { chipDir, skillsDir } from "./paths.js";
import { ensureDir, exists, writeText } from "./fsutil.js";
import type { Framework } from "./types.js";

export interface InitOptions {
  framework: Framework;
  force?: boolean;
}

const FRAMEWORK_HINT: Record<Framework, string> = {
  angularjs: "AngularJS (1.x): hash routes look like /#!/login. Legacy builds may need an old Node (build.nodeVersion).",
  angular: "Angular: routes are in *.routes.ts / *-routing.module.ts. `ng build` output needs a history-API fallback when served.",
  react: "React: find the router (React Router, Next.js, ...). Server-rendered data cannot be mocked from the browser.",
  other: "Any other web app. Follow the general method in ai/guides/states-and-flows.md.",
};

function configTemplate(framework: Framework): string {
  return `# chip-chop configuration. Edit the TODO lines, or let the AI fill them in
# (\`chip-chop ai run\` or the "Generate" tab in \`chip-chop ui\`).
# ${FRAMEWORK_HINT[framework]}
app: My App            # TODO: app name shown in reports
framework: ${framework}

build:
  install: npm ci      # TODO: how to install dependencies (leave empty if already installed)
  command: npm run build   # TODO: how to build the app
  # nodeVersion: "14"  # legacy builds: needs nvm available on this machine

serve:
  command: npx --yes http-server dist -p {port} -s   # TODO: serve the build output
  url: http://localhost:{port}
  readyPath: /
  timeoutMs: 120000

viewports:
  - { name: desktop, width: 1440, height: 900 }

determinism:
  fixedTime: "2026-01-15T10:00:00Z"
  timezone: UTC
  locale: en-US

# Login is always mocked. "none" means the app opens without logging in.
auth:
  mode: none
  # mode: mocked
  # mock: auth/login-ok
  # storage:
  #   localStorage:
  #     token: mock-token

# Same-origin XHR/fetch that are really static files of the app
# (templates, i18n JSON). Common static extensions are already allowed.
passthrough: []

externalAssets:
  mode: placeholder    # images: placeholder | download | block
  other: download      # scripts, styles, fonts from CDNs: download | passthrough | block
  defaultSize: { width: 300, height: 200 }
  sizes: []
  #  - { match: "**/banner.png", width: 1500, height: 80 }
`;
}

const STATES_TEMPLATE = `# Every capturable state of the app (pages, modals, drawers, tabs).
# This is a starter: the AI replaces it with the real catalog.
states:
  - id: home
    title: Home
    kind: page
    route: /
`;

const FLOW_TEMPLATE = `id: home
title: Open the home page
steps:
  - goto: /
  - capture: home
`;

const AI_TEMPLATE = `# Which AI CLI runs each stage, and with which model.
# Model names are free text: they are passed to the CLI untouched.
providers:
  claude:
    type: claude
    command: claude
  copilot:
    type: copilot
    command: copilot

stages:
  discover: { provider: claude, model: sonnet }   # routes and overlays -> states.yaml
  flows:    { provider: claude, model: haiku }    # journeys -> flows/
  mocks:    { provider: claude, model: sonnet }   # typed API responses -> mocks/
  repair:   { provider: claude, model: sonnet }   # fixes validation errors

settings:
  maxRepairs: 3
  # promptsDir: .chipchop/ai/prompts
`;

export function initProject(appDir: string, opts: InitOptions): { created: string[]; skipped: string[] } {
  const dir = chipDir(appDir);
  const created: string[] = [];
  const skipped: string[] = [];

  const put = (rel: string, content: string): void => {
    const p = join(dir, rel);
    if (exists(p) && !opts.force) {
      skipped.push(rel);
      return;
    }
    writeText(p, content);
    created.push(rel);
  };

  put("config.yaml", configTemplate(opts.framework));
  put("states.yaml", STATES_TEMPLATE);
  put("flows/home.flow.yaml", FLOW_TEMPLATE);
  put("mocks/.gitkeep", "");
  put("ai.yaml", AI_TEMPLATE);
  put(".gitignore", "runs/\nreports/\n");

  // The guides travel with the app so any AI that opens this repo can read them.
  const aiDir = join(dir, "ai");
  if (!exists(join(aiDir, "SKILL.md")) || opts.force) {
    ensureDir(aiDir);
    cpSync(join(skillsDir, "SKILL.md"), join(aiDir, "SKILL.md"));
    cpSync(join(skillsDir, "guides"), join(aiDir, "guides"), { recursive: true });
    created.push("ai/SKILL.md", "ai/guides/");
  } else {
    skipped.push("ai/");
  }
  return { created, skipped };
}
