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

test("an origin written in the pattern is ignored", () => {
  assert.equal(matchUrl("https://api.example.com/v1/items", "https://api.example.com/v1/items?x=1"), true);
  assert.equal(matchUrl("https://api.example.com/v1/items", "/v1/items"), true);
  assert.equal(matchUrl("http://localhost:3000/api/passwords/:id", "http://localhost:3000/api/passwords/7"), true);
  assert.equal(matchUrl("http://localhost:3000/api/passwords/:id", "/api/passwords"), false);
  assert.equal(matchUrl("https://api.example.com", "https://api.example.com/"), true);
});

test("AngularJS style requests: relative URL, $http params and $resource-like ids", () => {
  // $http.get("api/passwords", { params: { q: "a b", page: 2 } }) is sent as /api/passwords?page=2&q=a%20b
  assert.equal(matchUrl("/api/passwords", "http://localhost:4173/api/passwords?page=2&q=a%20b"), true);
  // $http.delete("/api/passwords/" + id) and a hash route in the page URL never reach the matcher
  assert.equal(matchUrl("/api/passwords/:id", "http://localhost:4173/api/passwords/3"), true);
  // $resource with a trailing-slash backend
  assert.equal(matchUrl("/api/passwords/:id", "/api/passwords/3/"), true);
});
