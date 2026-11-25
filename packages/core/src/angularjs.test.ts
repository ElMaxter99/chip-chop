import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { angularJsStableInPage } from "./angularjs.js";

// angularJsStableInPage runs in a browser; here `window` and `document` are fakes.
const g = globalThis as unknown as { window?: unknown; document?: unknown };

afterEach(() => {
  delete g.window;
  delete g.document;
});

function fakePage(opts: { injector?: unknown; angular?: boolean }): void {
  g.document = { querySelectorAll: () => [], documentElement: {}, body: {} };
  g.window = opts.angular === false ? {} : { angular: { element: () => ({ injector: () => opts.injector }) } };
}

/** $browser whose outstanding requests drain after `ms`; $http.pendingRequests is whatever the test sets. */
function fakeInjector(drainMs: number, pending: { length: number }) {
  const calls = { notified: 0 };
  const services: Record<string, unknown> = {
    $browser: {
      notifyWhenNoOutstandingRequests(cb: () => void) {
        calls.notified++;
        setTimeout(cb, drainMs).unref();
      },
    },
    $http: { pendingRequests: { get length() { return pending.length; } } },
  };
  return { injector: { get: (n: string) => services[n], has: (n: string) => n in services }, calls };
}

test("a page without AngularJS is left alone", async () => {
  fakePage({ angular: false });
  assert.equal(await angularJsStableInPage(1000), "no-angularjs");
});

test("AngularJS without a reachable injector falls back to the caller's own wait", async () => {
  fakePage({ injector: undefined });
  assert.equal(await angularJsStableInPage(1000), "no-injector");
});

test("waits until $browser reports no outstanding requests", async () => {
  const { injector, calls } = fakeInjector(120, { length: 0 });
  fakePage({ injector });
  const start = performance.now();
  assert.equal(await angularJsStableInPage(5000), "stable");
  assert.ok(performance.now() - start >= 100, "returned before the request drained");
  assert.equal(calls.notified, 1);
});

test("keeps waiting while $http still has pending requests", async () => {
  const pending = { length: 1 };
  const { injector, calls } = fakeInjector(10, pending);
  fakePage({ injector });
  setTimeout(() => void (pending.length = 0), 250).unref();
  const start = performance.now();
  assert.equal(await angularJsStableInPage(5000), "stable");
  assert.ok(performance.now() - start >= 240);
  assert.ok(calls.notified > 1, "should have asked $browser again");
});

test("gives up after maxMs when something never settles (e.g. a polling $timeout)", async () => {
  const { injector } = fakeInjector(60_000, { length: 0 });
  fakePage({ injector });
  assert.equal(await angularJsStableInPage(150), "timeout");
});
