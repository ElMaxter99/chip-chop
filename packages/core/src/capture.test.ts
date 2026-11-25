import assert from "node:assert/strict";
import { test } from "node:test";
import { isStaticPath } from "./capture.js";

test("AngularJS templates and i18n files fetched by XHR are static, API calls are not", () => {
  assert.equal(isStaticPath("/views/home.html", []), true);
  assert.equal(isStaticPath("/app/partials/list.tpl.html", []), true);
  assert.equal(isStaticPath("/i18n/en.json", []), true);
  assert.equal(isStaticPath("/api/passwords", []), false);
  assert.equal(isStaticPath("/data/passwords.json", []), false);
  assert.equal(isStaticPath("/data/passwords.json", ["/data/**"]), true);
});
