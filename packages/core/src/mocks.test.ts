import { test } from "node:test";
import assert from "node:assert/strict";
import { findMock, isSubset } from "./mocks.js";
import type { Mock } from "./types.js";

const list: Mock = {
  id: "passwords/list",
  requests: [
    { match: { method: "GET", url: "/api/passwords" }, response: { status: 200, json: ["all"] } },
    { match: { method: "GET", url: "/api/passwords", query: { page: "2" } }, response: { status: 200, json: ["page2"] } },
    { match: { method: "POST", url: "/api/graphql", bodyContains: { operationName: "Me" } }, response: { status: 200, json: { me: 1 } } },
  ],
};
const empty: Mock = {
  id: "passwords/empty",
  requests: [{ match: { method: "GET", url: "/api/passwords" }, response: { status: 200, json: [] } }],
};

test("matches by method and path, ignoring origin", () => {
  const hit = findMock([list], { method: "GET", url: "http://localhost:4200/api/passwords" });
  assert.deepEqual(hit?.entry.response.json, ["all"]);
  assert.equal(findMock([list], { method: "DELETE", url: "/api/passwords" }), undefined);
});

test("the more specific entry wins inside a mock", () => {
  const hit = findMock([list], { method: "GET", url: "/api/passwords?page=2" });
  assert.deepEqual(hit?.entry.response.json, ["page2"]);
});

test("earlier mocks take priority over later ones", () => {
  const hit = findMock([empty, list], { method: "GET", url: "/api/passwords" });
  assert.deepEqual(hit?.entry.response.json, []);
});

test("bodyContains matches a JSON subset (GraphQL operations)", () => {
  const body = JSON.stringify({ operationName: "Me", query: "{ me { id } }" });
  assert.ok(findMock([list], { method: "POST", url: "/api/graphql", postData: body }));
  assert.equal(
    findMock([list], { method: "POST", url: "/api/graphql", postData: JSON.stringify({ operationName: "Other" }) }),
    undefined,
  );
});

test("isSubset handles nested objects and arrays", () => {
  assert.equal(isSubset({ a: { b: 1 } }, { a: { b: 1, c: 2 } }), true);
  assert.equal(isSubset({ a: [1, 2] }, { a: [1, 2, 3] }), false);
});
