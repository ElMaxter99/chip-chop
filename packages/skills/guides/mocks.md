# Generating typed mocks from source code

The goal is a backend that answers exactly like the real one would, without
any backend. Every response must be **consistent with the types in the code**.

## 1. Find every network call

List every request the app can make during the states and flows, not only the
GETs on page load: login, token refresh, "me", feature flags, config, polling,
uploads, deletes. Check HTTP interceptors for calls they add (token refresh) and
base URL configuration (environment files, constants).

## 2. Find the shape of each response

Use the best source available, in this order:

1. An **OpenAPI/Swagger spec** or a client generated from one.
2. **Types in the code**: TypeScript interfaces, DTOs, models, Zod/Yup schemas
   (Zod schemas also give constraints: min, max, enums, formats).
3. **Existing test data**: unit-test fixtures, `$httpBackend` expectations,
   MSW handlers, Cypress `intercept` stubs, Storybook args.
4. **How the UI uses the data**: template bindings, `ng-repeat`, `.map`
   callbacks, property access in components. This tells you which fields matter.
5. **Backend source** (DTOs, serializers) when it is in the same repo.

If sources disagree, prefer the earlier one and note the conflict in the mock's
`description`.

## 3. Choose realistic values by meaning

| Field looks like | Value |
|---|---|
| `isX`, `hasX`, `canX`, `enabled`, `active` | boolean |
| `createdAt`, `updatedAt`, `*Date`, `*At` | fixed ISO 8601 string, e.g. `2025-11-02T09:30:00Z` |
| `id`, `*Id` | integer or UUID, following the declared type; stable and unique |
| `email` | `name@example.com` |
| `url`, `avatar`, `image` | a path or a placeholder-able URL (see external assets) |
| `count`, `total`, `price`, `amount` | number, consistent with the list length when related |
| union types / enums | one of the declared values; cover each value across rows when practical |
| nullable / optional | include both present and absent cases across rows |

Use plausible, fictional data. No real people, emails, tokens or secrets.
No `Date.now()`, random numbers or generated ids: output must be identical on
every run.

## 4. Write the file

`.chipchop/mocks/<area>/<name>.mock.json`, id `<area>/<name>`:

- `generatedFrom`: the files and symbols you inferred the shape from.
- `requests[].match`: method + path pattern (`/api/items/:id`), optionally
  `query` and `bodyContains`. For GraphQL, match on `bodyContains` with the
  `operationName`.
- `requests[].responseSchema`: a JSON Schema of the response built from the
  types. The tooling validates `response.json` against it, which is how a
  boolean that became a string is caught.
- `requests[].response`: status, headers if needed, `json`.

## 5. Scenarios

One mock file per scenario, never one giant file:
`list-with-data`, `list-empty`, `list-error` (status 500 with the error body the
UI expects), `list-edge` (long text, special characters, many rows). States
reference the scenario they need.

## 6. Auth

Login is always mocked. Write `auth/login-ok` answering the login request and
any follow-up identity call, and set `config.auth.mock` plus
`config.auth.storage` so protected routes open authenticated.

## 7. External assets

Images, fonts and scripts hosted outside the app are controlled by
`config.externalAssets`:

- `placeholder` (default): the engine serves a generated image. Add `sizes`
  entries when you know the real dimensions (a 1500x80 banner) so layout does
  not shift.
- `download`: fetch once into `.chipchop/assets/` and replay.
- `block`: abort the request.

Find the dimensions from the markup (`width`/`height` attributes, CSS) rather
than guessing.

## 8. When you are not sure

Do not invent. If a field's type, an endpoint or a status code cannot be
determined from the code, ask the human, or write the most conservative value
and add `TODO:` to the mock's `description`.
