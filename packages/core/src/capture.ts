import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
  type Route,
} from "playwright";
import { angularJsStableInPage } from "./angularjs.js";
import { downloadCached, matchGlob, placeholderPng, placeholderSize } from "./assets.js";
import type { Catalog } from "./catalog.js";
import { ensureDir, writeJson, writeText } from "./fsutil.js";
import { findMock } from "./mocks.js";
import type { PreparedTarget } from "./runner.js";
import type { CaptureResult, FlowStep, GraphEdge, Mock, RunInfo, State, Target, Viewport } from "./types.js";
import { matchUrl } from "./urlMatch.js";

/** Primera línea del error + el selector que esperaba (Playwright lo pone en «waiting for …») y la URL en la que se quedó. */
function describeStepAt(flow: { steps: FlowStep[] }, index: number): string {
  const st = flow.steps[index - 1];
  return st ? ("capture" in st ? `capture ${st.capture}` : describeStep(st)) : "?";
}
function errorDetail(e: unknown, url?: string): string {
  const msg = (e as Error).message ?? String(e);
  const first = msg.split("\n")[0] ?? "failed";
  const waiting = /waiting for (.+)/.exec(msg)?.[1]?.trim();
  return first + (waiting && !first.includes(waiting) ? ` · esperando ${waiting}` : "") + (url ? ` · URL: ${url}` : "");
}

export interface CaptureOptions {
  target: PreparedTarget;
  outDir: string;
  assetsDir: string;
  only?: string[];
  viewport?: string;
  headed?: boolean;
  log: (line: string) => void;
}

const STATIC_EXT = /\.(html?|m?js|css|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|map|txt|xml)$/i;
const STATIC_JSON_DIR = /\/(assets|static|i18n|locales?|lang)\//i;

