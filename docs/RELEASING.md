# Releasing

1. Bump `version` in `packages/core/package.json`.
2. `npm run validate:schemas && npm run typecheck && npm test && npm run test:e2e --workspace chip-chop`
3. Commit, then `git tag vX.Y.Z && git push origin main vX.Y.Z`.
4. The *Release* workflow re-runs the checks, runs `npm pack --workspace chip-chop` and attaches the
   `.tgz` to a GitHub Release. It fails if the tag and the package version differ.

Publishing to npm is intentionally manual: `npm publish --workspace chip-chop --access public`
(check first that the `chip-chop` name is free; it has not been verified).
