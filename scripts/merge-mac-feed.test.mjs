import test from "node:test";
import assert from "node:assert/strict";
import { formatFeed, mergeFeeds, parseFeed } from "./merge-mac-feed.mjs";

const feed = (arch) => `version: 0.4.0\nfiles:\n  - url: chip-chop-0.4.0-mac-${arch}.zip\n    sha512: abc${arch}\n    size: 10\npath: chip-chop-0.4.0-mac-${arch}.zip\nsha512: abc${arch}\nreleaseDate: '2026-01-01T00:00:00.000Z'\n`;

test("une los feeds de arm64 e Intel", () => {
  const m = mergeFeeds(parseFeed(feed("arm64")), parseFeed(feed("x64")));
  assert.equal(m.files.length, 2);
  assert.match(m.path, /x64/);
  assert.match(formatFeed(m), /arm64\.zip[\s\S]*x64\.zip/);
  assert.throws(() => mergeFeeds(parseFeed(feed("arm64")), parseFeed(feed("x64").replace("0.4.0", "0.5.0"))));
});
