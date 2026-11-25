# Changelog

## Unreleased

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
