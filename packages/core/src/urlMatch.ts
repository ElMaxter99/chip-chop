/**
 * Matches a request path against a mock `match.url` pattern.
 *
 * Supported syntax:
 *   /api/passwords        exact path
 *   /api/passwords/:id    one path segment
 *   /api/files/*          anything inside one segment
 *   /api/**               anything, across segments
 *
 * Only the path is compared. The origin and the query string are ignored here
 * (query params are matched separately by `match.query`).
 */
export function matchUrl(pattern: string, requestUrl: string): boolean {
  const path = toPath(requestUrl);
  return compile(pattern).test(path);
}

function toPath(url: string): string {
  let rest = url;
  const origin = /^[a-z][a-z0-9+.-]*:\/\/[^/]+/i.exec(rest);
  if (origin) rest = rest.slice(origin[0].length) || "/";
  const cut = rest.search(/[?#]/);
  if (cut !== -1) rest = rest.slice(0, cut);
  if (rest.length > 1 && rest.endsWith("/")) rest = rest.slice(0, -1);
  return rest || "/";
}

function compile(pattern: string): RegExp {
  let p = pattern.length > 1 && pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;
  let out = "";
  for (let i = 0; i < p.length; i++) {
    const ch = p[i]!;
    if (ch === "*" && p[i + 1] === "*") {
      out += ".*";
      i++;
    } else if (ch === "*") {
      out += "[^/]*";
    } else if (ch === ":" && /[A-Za-z_]/.test(p[i + 1] ?? "")) {
      let j = i + 1;
      while (j < p.length && /[A-Za-z0-9_]/.test(p[j]!)) j++;
      out += "[^/]+";
      i = j - 1;
    } else {
      out += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp("^" + out + "$");
}
