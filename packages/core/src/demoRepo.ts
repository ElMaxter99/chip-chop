import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const demo = resolve(here, "../../../examples/static-demo");

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdio: "pipe" });
}

export function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "chipchop-demo-"));
  git(dir, "init", "-q", "-b", "develop");
  const put = (from: string, to = "") => cpSync(join(demo, from), join(dir, to), { recursive: true });
  put("base", "");
  put("server.mjs", "server.mjs");
  put("chipchop-base", ".chipchop");
  writeFileSync(join(dir, ".gitignore"), ".chipchop/runs/\n.chipchop/reports/\n.chipchop/assets/\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "base");
  git(dir, "branch", "restyle");
  git(dir, "branch", "feature");
  git(dir, "checkout", "-q", "restyle");
  cpSync(join(demo, "restyle/style.css"), join(dir, "style.css"));
  git(dir, "commit", "-qam", "restyle");
  git(dir, "checkout", "-q", "feature");
  cpSync(join(demo, "feature/app.js"), join(dir, "app.js"));
  cpSync(join(demo, "feature/style.css"), join(dir, "style.css"));
  rmSync(join(dir, ".chipchop"), { recursive: true });
  cpSync(join(demo, "chipchop-feature"), join(dir, ".chipchop"), { recursive: true });
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "feature");
  git(dir, "checkout", "-q", "develop");
  return dir;
}


const angularDemo = resolve(here, "../../../examples/angularjs-demo");

/** Where `npm install --prefix examples/angularjs-demo` puts AngularJS (the demo's own dependency). */
export const angularJsDemoModules = join(angularDemo, "node_modules");

export function angularJsInstalled(): boolean {
  return existsSync(join(angularJsDemoModules, "angular", "angular.min.js")) && existsSync(join(angularJsDemoModules, "angular-route", "angular-route.min.js"));
}

/**
 * Temp git repo with the AngularJS demo: `develop` (base), `restyle` (CSS only) and `feature`
 * (CSS + a share dialog and its flow, with its own .chipchop). AngularJS itself is NOT in the repo:
 * the app's build step (`node build.mjs`) copies it from npm into vendor/ in every checkout.
 */
export function makeAngularJsRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "chipchop-angularjs-"));
  const demoFile = (...p: string[]): string => join(angularDemo, ...p);
  git(dir, "init", "-q", "-b", "develop");
  cpSync(demoFile("base"), dir, { recursive: true });
  for (const f of ["server.mjs", "build.mjs", "package.json"]) cpSync(demoFile(f), join(dir, f));
  cpSync(demoFile("chipchop-base"), join(dir, ".chipchop"), { recursive: true });
  writeFileSync(join(dir, ".gitignore"), "node_modules/\nvendor/\n.chipchop/runs/\n.chipchop/reports/\n.chipchop/assets/\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "base");
  git(dir, "branch", "restyle");
  git(dir, "branch", "feature");
  git(dir, "checkout", "-q", "restyle");
  cpSync(demoFile("restyle", "style.css"), join(dir, "style.css"));
  git(dir, "commit", "-qam", "restyle");
  git(dir, "checkout", "-q", "feature");
  cpSync(demoFile("feature"), dir, { recursive: true });
  rmSync(join(dir, ".chipchop"), { recursive: true });
  cpSync(demoFile("chipchop-feature"), join(dir, ".chipchop"), { recursive: true });
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "feature");
  git(dir, "checkout", "-q", "develop");
  return dir;
}
