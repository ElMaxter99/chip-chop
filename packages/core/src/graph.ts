import type { Catalog } from "./catalog.js";
import type { GraphEdge } from "./types.js";

/** Static state graph from the catalog: flows (consecutive captures) and overlays (opensFrom). */
export function catalogGraph(catalog: Catalog): { nodes: string[]; edges: GraphEdge[] } {
  const nodes = new Set(catalog.states.map((s) => s.id));
  const edges = new Map<string, GraphEdge>();
  const add = (from: string, to: string, via?: string): void => {
    if (from === to) return;
    const k = `${from}->${to}`;
    if (!edges.has(k)) edges.set(k, { from, to, ...(via ? { via } : {}) });
  };
  for (const s of catalog.states) if (s.opensFrom) add(s.opensFrom, s.id, "opens");
  for (const flow of catalog.flows) {
    let prev: string | undefined;
    for (const step of flow.steps) {
      if (!("capture" in step)) continue;
      if (prev) add(prev, step.capture, `flow ${flow.id}`);
      prev = step.capture;
      nodes.add(step.capture);
    }
  }
  return { nodes: [...nodes].sort(), edges: [...edges.values()].sort((a, b) => `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`)) };
}

const nodeId = (id: string): string => "n_" + id.replace(/[^A-Za-z0-9]/g, "_");

export function toMermaid(
  graph: { nodes: string[]; edges: GraphEdge[] },
  mark: { added?: string[]; removed?: string[]; addedEdges?: GraphEdge[]; removedEdges?: GraphEdge[] } = {},
): string {
  const added = new Set(mark.added ?? []);
  const removed = new Set(mark.removed ?? []);
  const lines = ["flowchart LR"];
  const allNodes = new Set([...graph.nodes, ...removed]);
  for (const n of [...allNodes].sort()) {
    lines.push(`  ${nodeId(n)}["${n.replace(/"/g, "'")}"]`);
  }
  const edgeKey = (e: GraphEdge): string => `${e.from}->${e.to}`;
  const addedEdges = new Set((mark.addedEdges ?? []).map(edgeKey));
  const removedEdges = new Set((mark.removedEdges ?? []).map(edgeKey));
  const all = [...graph.edges, ...(mark.removedEdges ?? [])];
  for (const e of all) {
    const label = e.via ? `|${e.via.replace(/[|"]/g, " ")}|` : "";
    lines.push(`  ${nodeId(e.from)} -->${label} ${nodeId(e.to)}`);
  }
  for (const n of added) lines.push(`  style ${nodeId(n)} fill:#d1fae5,stroke:#059669`);
  for (const n of removed) lines.push(`  style ${nodeId(n)} fill:#fee2e2,stroke:#dc2626,stroke-dasharray: 4 3`);
  let i = 0;
  for (const e of all) {
    if (addedEdges.has(edgeKey(e))) lines.push(`  linkStyle ${i} stroke:#059669,stroke-width:2px`);
    else if (removedEdges.has(edgeKey(e))) lines.push(`  linkStyle ${i} stroke:#dc2626,stroke-dasharray: 4 3`);
    i++;
  }
  return lines.join("\n") + "\n";
}
