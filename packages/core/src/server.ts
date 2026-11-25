import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { loadAiConfig, runAi, testProvider } from "./ai.js";
import { hasCatalog } from "./catalog.js";
import { doctor } from "./doctor.js";
import { exists, writeText } from "./fsutil.js";
import { initProject } from "./init.js";
import { runCapture, runCompare } from "./pipeline.js";
import { listRefs } from "./runner.js";
import { chipDir, uiDir } from "./paths.js";
import type { StageName } from "./types.js";
import { formatIssues, validateCatalogDir } from "./validate.js";
import { stringify } from "yaml";
import { checkForUpdate, getChannel, installUpdate, setChannel } from "./updater.js";

interface Job {
  id: string;
  title: string;
  status: "running" | "done" | "failed";
  lines: string[];
  listeners: Set<ServerResponse>;
  result?: unknown;
}

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".md": "text/markdown; charset=utf-8", ".svg": "image/svg+xml" };

export interface UiServer {
  server: Server;
  url: string;
  token: string;
  close(): Promise<void>;
}

export async function startUi(appDir: string, port = 0): Promise<UiServer> {
  const token = randomBytes(16).toString("hex");
  const jobs = new Map<string, Job>();
  let current: Job | undefined;

  const send = (res: ServerResponse, code: number, body: unknown): void => {
    res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));
  };
  const body = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  };
  const emit = (job: Job, line: string): void => {
    job.lines.push(line);
    for (const l of job.listeners) l.write(`data: ${JSON.stringify(line)}\n\n`);
  };
  const start = (title: string, fn: (log: (l: string) => void) => Promise<unknown>): Job => {
    if (current?.status === "running") throw new Error("another job is still running");
    const job: Job = { id: randomBytes(4).toString("hex"), title, status: "running", lines: [], listeners: new Set() };
    jobs.set(job.id, job);
    current = job;
    fn((l) => emit(job, l))
      .then((r) => {
        job.result = r;
        job.status = "done";
      })
      .catch((e: Error) => {
        emit(job, `error: ${e.message}`);
        job.status = "failed";
      })
      .finally(() => {
        for (const l of job.listeners) {
          l.write(`event: end\ndata: ${JSON.stringify(job.status)}\n\n`);
          l.end();
        }
      });
    return job;
  };

  const reportsRoot = join(chipDir(appDir), "reports");
  const server = createServer(async (req, res) => {
    try {
      const u = new URL(req.url ?? "/", "http://localhost");
      // DNS-rebinding guard: only loopback host names are served.
      const host = (req.headers.host ?? "").replace(/:\d+$/, "");
      if (host !== "127.0.0.1" && host !== "localhost") return void send(res, 403, { error: "bad host" });
      const cookieOk = (req.headers.cookie ?? "").split(/;\s*/).includes(`cc=${token}`);
      const authed = u.searchParams.get("token") === token || req.headers["x-chipchop-token"] === token || cookieOk;

      if (u.pathname === "/" || u.pathname === "/index.html" || u.pathname === "/app.js" || u.pathname === "/style.css") {
        const f = join(uiDir, u.pathname === "/" ? "index.html" : u.pathname.slice(1));
        res.writeHead(200, { "content-type": MIME[extname(f)] ?? "text/plain", "cache-control": "no-store", ...(u.searchParams.get("token") === token ? { "set-cookie": `cc=${token}; HttpOnly; SameSite=Strict; Path=/` } : {}) }).end(readFileSync(f));
        return;
      }
      if (!authed) return void send(res, 401, { error: "missing or wrong token" });

      if (u.pathname.startsWith("/reports/")) {
        const file = resolve(reportsRoot, "." + decodeURIComponent(u.pathname.slice("/reports".length)));
        if (!file.startsWith(reportsRoot + sep) || !exists(file) || statSync(file).isDirectory()) return void send(res, 404, { error: "not found" });
        res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
        return;
      }

      if (u.pathname === "/api/project" && req.method === "GET") {
        const refs = (() => {
          try {
            return listRefs(appDir);
          } catch {
            return { branches: [], tags: [] };
          }
        })();
        const reports = exists(reportsRoot) ? readdirSync(reportsRoot).filter((d) => exists(join(reportsRoot, d, "report.html"))) : [];
        return void send(res, 200, { appDir, hasCatalog: hasCatalog(appDir), refs, reports });
      }
      if (u.pathname === "/api/init" && req.method === "POST") {
        const b = await body(req);
        return void send(res, 200, initProject(appDir, { framework: String(b.framework ?? "other") as never, force: false }));
      }
      if (u.pathname === "/api/validate" && req.method === "POST") {
        const issues = validateCatalogDir(appDir);
        return void send(res, 200, { issues, text: formatIssues(issues) });
      }
      if (u.pathname === "/api/update" && req.method === "GET") {
        return void send(res, 200, await checkForUpdate().catch((e: Error) => ({ error: e.message, channel: getChannel(), available: false })));
      }
      if (u.pathname === "/api/update/channel" && req.method === "POST") {
        const b = await body(req);
        if (b.channel !== "stable" && b.channel !== "all") return void send(res, 400, { error: "channel must be stable or all" });
        setChannel(b.channel);
        return void send(res, 200, { channel: b.channel });
      }
      if (u.pathname === "/api/update/install" && req.method === "POST") {
        const job = start("update", (log) => installUpdate({ log }));
        return void send(res, 200, { job: job.id });
      }
      if (u.pathname === "/api/doctor" && req.method === "GET") return void send(res, 200, await doctor(appDir));
      if (u.pathname === "/api/ai" && req.method === "GET") return void send(res, 200, loadAiConfig(appDir));
      if (u.pathname === "/api/ai" && req.method === "PUT") {
        const b = await body(req);
        const out = { providers: b.providers ?? {}, stages: b.stages ?? {}, settings: b.settings ?? {} };
        writeText(join(chipDir(appDir), "ai.yaml"), stringify(out));
        loadAiConfig(appDir); // throws if invalid
        return void send(res, 200, { ok: true });
      }
      if (u.pathname === "/api/ai/test" && req.method === "POST") {
        const b = await body(req);
        return void send(res, 200, await testProvider(appDir, String(b.provider), b.model ? String(b.model) : undefined));
      }
      if (u.pathname === "/api/ai/run" && req.method === "POST") {
        const b = await body(req);
        const job = start("ai", async (log) => runAi({ appDir, log, ...(Array.isArray(b.stages) ? { stages: b.stages as StageName[] } : {}), ...(b.extra ? { extra: String(b.extra) } : {}), dryRun: !!b.dryRun }));
        return void send(res, 200, { job: job.id });
      }
      if (u.pathname === "/api/capture" && req.method === "POST") {
        const b = await body(req);
        const ref = String(b.ref);
        const job = start("capture", (log) => runCapture({ appDir, target: { label: String(b.label ?? ref), ref }, log }));
        return void send(res, 200, { job: job.id });
      }
      if (u.pathname === "/api/compare" && req.method === "POST") {
        const b = await body(req);
        const job = start("compare", async (log) => {
          const r = await runCompare({ appDir, base: { label: String(b.base), ref: String(b.base) }, head: { label: String(b.head), ref: String(b.head) }, mode: b.mode === "flow-audit" ? "flow-audit" : "restyle", log });
          return { summary: r.report.summary, dir: r.dir.split(sep).pop() };
        });
        return void send(res, 200, { job: job.id });
      }
      const m = /^\/api\/jobs\/([a-f0-9]+)(\/events)?$/.exec(u.pathname);
      if (m) {
        const job = jobs.get(m[1]!);
        if (!job) return void send(res, 404, { error: "unknown job" });
        if (!m[2]) return void send(res, 200, { id: job.id, status: job.status, lines: job.lines, result: job.result });
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        for (const l of job.lines) res.write(`data: ${JSON.stringify(l)}\n\n`);
        if (job.status !== "running") {
          res.write(`event: end\ndata: ${JSON.stringify(job.status)}\n\n`);
          return void res.end();
        }
        job.listeners.add(res);
        req.on("close", () => job.listeners.delete(res));
        return;
      }
      send(res, 404, { error: "not found" });
    } catch (e) {
      send(res, 500, { error: (e as Error).message });
    }
  });

  await new Promise<void>((ok) => server.listen(port, "127.0.0.1", ok));
  const addr = server.address();
  const p = typeof addr === "object" && addr ? addr.port : port;
  return {
    server,
    token,
    url: `http://127.0.0.1:${p}/?token=${token}`,
    close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(() => ok()); }),
  };
}
