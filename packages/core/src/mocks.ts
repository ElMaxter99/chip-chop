import { matchUrl } from "./urlMatch.js";
import type { Mock, MockEntry } from "./types.js";

export interface IncomingRequest {
  method: string;
  url: string;
  postData?: string | null;
}

/** True when every key of `subset` is present in `value` with an equal value (deep). */
export function isSubset(subset: unknown, value: unknown): boolean {
  if (subset === null || typeof subset !== "object") return subset === value;
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(subset)) {
    return Array.isArray(value) && subset.length === value.length && subset.every((s, i) => isSubset(s, value[i]));
  }
  return Object.entries(subset as Record<string, unknown>).every(([k, v]) =>
    isSubset(v, (value as Record<string, unknown>)[k]),
  );
}

export function entryMatches(entry: MockEntry, req: IncomingRequest): boolean {
  if (entry.match.method !== req.method.toUpperCase()) return false;
  if (!matchUrl(entry.match.url, req.url)) return false;
  if (entry.match.query) {
    let params: URLSearchParams;
    try {
      params = new URL(req.url, "http://x").searchParams;
    } catch {
      return false;
    }
    for (const [k, v] of Object.entries(entry.match.query)) if (params.get(k) !== v) return false;
  }
  if (entry.match.bodyContains) {
    let body: unknown;
    try {
      body = req.postData ? JSON.parse(req.postData) : undefined;
    } catch {
      return false;
    }
    if (!isSubset(entry.match.bodyContains, body)) return false;
  }
  return true;
}

/**
 * Finds the entry that answers a request. `mocks` is ordered by priority:
 * the first mock with a matching entry wins, and inside a mock the most specific
 * entry (more constraints) wins over a generic one.
 */
export function findMock(mocks: Mock[], req: IncomingRequest): { mock: Mock; entry: MockEntry } | undefined {
  for (const mock of mocks) {
    const candidates = mock.requests.filter((e) => entryMatches(e, req));
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => specificity(b) - specificity(a));
    return { mock, entry: candidates[0]! };
  }
  return undefined;
}

function specificity(e: MockEntry): number {
  return (e.match.query ? Object.keys(e.match.query).length : 0) + (e.match.bodyContains ? 1 : 0);
}
