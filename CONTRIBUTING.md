# Contributing

Thanks for helping. chip-chop is early; small, focused changes are easiest to
review.

## Setup

```bash
git clone https://github.com/ElMaxter99/chip-chop
cd chip-chop
npm install
```

Node 22 or newer.

## Checks

```bash
npm run validate:schemas
npm run typecheck
npm test
```

CI runs the same three.

## Changing a schema

The schemas in `packages/schemas` are the contract between the AI that writes
the files and the engine that reads them.

1. Edit the schema.
2. Update `packages/core/src/types.ts` to match.
3. Add or update a valid example in `packages/schemas/examples`, and an invalid
   one in `examples/invalid` if you added a rule.
4. Run `npm run validate:schemas`.
5. If the AI-facing instructions change, update `packages/skills`.

Prefer additive changes. Removing or renaming a field breaks every app that has
a `.chipchop/` folder.

## Adding a framework guide

Create `packages/skills/guides/<framework>.md` with the same sections as the
existing guides: routes, overlays, HTTP and data (where shapes come from),
capturing notes, build notes. Add the framework to the `framework` enum in
`config.schema.json` and to `types.ts`, and link the guide from `SKILL.md`.

## Pull requests

- One topic per PR.
- Explain the why, and what you checked.
- Do not commit generated output (`.chipchop/runs`, `.chipchop/reports`).
