import { toMermaid } from "./graph.js";
import type { GraphEdge, Report, StateResult } from "./types.js";

type Graph = { nodes: string[]; edges: GraphEdge[] };

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const LABEL: Record<StateResult["status"], string> = {
  identical: "Identical",
  "visual-only": "Visual only",
  structural: "Structural",
  added: "Added",
  removed: "Removed",
  failed: "Failed",
};

function mermaidFor(report: Report, graph: Graph | undefined): string {
  if (!graph) return "";
  const fg = report.flowGraph ?? {};
  return toMermaid(graph, {
    added: fg.addedStates ?? [],
    removed: fg.removedStates ?? [],
    addedEdges: fg.addedTransitions ?? [],
    removedEdges: fg.removedTransitions ?? [],
  });
}

function card(s: StateResult): string {
  const v = s.visual ?? {};
  const pct = v.diffRatio !== undefined ? ` · ${(v.diffRatio * 100).toFixed(2)}% pixels` : "";
  let body = "";
  if (s.error) body += `<p class="err">${esc(s.error)}</p>`;
  if (s.structural) {
    const st = s.structural;
    const items: string[] = [];
    if (st.ariaChanged) items.push("Accessibility tree changed");
    for (const r of st.requestsAdded ?? []) items.push(`New request: <code>${esc(r)}</code>`);
    for (const r of st.requestsRemoved ?? []) items.push(`Request no longer made: <code>${esc(r)}</code>`);
    for (const e of st.newConsoleErrors ?? []) items.push(`New console error: <code>${esc(e)}</code>`);
    body += `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
  }
  if (v.baseImage && v.headImage) {
    body += `<details${s.status === "identical" ? "" : " open"}><summary>Compare</summary>
<div class="views">
  <figure><figcaption>Base</figcaption><img loading="lazy" src="${esc(v.baseImage)}"></figure>
  <figure><figcaption>Head</figcaption><img loading="lazy" src="${esc(v.headImage)}"></figure>
  ${v.diffImage ? `<figure><figcaption>Diff</figcaption><img loading="lazy" src="${esc(v.diffImage)}"></figure>` : ""}
</div>
<div class="slider" style="--pos:50%">
  <img loading="lazy" src="${esc(v.headImage)}"><img class="top" loading="lazy" src="${esc(v.baseImage)}">
  <input type="range" min="0" max="100" value="50" aria-label="Slide between base and head" oninput="this.parentNode.style.setProperty('--pos',this.value+'%')">
</div></details>`;
  } else if (v.headImage) {
    body += `<details open><summary>Head</summary><figure><img loading="lazy" src="${esc(v.headImage)}"></figure></details>`;
  } else if (v.baseImage) {
    body += `<details open><summary>Base</summary><figure><img loading="lazy" src="${esc(v.baseImage)}"></figure></details>`;
  }
  return `<section class="card" data-status="${s.status}">
<h3>${esc(s.id)} <small>[${esc(s.viewport)}]</small> <span class="badge ${s.status}">${LABEL[s.status]}</span><small>${pct}</small></h3>${body}</section>`;
}

export function renderHtml(report: Report, graphs: { baseGraph?: Graph; headGraph?: Graph }): string {
  const s = report.summary;
  const counts: [StateResult["status"] | "all", string, number][] = [
    ["all", "All", report.states.length],
    ["identical", "Identical", s.identical],
    ["visual-only", "Visual only", s.visualOnly],
    ["structural", "Structural", s.structural],
    ["added", "Added", s.added],
    ["removed", "Removed", s.removed],
    ["failed", "Failed", s.failed],
  ];
  const fg = report.flowGraph ?? {};
  const unmocked = report.unmockedRequests ?? [];
  const mermaid = mermaidFor(report, graphs.headGraph);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(report.app)}: ${esc(report.base.name)} vs ${esc(report.head.name)}</title>
<style>
:root{--bg:#f7f7f8;--fg:#1b1b1f;--mut:#6b6b76;--card:#fff;--bd:#e3e3e8}
@media(prefers-color-scheme:dark){:root{--bg:#141417;--fg:#ececf1;--mut:#9a9aa6;--card:#1c1c21;--bd:#2c2c33}}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
header,main{max-width:1200px;margin:0 auto;padding:16px 20px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px}h3{font-size:14px;margin:0 0 8px}
.mut,small{color:var(--mut);font-weight:400}code{font:12px ui-monospace,monospace;background:var(--bg);padding:1px 4px;border-radius:4px}
.filters{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.filters button{border:1px solid var(--bd);background:var(--card);color:var(--fg);padding:6px 10px;border-radius:8px;cursor:pointer}
.filters button.on{outline:2px solid #3b82f6}
.card{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:12px 14px;margin:10px 0}
.badge{font-size:11px;padding:2px 8px;border-radius:99px;margin-left:6px;font-weight:600}
.identical{background:#dcfce7;color:#166534}.visual-only{background:#e0e7ff;color:#3730a3}.structural{background:#fef3c7;color:#92400e}
.added{background:#d1fae5;color:#065f46}.removed{background:#fee2e2;color:#991b1b}.failed{background:#fecaca;color:#7f1d1d}
.views{display:flex;gap:12px;flex-wrap:wrap}.views figure{margin:0;flex:1 1 280px;min-width:0}figcaption{font-size:12px;color:var(--mut)}
img{max-width:100%;border:1px solid var(--bd);display:block}
.slider{position:relative;margin-top:12px;max-width:100%}.slider .top{position:absolute;inset:0;clip-path:inset(0 calc(100% - var(--pos)) 0 0);border:0}
.slider input{width:100%;margin-top:6px}.err{color:#b91c1c}pre{background:var(--card);border:1px solid var(--bd);padding:10px;border-radius:8px;overflow:auto}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid var(--bd);padding:4px 8px;text-align:left}
</style></head><body>
<header>
<h1>${esc(report.app)}</h1>
<div class="mut">${esc(report.base.name)}${report.base.commit ? ` (${esc(report.base.commit)})` : ""} → ${esc(report.head.name)}${report.head.commit ? ` (${esc(report.head.commit)})` : ""} · mode <b>${report.mode}</b> · ${esc(report.generatedAt)}</div>
<div class="filters">${counts.map(([k, l, n]) => `<button data-f="${k}" class="${k === "all" ? "on" : ""}">${l} (${n})</button>`).join("")}</div>
</header>
<main>
${(fg.addedStates?.length || fg.removedStates?.length || fg.addedTransitions?.length || fg.removedTransitions?.length) ? `<h2>Flow changes</h2><ul>
${(fg.addedStates ?? []).map((n) => `<li>New state <code>${esc(n)}</code></li>`).join("")}
${(fg.removedStates ?? []).map((n) => `<li>State gone <code>${esc(n)}</code></li>`).join("")}
${(fg.addedTransitions ?? []).map((e) => `<li>New transition <code>${esc(e.from)}</code> → <code>${esc(e.to)}</code>${e.via ? ` <span class="mut">(${esc(e.via)})</span>` : ""}</li>`).join("")}
${(fg.removedTransitions ?? []).map((e) => `<li>Transition gone <code>${esc(e.from)}</code> → <code>${esc(e.to)}</code></li>`).join("")}
</ul>` : ""}
${unmocked.length ? `<h2>Requests without a mock</h2><table><tr><th>Ref</th><th>State</th><th>Request</th></tr>${unmocked.map((u) => `<tr><td>${u.ref}</td><td>${esc(u.state)}</td><td><code>${esc(u.method)} ${esc(u.url)}</code></td></tr>`).join("")}</table>` : ""}
<h2>States</h2>
${report.states.map(card).join("\n")}
${mermaid ? `<h2>Flow graph (head)</h2><p class="mut">Mermaid source. Paste it into any Mermaid renderer. Green: new, red: removed.</p><pre>${esc(mermaid)}</pre>` : ""}
</main>
<script>
document.querySelectorAll('.filters button').forEach(function(b){b.addEventListener('click',function(){
  document.querySelectorAll('.filters button').forEach(function(x){x.classList.remove('on')});b.classList.add('on');
  var f=b.getAttribute('data-f');document.querySelectorAll('.card').forEach(function(c){c.style.display=(f==='all'||c.getAttribute('data-status')===f)?'':'none'});
});});
</script>
</body></html>`;
}

export function renderMarkdown(report: Report, graphs: { headGraph?: Graph }): string {
  const s = report.summary;
  const rows = report.states
    .map((x) => {
      const v = x.visual?.diffRatio !== undefined ? `${(x.visual.diffRatio * 100).toFixed(2)}%` : "";
      return `| ${x.id} | ${x.viewport} | ${LABEL[x.status]} | ${v} |`;
    })
    .join("\n");
  const fg = report.flowGraph ?? {};
  const list = (title: string, items: string[]): string => (items.length ? `\n### ${title}\n${items.map((i) => `- ${i}`).join("\n")}\n` : "");
  const details = report.states
    .filter((x) => x.structural || x.error)
    .map((x) => {
      const st = x.structural;
      const bits: string[] = [];
      if (x.error) bits.push(x.error);
      if (st?.ariaChanged) bits.push("accessibility tree changed");
      for (const r of st?.requestsAdded ?? []) bits.push(`new request \`${r}\``);
      for (const r of st?.requestsRemoved ?? []) bits.push(`request gone \`${r}\``);
      for (const e of st?.newConsoleErrors ?? []) bits.push(`new console error \`${e}\``);
      return `- **${x.id}** [${x.viewport}]: ${bits.join("; ")}`;
    });
  const mermaid = mermaidFor(report, graphs.headGraph);
  return `# ${report.app}: ${report.base.name} → ${report.head.name}

Mode: **${report.mode}** · ${report.generatedAt}

| Identical | Visual only | Structural | Added | Removed | Failed |
|---|---|---|---|---|---|
| ${s.identical} | ${s.visualOnly} | ${s.structural} | ${s.added} | ${s.removed} | ${s.failed} |

## States

| State | Viewport | Status | Changed pixels |
|---|---|---|---|
${rows}
${list("Details", details)}${list("New states", (fg.addedStates ?? []).map((n) => `\`${n}\``))}${list("Removed states", (fg.removedStates ?? []).map((n) => `\`${n}\``))}${list("New transitions", (fg.addedTransitions ?? []).map((e) => `\`${e.from}\` → \`${e.to}\`${e.via ? ` (${e.via})` : ""}`))}${list("Requests without a mock", (report.unmockedRequests ?? []).map((u) => `${u.ref}: \`${u.method} ${u.url}\` in ${u.state}`))}
${mermaid ? `\n## Flow graph (head)\n\n\`\`\`mermaid\n${mermaid}\`\`\`\n` : ""}`;
}