interface Session {
  context: BrowserContext;
  page: Page;
  vp: Viewport;
  mocks: Mock[];
  requests: Set<string>;
  consoleErrors: string[];
  inflight: number;
  label: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function isStaticPath(pathname: string, passthrough: string[]): boolean {
  if (STATIC_EXT.test(pathname)) return true;
  if (/\.json$/i.test(pathname) && STATIC_JSON_DIR.test(pathname)) return true;
  return passthrough.some((g) => matchUrl(g, pathname));
}

export function describeStep(step: FlowStep): string {
  const t = (x: Target): string => {
    const parts = [x.role, x.name ? `"${x.name}"` : "", x.text ? `"${x.text}"` : "", x.testId ? `#${x.testId}` : "", x.selector ?? ""];
    return parts.filter(Boolean).join(" ");
  };
  if ("goto" in step) return `goto ${step.goto}`;
  if ("click" in step) return `click ${t(step.click)}`;
  if ("fill" in step) return `fill ${t(step.fill.target)}`;
  if ("select" in step) return `select "${step.select.option}" in ${t(step.select.target)}`;
  if ("press" in step) return `press ${step.press}`;
  if ("wait" in step) return "wait";
  return "capture";
}

export function resolveTarget(page: Page, t: Target): Locator {
  if (t.role) {
    const opts = t.name ? { name: t.name } : {};
    return page.getByRole(t.role as Parameters<Page["getByRole"]>[0], opts).first();
  }
  if (t.testId) return page.getByTestId(t.testId).first();
  if (t.text) return page.getByText(t.text).first();
  if (t.selector) return page.locator(t.selector).first();
  throw new Error("empty target");
}

export async function capture(opts: CaptureOptions): Promise<RunInfo> {
  const { target, outDir, assetsDir, log } = opts;
  const catalog: Catalog = target.catalog;
  const config = catalog.config;
  const baseUrl = target.baseUrl;
  const appOrigin = new URL(baseUrl).origin;

  const statesById = new Map<string, State>(catalog.states.map((s) => [s.id, s]));
  const mocksById = new Map<string, Mock>(catalog.mocks.map((m) => [m.id, m]));
  const authMock = config.auth?.mode === "mocked" && config.auth.mock ? config.auth.mock : undefined;

  const viewports = config.viewports.filter((v) => !opts.viewport || v.name === opts.viewport);
  if (viewports.length === 0) throw new Error(`viewport "${opts.viewport}" is not defined in config.yaml`);

  ensureDir(outDir);
  const results = new Map<string, CaptureResult>();
  const nodes = new Set<string>();
  const edges = new Map<string, GraphEdge>();
  const unmocked: RunInfo["unmocked"] = [];
  const assetFailures: RunInfo["assetFailures"] = [];

  const key = (id: string, vp: string): string => `${id}|${vp}`;
  const isOk = (id: string, vp: string): boolean => results.get(key(id, vp))?.ok === true;
  const fail = (id: string, vp: string, error: string): void => {
    if (!isOk(id, vp)) results.set(key(id, vp), { id, viewport: vp, ok: false, error });
  };

  const browser: Browser = await chromium.launch({ headless: !opts.headed });

  const seedScript = (seed: number): void => {
    let s = seed >>> 0;
    Math.random = function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  // Installed in every page from the start, not only right before the screenshot: libraries that wait for
  // transitionend/animationend (ngAnimate, UI Bootstrap modals) then finish at once instead of mid-way.
  const freezeAnimationsScript = (): void => {
    const add = (): void => {
      if (document.getElementById("__chipchop_style")) return;
      const style = document.createElement("style");
      style.id = "__chipchop_style";
      style.textContent = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}";
      (document.head ?? document.documentElement).appendChild(style);
    };
    if (document.documentElement) add();
    document.addEventListener("DOMContentLoaded", add);
  };
  const storageScript = (s: { local: Record<string, string>; session: Record<string, string> }): void => {
    try {
      for (const [k, v] of Object.entries(s.local)) localStorage.setItem(k, v);
      for (const [k, v] of Object.entries(s.session)) sessionStorage.setItem(k, v);
    } catch {
      /* storage not available in this frame */
    }
  };

  async function fulfillMock(route: Route, request: Request, entry: Mock["requests"][number]): Promise<void> {
    const r = entry.response;
    if (r.delayMs) await sleep(r.delayMs);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.headers ?? {})) headers[k.toLowerCase()] = v;
    let body: string | Buffer | undefined;
    if (r.json !== undefined) {
      body = JSON.stringify(r.json);
      headers["content-type"] ??= "application/json";
    } else if (r.text !== undefined) {
      body = r.text;
      headers["content-type"] ??= "text/plain; charset=utf-8";
    } else if (r.file) {
      body = readFileSync(join(assetsDir, r.file));
      headers["content-type"] ??= "application/octet-stream";
    }
    const origin = new URL(request.url()).origin;
    if (origin !== appOrigin) {
      headers["access-control-allow-origin"] = request.headers()["origin"] ?? appOrigin;
      headers["access-control-allow-credentials"] = "true";
      headers["access-control-allow-headers"] = "*";
      headers["access-control-allow-methods"] = "*";
    }
    await route.fulfill({ status: r.status, headers, ...(body !== undefined ? { body } : {}) });
  }

  async function openSession(vp: Viewport, mockIds: string[], label: string): Promise<Session> {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      locale: config.determinism.locale,
      timezoneId: config.determinism.timezone,
      reducedMotion: config.determinism.disableAnimations ? "reduce" : "no-preference",
      colorScheme: "light",
      serviceWorkers: "block",
      ignoreHTTPSErrors: true,
    });
    await context.clock.setFixedTime(new Date(config.determinism.fixedTime));
    await context.addInitScript(seedScript, config.determinism.randomSeed);
    if (config.determinism.disableAnimations) await context.addInitScript(freezeAnimationsScript);
    const storage = config.auth?.storage;
    if (storage?.localStorage || storage?.sessionStorage) {
      await context.addInitScript(storageScript, { local: storage.localStorage ?? {}, session: storage.sessionStorage ?? {} });
    }
    if (storage?.cookies?.length) {
      await context.addCookies(storage.cookies.map((c) => ({ name: c.name, value: c.value, url: baseUrl, path: c.path ?? "/" })));
    }

    const mocks: Mock[] = [];
    for (const id of mockIds) {
      const m = mocksById.get(id);
      if (m && !mocks.includes(m)) mocks.push(m);
    }
    const page = await context.newPage();
    const session: Session = { context, page, vp, mocks, requests: new Set(), consoleErrors: [], inflight: 0, label };

    page.on("request", (req) => {
      session.inflight++;
      const t = req.resourceType();
      if (t === "xhr" || t === "fetch") {
        const u = new URL(req.url());
        // Same-origin static files fetched by XHR (AngularJS templateUrl, i18n JSON) are not API calls:
        // moving a template in a restyle must not look like a structural change.
        if (u.origin === appOrigin && isStaticPath(u.pathname, config.passthrough)) return;
        session.requests.add(`${req.method()} ${u.pathname}`);
      }
    });
    page.on("requestfinished", () => void (session.inflight = Math.max(0, session.inflight - 1)));
    page.on("requestfailed", () => void (session.inflight = Math.max(0, session.inflight - 1)));
    page.on("console", (msg) => {
      if (msg.type() === "error") session.consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => session.consoleErrors.push(`uncaught: ${err.message}`));

    await context.route("**/*", async (route, request) => {
      const url = request.url();
      if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("about:")) return route.continue();
      const method = request.method();
      const type = request.resourceType();
      const u = new URL(url);
      const sameOrigin = u.origin === appOrigin;
      try {
        const isApi = type === "fetch" || type === "xhr";
        if (isApi) {
          const hit = findMock(session.mocks, { method, url, postData: request.postData() });
          if (hit) return await fulfillMock(route, request, hit.entry);
          if (sameOrigin && isStaticPath(u.pathname, config.passthrough)) return await route.continue();
          if (method === "OPTIONS") return await route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
          unmocked.push({ state: session.label, method, url: `${u.pathname}${u.search}` });
          return await route.abort("failed");
        }
        if (sameOrigin) return await route.continue();

        // Anything below is hosted outside the app.
        if (type === "image") {
          const mode = config.externalAssets.mode;
          if (mode === "block") return await route.abort("blockedbyclient");
          if (mode === "download") {
            const a = await downloadCached(assetsDir, url);
            return await route.fulfill({ status: a.status, headers: { "content-type": a.contentType }, body: a.body });
          }
          const { width, height } = placeholderSize(config, url);
          return await route.fulfill({ status: 200, headers: { "content-type": "image/png" }, body: placeholderPng(width, height) });
        }
        if (type === "document") return await route.abort("blockedbyclient");
        const other = config.externalAssets.other;
        if (other === "passthrough") return await route.continue();
        if (other === "block") return await route.abort("blockedbyclient");
        const a = await downloadCached(assetsDir, url);
        return await route.fulfill({ status: a.status, headers: { "content-type": a.contentType, "access-control-allow-origin": "*" }, body: a.body });
      } catch (e) {
        assetFailures.push({ url, error: (e as Error).message });
        try {
          await route.abort("failed");
        } catch {
          /* route already handled */
        }
      }
    });
    return session;
  }

  async function waitIdle(s: Session, idleMs: number, maxMs = 15000): Promise<void> {
    const deadline = Date.now() + maxMs;
    let quietSince = Date.now();
    while (Date.now() < deadline) {
      if (s.inflight > 0) quietSince = Date.now();
      else if (Date.now() - quietSince >= idleMs) return;
      await sleep(50);
    }
  }

  /** AngularJS pages: wait for $http / templates / $timeout to drain (no-op for any other page). */
  async function waitAngularJs(s: Session): Promise<void> {
    await s.page.evaluate(angularJsStableInPage, 5000).catch(() => {});
  }

  async function waitReady(s: Session, state?: State): Promise<void> {
    await s.page.waitForLoadState("load").catch(() => {});
    await waitIdle(s, state?.ready?.networkIdleMs ?? config.ready.networkIdleMs);
    await waitAngularJs(s);
    if (state?.ready?.visible) {
      await resolveTarget(s.page, state.ready.visible).waitFor({ state: "visible", timeout: 15000 });
    }
    await s.page.evaluate(() => (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready).catch(() => {});
    await sleep(config.ready.settleMs);
  }

  async function runStep(s: Session, step: FlowStep): Promise<void> {
    if ("goto" in step) {
      await s.page.goto(new URL(step.goto, baseUrl).toString(), { waitUntil: "load", timeout: 30000 });
    } else if ("click" in step) {
      await resolveTarget(s.page, step.click).click({ timeout: 10000 });
    } else if ("fill" in step) {
      await resolveTarget(s.page, step.fill.target).fill(step.fill.value, { timeout: 10000 });
    } else if ("select" in step) {
      await resolveTarget(s.page, step.select.target).selectOption({ label: step.select.option }, { timeout: 10000 });
    } else if ("press" in step) {
      await s.page.keyboard.press(step.press);
    } else if ("wait" in step) {
      if (step.wait.visible) await resolveTarget(s.page, step.wait.visible).waitFor({ state: "visible", timeout: 15000 });
      if (step.wait.hidden) await resolveTarget(s.page, step.wait.hidden).waitFor({ state: "hidden", timeout: 15000 });
      if (step.wait.networkIdleMs !== undefined) await waitIdle(s, step.wait.networkIdleMs);
    }
    if (!("capture" in step)) {
      await waitIdle(s, Math.min(300, config.ready.networkIdleMs));
      await waitAngularJs(s);
    }
  }

  async function takeCapture(s: Session, state: State): Promise<void> {
    await waitReady(s, state);
    await s.page.evaluate(() => {
      if (document.getElementById("__chipchop_style")) return;
      const style = document.createElement("style");
      style.id = "__chipchop_style";
      style.textContent = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}";
      document.documentElement.appendChild(style);
    });
    const masks = (state.mask ?? []).map((m) => resolveTarget(s.page, m));
    const png = await s.page.screenshot({ fullPage: true, animations: "disabled", caret: "hide", mask: masks, maskColor: "#ff00ff" });
    const aria = await s.page.locator("body").ariaSnapshot();
    const base = join(outDir, `${state.id}.${s.vp.name}`);
    writeFileSync(`${base}.png`, png);
    writeText(`${base}.aria.yml`, aria + "\n");
    writeJson(`${base}.requests.json`, [...s.requests].sort());
    writeJson(`${base}.console.json`, [...new Set(s.consoleErrors)].sort());
    writeJson(`${base}.meta.json`, {
      id: state.id,
      title: state.title,
      kind: state.kind,
      viewport: s.vp.name,
      url: s.page.url().replace(baseUrl, ""),
      pageTitle: await s.page.title(),
    });
    s.requests.clear();
    s.consoleErrors.length = 0;
    results.set(key(state.id, s.vp.name), { id: state.id, viewport: s.vp.name, ok: true });
    nodes.add(state.id);
    log(`  captured ${state.id} [${s.vp.name}]`);
  }

  const vpAllowed = (state: State, vp: Viewport): boolean => !state.viewports || state.viewports.includes(vp.name);
  const addEdge = (from: string, to: string, via: string[]): void => {
    if (from === to) return;
    const k = `${from}->${to}`;
    if (!edges.has(k)) edges.set(k, { from, to, ...(via.length ? { via: via.join(", then ") } : {}) });
  };

  const only = opts.only && opts.only.length > 0 ? new Set(opts.only) : undefined;

  try {
    // ---- 1) flows
    if (!only) {
      const flows = [...catalog.flows].sort((a, b) => a.id.localeCompare(b.id));
      for (const flow of flows) {
        for (const vp of viewports) {
          if (flow.viewports && !flow.viewports.includes(vp.name)) continue;
          log(`flow ${flow.id} [${vp.name}]`);
          const session = await openSession(vp, [...(flow.mocks ?? []), ...(authMock ? [authMock] : [])], `flow:${flow.id}`);
          let prev: string | undefined;
          let via: string[] = [];
          let index = 0;
          try {
            for (const step of flow.steps) {
              index++;
              if ("capture" in step) {
                const state = statesById.get(step.capture);
                if (!state) throw new Error(`unknown state "${step.capture}"`);
                if (!vpAllowed(state, vp)) continue;
                session.label = state.id;
                if (!isOk(state.id, vp.name)) await takeCapture(session, state);
                else await waitReady(session, state);
                if (prev) addEdge(prev, state.id, via);
                prev = state.id;
                via = [];
              } else {
                via.push(describeStep(step));
                await runStep(session, step);
              }
            }
          } catch (e) {
            const message = `flow "${flow.id}" failed at step ${index} (${describeStepAt(flow, index)}): ${errorDetail(e, session.page.url())}`;
            log(`  ${message}`);
            flow.steps.slice(index - 1).forEach((st) => {
              if ("capture" in st) fail(st.capture, vp.name, message);
            });
          } finally {
            await session.context.close();
          }
        }
      }
    }

    // ---- 2) states that no flow reached (or that failed inside a flow)
    const wanted = catalog.states.filter((s) => !only || only.has(s.id));
    for (const state of wanted) {
      for (const vp of viewports) {
        if (!vpAllowed(state, vp) || isOk(state.id, vp.name)) continue;
        const chain: State[] = [];
        for (let cur: State | undefined = state; cur; cur = cur.opensFrom ? statesById.get(cur.opensFrom) : undefined) {
          chain.unshift(cur);
          if (chain.length > 20) break;
        }
        const root = chain[0]!;
        if (root.kind !== "page" || !root.route) {
          fail(state.id, vp.name, `cannot reach: "${root.id}" is not a page with a route`);
          continue;
        }
        log(`state ${state.id} [${vp.name}]`);
        const mockIds = [...chain.slice().reverse().flatMap((s) => s.mocks ?? []), ...(authMock ? [authMock] : [])];
        const session = await openSession(vp, mockIds, state.id);
        try {
          await session.page.goto(new URL(root.route, baseUrl).toString(), { waitUntil: "load", timeout: 30000 });
          await waitReady(session, root);
          for (let i = 1; i < chain.length; i++) {
            const via = (chain[i]!.via ?? []).filter((st) => !("capture" in st));
            for (const step of via) await runStep(session, step);
            addEdge(chain[i - 1]!.id, chain[i]!.id, via.map(describeStep));
          }
          await takeCapture(session, state);
        } catch (e) {
          const message = errorDetail(e, session.page.url());
          log(`  failed: ${message}`);
          fail(state.id, vp.name, message);
        } finally {
          await session.context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }

  const info: RunInfo = {
    label: target.label,
    ...(target.ref ? { ref: target.ref } : {}),
    ...(target.commit ? { commit: target.commit } : {}),
    baseUrl,
    catalogSource: target.catalogSource,
    states: catalog.states.map((s) => ({ id: s.id, kind: s.kind, title: s.title })),
    viewports: viewports.map((v) => v.name),
    results: [...results.values()].sort((a, b) => key(a.id, a.viewport).localeCompare(key(b.id, b.viewport))),
    graph: { nodes: [...nodes].sort(), edges: [...edges.values()].sort((a, b) => `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`)) },
    unmocked: dedupeUnmocked(unmocked),
    assetFailures,
  };
  writeJson(join(outDir, "run.json"), info);
  return info;
}

function dedupeUnmocked(list: RunInfo["unmocked"]): RunInfo["unmocked"] {
  const seen = new Set<string>();
  return list.filter((u) => {
    const k = `${u.state}|${u.method}|${u.url}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export { matchGlob };
