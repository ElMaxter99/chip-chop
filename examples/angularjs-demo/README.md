# AngularJS demo

A small AngularJS 1.8 app ("Vault") used to test chip-chop end to end on a real AngularJS app:

- `ngRoute` with `#!/` URLs and `templateUrl` views, `$http` against a backend that chip-chop mocks
  (`GET`, `POST` with `bodyContains`, `DELETE /api/passwords/:id`), a login form (`ng-model`, `ng-submit`),
  delete and share dialogs (`ng-if`, `role="dialog"`), a `$interval` clock (masked) and an external banner image.
- AngularJS and `angular-route` come from npm (`package.json`); `build.mjs` copies them into `vendor/` during the
  build, exactly like a real app's build step. Nothing from AngularJS is committed.

| Folder | What it is |
| --- | --- |
| `base/` | the app (`develop`) |
| `restyle/` | only `style.css` changes: every state must be `visual-only` |
| `feature/` | a style tweak plus a share dialog (new button, new modal, new flow) |
| `chipchop-base/`, `chipchop-feature/` | the `.chipchop/` catalog of each version |

The test is `packages/core/src/angularjs.e2e.ts`; it builds a temporary git repo from these folders
(`makeAngularJsRepo` in `packages/core/src/demoRepo.ts`).

```bash
npm install --prefix examples/angularjs-demo      # AngularJS from npm
npm run test:e2e --workspace chip-chop            # needs Chromium: npx playwright install chromium
```

Without the install the AngularJS e2e is skipped locally and fails in CI (`CI=true`).
`npm test` always validates both catalogs against the schemas.
