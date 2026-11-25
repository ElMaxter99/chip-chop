/**
 * AngularJS (1.x) support for the capture step.
 *
 * `angularJsStableInPage` runs INSIDE the page (it is serialised by Playwright's `page.evaluate`),
 * so it must not reference anything outside its own body. It is exported on its own so unit tests can
 * run it in Node against fakes of `window` and `document`.
 *
 * Why it exists: AngularJS renders in a digest after every $http response and after each template
 * ($templateRequest) a route needs. Between two requests of such a chain the network is quiet for a
 * few milliseconds, so "network idle" alone can fire halfway (a route template arrived, its data has
 * not been requested yet) and the screenshot shows "Loading…". `$browser.notifyWhenNoOutstandingRequests`
 * is the hook Protractor uses for the same purpose: it fires when $http, $templateRequest and
 * $timeout have nothing pending.
 *
 * Result:
 *   "no-angularjs"  the page does not use AngularJS (nothing was waited for)
 *   "no-injector"   AngularJS is there but its injector is not reachable (debugInfoEnabled(false) and
 *                   no ng-app element); the caller falls back to network idle alone
 *   "stable"        nothing pending
 *   "timeout"       something stayed pending for `maxMs` (e.g. a long $timeout used as a poller)
 */
export function angularJsStableInPage(maxMs: number): Promise<"no-angularjs" | "no-injector" | "stable" | "timeout"> {
  type Injector = { get(name: string): unknown; has?(name: string): boolean };
  type Ng = { element(el: unknown): { injector(): Injector | undefined } };
  const ng = (window as unknown as { angular?: Ng }).angular;
  if (!ng || typeof ng.element !== "function") return Promise.resolve("no-angularjs");

  const candidates: unknown[] = [
    ...Array.from(document.querySelectorAll("[ng-app],[data-ng-app],[x-ng-app]")),
    document.documentElement,
    document.body,
  ].filter(Boolean);
  let injector: Injector | undefined;
  for (const el of candidates) {
    try {
      injector = ng.element(el).injector();
    } catch {
      injector = undefined;
    }
    if (injector) break;
  }
  if (!injector) return Promise.resolve("no-injector");
  const inj = injector;

  const browser = inj.get("$browser") as { notifyWhenNoOutstandingRequests(cb: () => void): void };
  const http = (inj.has?.("$http") ?? true) ? (inj.get("$http") as { pendingRequests: unknown[] }) : undefined;

  // Date is frozen by chip-chop (clock.setFixedTime), so the deadline is a real timer, not a Date comparison.
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<void>((r) => {
    timer = setTimeout(() => {
      timedOut = true;
      r();
    }, maxMs);
  });
  const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  return (async () => {
    try {
      while (!timedOut) {
        await Promise.race([new Promise<void>((r) => browser.notifyWhenNoOutstandingRequests(r)), expired]);
        if (timedOut) break;
        // One more turn: the callbacks of the last response may have started the next request of the chain.
        await pause(30);
        if ((http?.pendingRequests.length ?? 0) === 0) {
          await pause(30);
          if ((http?.pendingRequests.length ?? 0) === 0) return "stable" as const;
        }
      }
      return "timeout" as const;
    } finally {
      clearTimeout(timer);
    }
  })();
}
