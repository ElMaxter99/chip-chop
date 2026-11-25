# Guide: React

Read this together with `states-and-flows.md` and `mocks.md`.

## Routes

Find which router the app uses:

- **React Router**: `<Route path="..." element={...} />`, `createBrowserRouter`
  route objects, `createHashRouter`. Nested routes combine their `path`s;
  `index` routes use the parent's path. Hash routers produce `/#/x` URLs.
- **TanStack Router**, **Wouter**: route definitions in code or generated route
  trees.
- **File-based frameworks** (Next.js, Remix, Gatsby): the routes are the
  folders (`app/`, `pages/`, `routes/`). Set `framework: react` and, if
  server-side rendering fetches data on the server, note that browser-level
  mocks cannot intercept those calls (see "Capturing").

Dynamic segments (`:id`, `[id]`): pick a concrete mocked value. Protected routes
are usually wrapper components (`<RequireAuth>`, `PrivateRoute`); read them to
learn what auth state they check.

## Overlays

- UI kits: MUI `Dialog`/`Drawer`, Chakra `Modal`, Radix/shadcn `Dialog`,
  Ant Design `Modal`, Bootstrap `Modal`.
- State-driven: a boolean in state (`isOpen`, `showDelete`) toggled by a click
  handler. Search for the handler and the component it renders.
- Portals: overlays render at the end of `body`; role-based targets
  (`role: dialog`) find them regardless.

## HTTP and data

- `fetch`, `axios` instances, `ky`; data libraries: React Query / TanStack Query
  (`useQuery(['passwords'], fn)`), SWR, RTK Query endpoints, Apollo/urql
  (GraphQL).
- **GraphQL**: all calls hit one URL. Match on `bodyContains` with
  `operationName`, and write one entry per operation.
- **Shapes**: TypeScript types and interfaces (`useQuery<Password[]>`),
  **Zod/Yup schemas** (give constraints too), generated clients (OpenAPI,
  GraphQL codegen types), MSW handlers and test fixtures if present.
- Base URL: `import.meta.env.VITE_*`, `process.env.REACT_APP_*`, config files.

## Capturing

- Strict Mode and Suspense can trigger a request twice in development; build
  the production bundle for audits when possible.
- Skeletons and spinners are real states: if the loading UI matters, add a
  state with a delayed mock (`response.delayMs`), otherwise set
  `ready.visible` on the loaded content.
- Server-rendered data (Next.js server components, `getServerSideProps`) is
  fetched in Node and is not visible to browser interception. Point those
  calls at a local stub server, or audit the client-rendered parts only and say
  so in the config description.

## Build notes

Vite builds to `dist/`, Create React App to `build/`, Next.js needs
`next start`. For client-side routers, serve with an `index.html` fallback so
deep links work.
