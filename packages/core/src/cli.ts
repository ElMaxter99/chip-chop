#!/usr/bin/env node
// chip-chop CLI. The commands below are the planned surface; they are stubs
// until the engine is implemented (see docs/ROADMAP.md).

const COMMANDS: Record<string, string> = {
  init: "Create a .chipchop/ folder with config, states and flows for the current app",
  validate: "Check config, states, flows and mocks against the schemas and each other",
  capture: "Build and serve a git ref, replay mocks, capture every state (PNG, ARIA, requests)",
  compare: "Capture two refs and write the comparison report",
  report: "Render HTML/Markdown from an existing comparison",
  graph: "Print the flow graph (Mermaid) of the catalog",
};

function help(): string {
  const lines = Object.entries(COMMANDS).map(([name, text]) => `  ${name.padEnd(9)} ${text}`);
  return [
    "chip-chop - capture every UI state on two git refs and compare them",
    "",
    "Usage: chip-chop <command> [options]",
    "",
    "Commands:",
    ...lines,
    "",
    "Status: pre-alpha. Commands are not implemented yet.",
  ].join("\n");
}

const [command] = process.argv.slice(2);

if (!command || command === "--help" || command === "-h") {
  console.log(help());
} else if (command in COMMANDS) {
  console.error(`chip-chop ${command}: not implemented yet (pre-alpha).`);
  process.exitCode = 2;
} else {
  console.error(`Unknown command "${command}".\n\n${help()}`);
  process.exitCode = 1;
}
