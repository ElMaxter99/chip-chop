# Deriving states and flows from source code

A **state** is one thing a user can see: a route, plus an optional overlay
(modal, drawer, tab), plus a data scenario (with data, empty, error).

## 1. Pages (`kind: page`)

Enumerate every route the router defines. For each one decide:

- `route`: the URL as the browser shows it. Hash-routed apps use `/#!/x` or
  `/#/x`; check the router configuration for the prefix.
- Dynamic segments (`/users/:id`): pick one concrete, mocked id and write the
  concrete route.
- Redirects and wildcard routes: capture only the destination, plus the
  not-found page if the app has one.
- Guarded routes: nothing special, auth is mocked and seeded in
  `config.auth`. If a guard depends on a role or flag, add one state per role
  that changes what is visible.

## 2. Overlays (`kind: modal | drawer | tab | state`)

Search the templates and components for things that open on interaction:
dialogs, confirmation prompts, drawers, toasts that block, wizard steps, tabs
that swap large content. Each one is its own state with:

- `opensFrom`: the state that must be active first.
- `via`: the steps that open it (same vocabulary as flow steps).

## 3. Data scenarios

When the same route renders very differently depending on data, add a state
per scenario and give each its own mocks: `passwords` (with data) and
`passwords-empty`. Typical scenarios: with data, empty, error response, very
long text, many rows. Do not multiply states without a visible difference.

## 4. Readiness and masking

- Set `ready.visible` to an element that only exists once data has rendered
  (a table, a heading with the real title).
- Add `mask` entries for anything that changes between runs and carries no
  meaning for the audit: clocks, relative dates ("2 minutes ago"), charts with
  generated data, avatars, ads.

## 5. Flows

A flow is a journey: `goto`, `click`, `fill`, `select`, `press`, `wait`,
`capture`. Write the flows users actually perform (log in, create, edit,
delete, search, checkout), and `capture` every state they pass through.
Every `capture` must name a state declared in `states.yaml`.

Targets, in order of preference: `role` + `name`, `testId`, `text`, `selector`.

## 6. Naming

Ids are lowercase kebab-case, stable, and descriptive of what the user sees:
`login`, `home`, `passwords`, `passwords-delete-modal`. They are the join key
between git refs, so choose them once and keep them.
