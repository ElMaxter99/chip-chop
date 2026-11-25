# Guide: AngularJS (1.x)

Read this together with `states-and-flows.md` and `mocks.md`.

## Routes

Find the router first:

- **ngRoute**: `$routeProvider.when('/path', { templateUrl, controller })` and
  `.otherwise(...)`.
- **ui-router**: `$stateProvider.state('name', { url, templateUrl, controller,
  resolve })`. Nested states (`parent.child`) combine their `url`s. Abstract
  states are not pages.
- **Component router / custom**: search for `$location`, `$locationProvider`.

URL form: check `$locationProvider.html5Mode(...)` and `hashPrefix(...)`.
Without html5Mode the URL is `/#/x` (1.5 and earlier) or `/#!/x` (1.6+ default
prefix is `!`). Write `route:` exactly as the browser shows it.

Guards live in `resolve`, in `$routeChangeStart` / `$stateChangeStart` /
`$transitions.onBefore` handlers, or in `run()` blocks. Read them to learn what
login state a page needs.

## Overlays

Search for the dialog service the app uses and every call to it:

- `$uibModal.open({ templateUrl, controller })` (ui-bootstrap)
- `$mdDialog.show(...)` (Angular Material)
- `ngDialog.open(...)`, `$modal.open(...)` (older ui-bootstrap)
- `ng-if` / `ng-show` panels toggled by a controller flag

The template named in the call is the modal's content. The function that calls
it tells you which button opens it.

## HTTP and data

- `$http.get/post(...)`, `$resource('/api/x/:id')`, Restangular, custom
  services wrapping them.
- Interceptors: `$httpProvider.interceptors.push(...)` (token, error handling,
  loading bars). They can add calls and change behavior on 401/500.
- Base URLs: constants, `.value()`, `.constant()`, config JSON files.
- **Shapes**: AngularJS apps rarely have types. Best sources, in order: JSDoc or
  TypeScript if the project has it, **existing specs that use `$httpBackend`**
  (they contain real response bodies), then templates (`{{item.isActive}}`,
  `ng-repeat="p in passwords"`, `ng-class`) and controller code that reads
  fields.

## Capturing

- The framework settles after digest cycles; the engine's network-idle wait
  covers `$http`. If a page polls (`$interval`, `$timeout` loops), pick a
  `ready.visible` element instead of relying on idle.
- `ngAnimate` transitions are disabled by the engine's animation freeze.
- Templates are often loaded by XHR (`templateUrl`). Those requests are local
  app files, not API calls; they must not be mocked or blocked.

## Build notes

Legacy builds (Grunt, Gulp, old Webpack) often need an old Node version and
may fail on a modern one. Set `build.nodeVersion` in `config.yaml` and note the
install and build commands from the README or CI file.
