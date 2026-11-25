# Guide: Angular (2+)

Read this together with `states-and-flows.md` and `mocks.md`.

## Routes

- Search for `Routes` arrays: `app.routes.ts`, `app-routing.module.ts`, and
  feature routing files. Standalone apps register routes via `provideRouter`.
- Lazy routes (`loadChildren`, `loadComponent`) point to more route files;
  follow them and join the paths (`parent.path + '/' + child.path`).
- Dynamic segments (`:id`): pick a concrete mocked value.
- Redirects (`redirectTo`) and wildcard `**` routes: capture the destination
  and the not-found page.
- Guards (`canActivate`, `canMatch`, resolvers) tell you what auth or data a
  page needs. Read them: a guard that calls the API needs a mock.
- Default URL form is path-based (`/passwords`). If `withHashLocation()` or
  `useHash: true` is set, routes are `/#/passwords`.

## Overlays

- Angular Material: `MatDialog.open(SomeComponent, ...)`, bottom sheets,
  snackbars, `mat-tab-group`, `mat-sidenav`.
- ng-bootstrap: `NgbModal.open(...)`.
- CDK overlay, PrimeNG / Clarity dialogs, or components toggled by a flag with
  `@if` / `*ngIf`.

The component passed to `open()` is the overlay content; the method that calls
it points to the button or action that triggers it.

## HTTP and data

- `HttpClient` calls in services (`@Injectable`), including those using
  `environment.apiUrl`. Check `environment*.ts` for base URLs.
- HTTP interceptors (functional `withInterceptors` or class-based) add calls
  and handle 401/500; read them.
- **Shapes**: interfaces, classes and enums in `models/`, `*.model.ts`,
  `*.dto.ts`; generics on `http.get<T>()` give the exact type of each response.
  If the project uses an OpenAPI generator, the generated client and the spec
  are authoritative.
- Forms: validators (`Validators.required`, `minLength`) hint at field limits.

## Capturing

- Wait for data, not for Angular: prefer `ready.visible` on an element that
  needs the response (a row, a heading). The engine's network-idle wait helps
  but does not know about timers.
- Angular animations and Material ripples are covered by the animation freeze.
- Fonts from Google Fonts or other CDNs are external assets; see
  `config.externalAssets`.

## Build notes

`ng build` output goes to `dist/<project>` (with a `browser/` subfolder in
recent versions). Serve it with a static server and a history-API fallback to
`index.html`, otherwise deep links 404.
