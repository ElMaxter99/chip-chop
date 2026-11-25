# Changelog

## Unreleased

## [v0.4.3](https://github.com/ElMaxter99/chip-chop/releases/tag/v0.4.3) - 2026-11-25
### Added
- **AngularJS: espera a que la app esté estable y demo propia:** antes de cada captura (y tras cada paso de un flujo) chip-chop espera a que AngularJS 1.x termine sus `$http`, plantillas de ruta y `$timeout` (máx. 5 s), así las cadenas `ngRoute` / `ui-router` no se capturan a medias en «Loading…». Las animaciones se congelan desde el primer pintado, no solo justo antes de la captura. Nueva demo `examples/angularjs-demo` (AngularJS 1.8 desde npm) con su `.chipchop/` y un e2e en CI.

### Changed
- **Pantalla de Inicio de la app de escritorio, más completa:** cada proyecto muestra su último informe (fecha, idéntico/cambios/fallos y nº de estados) con un botón «Ver informes»; los proyectos sin `.chipchop/` tienen un botón «Inicializar» (equivale a `chip-chop init`) que explica qué crea; estado vacío guiado en tres pasos; avisos claros si falta git (con cómo instalarlo según el sistema) o Claude/Copilot; un `ai.yaml` global mal escrito se explica en la pestaña IA en vez de dejarla vacía; accesibilidad (pestañas con roles ARIA y flechas, foco visible, enlace para saltar al contenido, `prefers-reduced-motion`).

### Fixed
- **Peticiones y mocks en apps AngularJS:** las plantillas (`templateUrl`) y otros ficheros estáticos pedidos por XHR del mismo origen ya no cuentan como peticiones de la app, así que mover una plantilla en un restyle no se marca como cambio estructural. Un `match.url` de mock escrito con origen (`https://api.ejemplo.com/v1/items`) ahora coincide igual que `/v1/items`.
- **Actualización probada de extremo a extremo y más segura:** `chip-chop update --check` ya no ignora `--channel` (ni, sin canal, instalaba en vez de solo comprobar); los instaladores (`install.sh`, `install.ps1`) copian a una carpeta nueva y la conmutan, de modo que un fallo o una carpeta ocupada en Windows no dejan la instalación rota; nuevo `CHIPCHOP_RELEASES_URL` (solo pruebas) y e2e `update.e2e.ts` con releases y paquetes falsos.

## [v0.4.2](https://github.com/ElMaxter99/chip-chop/releases/tag/v0.4.2) - 2026-11-25
### Added
- **Pantalla de Inicio en la app de escritorio:** al abrirla ya no pide una carpeta directamente, sino que muestra tus proyectos (añadir, abrir, quitar de la lista), la IA de partida para todos ellos (proveedor y modelo por etapa, guardado en `~/.chipchop/ai.yaml`) y los ajustes (versión, canal de actualización, estado del sistema). Dentro de un proyecto, «‹ Inicio» o Ctrl/⌘+H vuelven a ella.

### Fixed
- **La descarga del navegador de capturas ya no es un aviso suelto:** se muestra dentro de la ventana con una explicación, una animación y el progreso real, y ya no hace que la app se cierre sola al terminar (se cerraba al desaparecer la ventanita de aviso).

## [v0.4.1](https://github.com/ElMaxter99/chip-chop/releases/tag/v0.4.1) - 2026-11-25
### Fixed
- **La app de escritorio no arrancaba en Windows** («Package subpath './cli.js' is not defined by "exports"»): no localizaba el instalador de Chromium. Ahora lo localiza y la prueba automática del empaquetado comprueba ese paso.

## [v0.4.0](https://github.com/ElMaxter99/chip-chop/releases/tag/v0.4.0) - 2026-11-25
### Added
- **Instalables nativos como los de pdf-annotator:** la app local de chip-chop ahora también se publica como programa de escritorio (Electron), sin Node ni terminal: `.exe` para Windows, `.dmg` para macOS (sin validar en un Mac real) y AppImage / `.deb` / `.rpm` para Linux. Elige la carpeta del proyecto al abrirla (Archivo › Abrir proyecto), descarga Chromium la primera vez y se actualiza con los mismos canales «Solo estables» / «Últimas». Los paquetes `.tar.gz` / `.zip` para la terminal siguen publicándose.

## [v0.3.0](https://github.com/ElMaxter99/chip-chop/releases/tag/v0.3.0) - 2026-11-25
### Added
- **Flujo de versiones al estilo pdf-annotator:** changelog por ficheros, release en borrador con notas del CHANGELOG, candidatas `-rc.N` con la versión sacada de la etiqueta, canales «Solo estables» / «Últimas» y paquete para macOS (sin validar en un Mac real).

### Fixed
- **`chip-chop --version` imprimía la ayuda** en vez del número de versión; ahora imprime solo la versión (también `-v`).
