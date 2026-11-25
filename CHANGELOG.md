# Changelog

## Unreleased

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
