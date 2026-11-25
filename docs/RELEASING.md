# Releasing

1. Bump `version` in `packages/core/package.json`.
2. `npm run validate:schemas && npm run typecheck && npm test && npm run test:e2e --workspace chip-chop`
3. Commit and push to `main`.
4. The *Release* workflow notices a version without a release, re-runs the checks, runs
   `npm pack --workspace chip-chop` and creates the GitHub Release (tag `vX.Y.Z`) with the Linux bundle, the Windows bundle and the `.tgz`.
   It can also be started by hand from the Actions tab.

Release candidates: set the version to `X.Y.Z-rc.N` (for example `0.2.0-rc.1`). The workflow publishes it as a
GitHub pre-release; users on the `stable` channel never get it, users on `all` do.

Publishing to npm is intentionally manual: `npm publish --workspace chip-chop --access public`
(check first that the `chip-chop` name is free; it has not been verified).
