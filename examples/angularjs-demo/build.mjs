// "Build" step of the demo: copies AngularJS from its npm packages into vendor/.
// It looks in ./node_modules first and then in NODE_PATH, so a checkout without its own
// node_modules (chip-chop's e2e test does not run `npm install` per ref) can still be built.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

const roots = [resolve("node_modules"), ...(process.env.NODE_PATH ?? "").split(delimiter).filter(Boolean)];
const files = [
  ["angular", "angular.min.js"],
  ["angular-route", "angular-route.min.js"],
];

mkdirSync("vendor", { recursive: true });
for (const [pkg, file] of files) {
  const root = roots.find((r) => existsSync(join(r, pkg, file)));
  if (!root) {
    console.error(`${pkg}/${file} not found in: ${roots.join(", ")}. Run "npm install" first.`);
    process.exit(1);
  }
  copyFileSync(join(root, pkg, file), join("vendor", file));
  console.log(`vendor/${file} <- ${join(root, pkg)}`);
}
