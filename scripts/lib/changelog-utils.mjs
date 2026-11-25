// Reglas puras del CHANGELOG por ficheros (sin tocar disco). Adaptado de pdf-annotator.
export const TYPES = ["Added", "Changed", "Fixed", "Security", "Removed"];

/** Fichero de changelog/unreleased: cabecera `---` con `type:` y texto debajo. `type: none` = sin entrada. */
export function parseEntry(raw, name = "entrada") {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(String(raw).trimStart());
  if (!m) throw new Error(`${name}: falta la cabecera «---» con «type:».`);
  const header = {};
  for (const line of m[1].split(/\r?\n/)) {
    const p = /^([A-Za-z]+):\s*(.*)$/.exec(line.trim());
    if (p) header[p[1].toLowerCase()] = p[2].trim();
  }
  const type = header.type;
  if (type === "none") return { type: "none", text: "" };
  const known = TYPES.find((t) => t.toLowerCase() === String(type).toLowerCase());
  if (!known) throw new Error(`${name}: «type» debe ser ${TYPES.join(", ")} o none (llegó «${type ?? ""}»).`);
  const text = m[2].trim();
  if (!text) throw new Error(`${name}: el texto de la entrada está vacío.`);
  return { type: known, text: text.startsWith("- ") ? text.slice(2).trim() : text };
}

export function splitSections(body) {
  const sections = new Map();
  let current = null;
  let bullet = null;
  const flush = () => {
    if (current && bullet) sections.get(current).push(bullet.join("\n").trimEnd());
    bullet = null;
  };
  for (const line of String(body).split("\n")) {
    const h = /^### (.+?)\s*$/.exec(line);
    if (h) {
      flush();
      current = h[1];
      if (!sections.has(current)) sections.set(current, []);
    } else if (current && /^- /.test(line)) {
      flush();
      bullet = [line];
    } else if (current && bullet && (line.startsWith(" ") || line.trim() === "")) bullet.push(line);
  }
  flush();
  return sections;
}

export function buildBody(existingBody, entries) {
  const sections = splitSections(existingBody);
  for (const e of entries) {
    if (e.type === "none") continue;
    if (!sections.has(e.type)) sections.set(e.type, []);
    sections.get(e.type).push(`- ${e.text}`);
  }
  const names = [...TYPES.filter((t) => sections.has(t)), ...[...sections.keys()].filter((n) => !TYPES.includes(n))];
  return names
    .filter((n) => sections.get(n).length > 0)
    .map((n) => `### ${n}\n${sections.get(n).join("\n")}`)
    .join("\n\n");
}

/** CHANGELOG nuevo: `## Unreleased` vacío y debajo la sección de la versión. */
export function releaseChangelog(changelog, version, date, entries, repoUrl) {
  const lines = String(changelog).split("\n");
  const start = lines.findIndex((l) => /^## Unreleased\s*$/.test(l));
  if (start === -1) throw new Error("CHANGELOG.md no tiene «## Unreleased».");
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end === -1) end = lines.length;
  const body = buildBody(lines.slice(start + 1, end).join("\n"), entries);
  if (!body) throw new Error("No hay nada que publicar: «Unreleased» y changelog/unreleased/ están vacíos.");
  return [...lines.slice(0, start), "## Unreleased", "", `## [v${version}](${repoUrl}/releases/tag/v${version}) - ${date}`, body, "", ...lines.slice(end)].join("\n");
}

/** Rutas cuyo cambio exige una entrada en la PR. */
export const NEEDS_ENTRY = /^(packages\/core\/(src|ui)\/|scripts\/install\.|scripts\/make-bundle)/;
export const touchesProduct = (files) => files.some((f) => NEEDS_ENTRY.test(f));

/** Sección del CHANGELOG de una versión X.Y.Z → { heading, body } o null. */
export function changelogSection(version, changelog) {
  const lines = String(changelog).split("\n");
  const start = lines.findIndex((l) => /^## /.test(l) && l.includes(`v${version}]`));
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end === -1) end = lines.length;
  return { heading: lines[start], body: lines.slice(start + 1, end).join("\n").trim() };
}
