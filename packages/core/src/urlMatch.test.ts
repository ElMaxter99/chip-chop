import { test } from "node:test";
import assert from "node:assert/strict";
import { matchUrl } from "./urlMatch.js";

test("exact path", () => {
  assert.equal(matchUrl("/api/passwords", "/api/passwords"), true);
  assert.equal(matchUrl("/api/passwords", "/api/passwords/1"), false);
});

test("origin, query string and trailing slash are ignored", () => {
  assert.equal(matchUrl("/api/passwords", "http://localhost:4200/api/passwords?page=2"), true);
  assert.equal(matchUrl("/api/passwords", "/api/passwords/"), true);
});

test(":param matches exactly one segment", () => {
  assert.equal(matchUrl("/api/passwords/:id", "/api/passwords/42"), true);
  assert.equal(matchUrl("/api/passwords/:id", "/api/passwords"), false);
  assert.equal(matchUrl("/api/passwords/:id", "/api/passwords/42/share"), false);
});

test("* stays inside a segment and ** crosses segments", () => {
  assert.equal(matchUrl("/api/files/*", "/api/files/a.png"), true);
  assert.equal(matchUrl("/api/files/*", "/api/files/a/b.png"), false);
  assert.equal(matchUrl("/api/**", "/api/files/a/b.png"), true);
});

test("regex characters in the pattern are literal", () => {
  assert.equal(matchUrl("/api/v1.0/items", "/api/v1.0/items"), true);
  assert.equal(matchUrl("/api/v1.0/items", "/api/v1x0/items"), false);
});
