---
name: chip-chop
description: Prepare a web app (AngularJS, Angular, React or similar) for chip-chop visual and flow audits. Reads the source code and writes the .chipchop/ folder - config, state catalog, flows and typed API mocks - so two git refs can be captured and compared. Use when asked to audit screens, compare branches visually, or document an app's flows.
---

# chip-chop onboarding

chip-chop is a deterministic engine. It does not understand your app. **You do**:
you read the source code and write the files the engine consumes. The engine then
validates what you wrote against the JSON Schemas in `chip-chop-schemas`, so
malformed output is rejected with a clear error.

All files live inside the audited app, in `.chipchop/`:

```
.chipchop/
  config.yaml          how to build, serve and capture (schema: config)
  states.yaml          every capturable UI state (schema: states)
  flows/*.flow.yaml    user journeys through those states (schema: flow)
  mocks/**/*.mock.json typed backend responses (schema: mock)
  assets/              downloaded external images, only when mode is "download"
```

`runs/` and `reports/` are generated output. Never commit them.

## Workflow

1. **Identify the framework** and read the matching guide:
   `guides/angularjs.md`, `guides/angular.md` or `guides/react.md`.
   For anything else, set `framework: other` and follow the general method in
   `guides/states-and-flows.md`.
2. **Write `config.yaml`.** Find the build and serve commands in `package.json`
   and CI files. Note the Node version the build needs (legacy AngularJS often
   needs an old one). Auth is always `mocked`.
3. **Catalog the states** in `states.yaml`. Read `guides/states-and-flows.md`.
4. **Write the flows**, one file per journey.
5. **Generate the mocks.** Read `guides/mocks.md`. Every network call the app can
   make during the flows needs a mock, including login.
6. **Validate** with `chip-chop validate`. Fix every error; do not edit the
   schemas to make an error go away.
7. **Run** `chip-chop capture` or `chip-chop compare <base> <head>` and read the
   report. Requests listed under "unmocked" mean a mock is missing or a ref
   calls an endpoint that did not exist before.

## Rules

- **Ids are the join key between branches.** `passwords-delete-modal` on
  `develop` is compared with the same id on the other ref. Never rename an id
  while refactoring; a feature that adds a screen adds a new id.
- **Prefer `role` + `name` targets** over CSS selectors. They survive style
  rewrites, which is the main use case.
- **No real credentials, tokens or personal data**, ever, in config or mocks.
- **No randomness in mocks**: fixed ids, fixed ISO dates, no "now".
- **Record where each thing came from** (`source` on states, `generatedFrom` on
  mocks) so the files can be regenerated when the code changes.
- **If the code does not answer a question, ask the human.** Do not invent an
  endpoint, a field or a route and present it as fact. Put a short `TODO:` in
  the `description` of whatever is uncertain.
- Keep the catalog in sync: when a route, modal or API call is added or removed
  in the code, update states, flows and mocks in the same change.
