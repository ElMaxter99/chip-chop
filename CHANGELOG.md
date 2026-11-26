# Changelog

## Unreleased

## [v0.4.9](https://github.com/ElMaxter99/chip-chop/releases/tag/v0.4.9) - 2026-11-26
### Fixed
- **Las listas de modelos ya no van escritas a mano:** salen siempre de la herramienta. Copilot: de `copilot help` y `copilot help config`; Claude: de los alias que documenta `claude --help` y, con `ANTHROPIC_API_KEY`, de la API de Anthropic (`/v1/models`); Codex no publica lista. Si no se puede leer, solo se ofrece «Predeterminado» y «Otro…» con un aviso que lo explica, en vez de una lista que se queda atrás y falla (p. ej. un modelo que tu plan no tiene). Los modelos de la configuración básica solo se proponen si están en la lista real.

## [v0.4.8](https://github.com/ElMaxter99/chip-chop/releases/tag/v0.4.8) - 2026-11-26
### Fixed
- **«Probar esta etapa» explica por qué falla:** muestra lo que el programa escribió por stderr y, si la herramienta responde con su modelo por defecto pero no con el elegido, lo dice claramente («rechaza el modelo X») en vez de un error genérico.

## [v0.4.7](https://github.com/ElMaxter99/chip-chop/releases/tag/v0.4.7) - 2026-11-26
### Added
- **Pantalla de arranque con el logo animado:** la ventana aparece al instante y muestra qué está haciendo (preparando el entorno, cargando el motor, comprobando git, navegador y herramientas de IA) y, si tarda, avisa de que no se ha colgado. Además el arranque es más rápido: el PATH del usuario ya no bloquea la ventana y las comprobaciones se hacen a la vez. Los tiempos de cada fase salen en la consola (`[arranque]`).

### Fixed
- **Lista de modelos de Copilot completa:** si `copilot help` no la da entera, se muestran los modelos habituales (Claude, GPT, Gemini…) en lugar de solo «Auto»; la lectura de `copilot help` entiende más formatos (varias líneas, sin comillas).

## [v0.4.6](https://github.com/ElMaxter99/chip-chop/releases/tag/v0.4.6) - 2026-11-26
### Fixed
- **Actualizar en Linux (.deb/.rpm) sin salir de la app:** ahora se abre una ventana con el progreso (descargando, permisos, instalando, reiniciando), pide la contraseña de administrador con la ventana del sistema (polkit) y explica qué pasó si la cancelas o falla, con botón de reintentar. Al terminar chip-chop se cierra y se abre sola; ya no hay que cerrarla a mano. En Windows y AppImage se usa la misma ventana.

## [v0.4.5](https://github.com/ElMaxter99/chip-chop/releases/tag/v0.4.5) - 2026-11-25
### Added
- **Configuración inicial y control de la IA:** la primera vez la app descarga el navegador (con progreso) y deja la IA ya configurada con una configuración básica por herramienta (Claude, Copilot o Codex) en las cuatro etapas, que se puede cambiar. Los cambios en la pestaña IA se guardan solos con un aviso, al elegir herramienta se vuelven a buscar sus modelos (sin botón «Volver a buscar»), «Probar esta etapa» abre una ventana que muestra qué hace y el resultado, y si la herramienta o el modelo elegidos dejan de funcionar no se lanza la IA y se lleva al usuario a su configuración.

### Fixed
- **El icono de la app no se veía en Ubuntu:** el `.deb`, el `.rpm` y el AppImage solo llevaban un icono de 1024 px, que el lanzador y la barra de GNOME no usan. Ahora llevan todos los tamaños de 16 a 512 px.

## [v0.4.4](https://github.com/ElMaxter99/chip-chop/releases/tag/v0.4.4) - 2026-11-25
### Added
- **Funciones propias de una app de escritorio:** recuerda el tamaño y la posición de la ventana (y si estaba maximizada); avisa con una notificación del sistema cuando termina o falla una captura, comparación o generación con IA si la ventana no está al frente; se puede arrastrar la carpeta de una app sobre el Inicio para añadirla y abrirla; acepta la carpeta como argumento (`"Chip Chop.exe" C:\ruta\app`, también con la app ya abierta); y pregunta antes de cerrar si hay un trabajo en marcha.
- **IA: detección de herramientas, modelos en lista y Codex:** chip-chop encuentra Claude Code, Copilot y Codex aunque no estén en el PATH de la app (PATH del sistema en Windows, `~/.local/bin`, npm global, winget, nvm, shell de login), muestra dónde están, ofrece una lista de modelos por herramienta (la de Copilot se lee de `copilot help`) con «Otro…», y añade OpenAI Codex como proveedor (`codex exec`).

### Changed
- **Interfaz más cuidada:** pasos de «Preparar la app» alineados, cabecera en una sola fila, diálogos propios en vez de los del sistema con mensajes en español, panel de progreso al actualizar (fases, barra, tiempo y detalle), barras de desplazamiento con el estilo de la app y la app de escritorio sin barra de menú nativa en Windows y Linux (se muestra con Alt).
- **README completo con flujo, guía y capturas:** instalación por sistema, flujo de trabajo, guía paso a paso con capturas reales de la interfaz, canales de actualización, preguntas frecuentes y estado de pruebas. `npm run docs:check` vigila enlaces y capturas, y el workflow «Docs screenshots» las regenera.

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
