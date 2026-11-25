# Releasing

1. Bump `version` in `packages/core/package.json`.
2. `npm run validate:schemas && npm run typecheck && npm test && npm run test:e2e --workspace chip-chop`
3. Commit and push to `main`.
4. The *Release* workflow notices a version without a release, re-runs the checks, runs
   `npm pack --workspace chip-chop` and creates the GitHub Release (tag `vX.Y.Z`) with the `.tgz` attached.
   It can also be started by hand from the Actions tab.

Publishing to npm is intentionally manual: `npm publish --workspace chip-chop --access public`
(check first that the `chip-chop` name is free; it has not been verified).
