---
type: Added
---
**AngularJS: espera a que la app esté estable y demo propia:** antes de cada captura (y tras cada paso de un flujo) chip-chop espera a que AngularJS 1.x termine sus `$http`, plantillas de ruta y `$timeout` (máx. 5 s), así las cadenas `ngRoute` / `ui-router` no se capturan a medias en «Loading…». Las animaciones se congelan desde el primer pintado, no solo justo antes de la captura. Nueva demo `examples/angularjs-demo` (AngularJS 1.8 desde npm) con su `.chipchop/` y un e2e en CI.
