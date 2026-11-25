# Cómo se publica una versión

Flujo copiado de [pdf-annotator](https://github.com/ElMaxter99/pdf-annotator) y adaptado a chip-chop Cada release lleva **instalables nativos** de la app de escritorio (Electron, carpeta `desktop/`: `.exe`, `.dmg`, AppImage, `.deb`, `.rpm`, más los `latest*.yml` del actualizador) y los **paquetes para terminal** `chip-chop-<versión>-{linux.tar.gz,macos.tar.gz,windows.zip}` y el `.tgz` de npm.
**Diferencia con pdf-annotator:** aquí solo hay rama `main` (sin `develop`/`master`/`release/*`), y la etiqueta la crea el propio workflow al publicar, porque el entorno donde se desarrolla no puede empujar etiquetas.

## Parte A · Para personas

**Idea:** antes de una versión de verdad (p. ej. 0.3.0) se puede publicar una o varias **candidatas** (`0.3.0-rc.1`, `rc.2`…) para instalarlas y probarlas. Una RC es un ensayo de *la misma* versión: mismo código, pre-release en GitHub, y las apps con el canal «Solo estables» no la ven; las del canal «Últimas» sí.

1. **Cada cambio con su nota.** Cada PR que toque la app añade un fichero en `changelog/unreleased/` (ver `changelog/README.md`).
2. **Preparar la versión (PR a `main`):** `npm run changelog:release -- X.Y.Z` (junta las notas en `CHANGELOG.md`) y subir `version` en `packages/core/package.json` (y el `package-lock.json` si lo hubiera).
3. **(Recomendado en cambios grandes) Candidata:** Actions → *Release candidate* → *Run workflow*, versión `X.Y.Z`. Primero con **dry run** (construye y prueba sin publicar), luego sin él: sale `X.Y.Z-rc.1` (la siguiente, `rc.2`). No toca ningún fichero.
4. **Probarla:** bajar el paquete de tu sistema desde Releases, o `chip-chop update channel latest && chip-chop update`.
5. **Versión final:** al fusionar en `main` la PR del paso 2, el workflow *Release* detecta una versión sin release, pasa los checks, construye los tres paquetes, crea la release **en borrador** con las notas del CHANGELOG y la **publica** (publicar es lo que activa el aviso de actualización de las apps). También se puede lanzar a mano desde Actions.
6. **Si algo falla:** se arregla en otra PR (sin tocar la versión) y se saca otra RC; una RC no se edita ni se borra.

## Parte B · Checklist para la IA

- No lanzar *Release candidate* ni subir la versión final sin que el usuario lo pida expresamente para esa versión.
- Antes: `npm run validate:schemas && npm run typecheck && npm test && npm run test:scripts && npm run test:e2e --workspace chip-chop`.
- `node scripts/release-notes.mjs X.Y.Z` debe mostrar las notas (no «no tiene sección»).
- Qué hace cada workflow:
  - `release.yml` (push a `main` que cambie `packages/core/package.json`, `scripts/**` o el propio workflow; o a mano): decide si `vX.Y.Z` ya existe (`gh release view`); si no, checks + e2e + `scripts/make-bundle.sh` + smoke de Linux; `smoke-windows` (bloquea); `smoke-macos` (**informativo**, `continue-on-error`); `publish`: borrador con todos los archivos y notas → publica y comprueba que la etiqueta quedó fijada.
  - `release-candidate.yml` (solo a mano; `dry_run` por defecto): valida `X.Y.Z`, falla si ya es final, calcula `rc.N`, aplica la versión solo en el runner (`npm version … --no-git-tag-version`), mismos checks y paquetes, y publica como **pre-release** con aviso de prueba.
  - `ci.yml`: `check` y `e2e` en Linux y Windows; `macos` informativo; `changelog` en PR (falla si se toca la app sin entrada).
- Job `installers` (4 sistemas; los de macOS informativos): `node desktop/prepare-core.mjs` (núcleo + dependencias de producción en `desktop/app-core`) y `electron-builder` desde `desktop/`; `publish` une los dos `*-mac.yml` (`scripts/merge-mac-feed.mjs`) y adjunta todo. `ci.yml` (job `desktop`) empaqueta con `--dir`, comprueba el contenido (`desktop/verify-pack.mjs`) y arranca la app empaquetada (`desktop/smoke.mjs`).
- La app de escritorio actualiza con `electron-updater` (feed «generic» de la versión que elige el núcleo): automático en Windows y AppImage, manual (abre la página de descargas) en macOS, `.deb` y `.rpm`.
- El actualizador (`packages/core/src/updater.ts`) elige la release así: `stable` solo versiones finales, `latest` además `-rc.N`; la final gana a sus RC; los borradores nunca cuentan; busca el asset `-linux.tar.gz`, `-windows.zip` o `-macos.tar.gz`.
- **Probar el actualizador sin una release real:** `CHIPCHOP_RELEASES_URL` sustituye la URL de la API de releases (solo para pruebas; vacía = GitHub). `packages/core/src/update.e2e.ts` (parte de `npm run test:e2e`, en Linux y Windows) levanta un servidor local con releases falsas (estable, `-rc.N` más nueva, borrador) y un paquete mínimo con el layout real y los `install.sh`/`install.ps1` reales, y ejecuta `chip-chop update --check` y `update` en ambos canales con `CHIPCHOP_PREFIX` temporal; también la auto-actualización desde el launcher instalado.
- **Los instaladores no borran la instalación en uso:** `install.sh`/`install.ps1` copian a `<prefijo>.new`, renombran la actual a `<prefijo>.old`, conmutan y borran `.old` (si Windows la tiene ocupada, se queda y se limpia en la siguiente instalación; si no se puede conmutar, se conserva la anterior). El `chip-chop.cmd` conserva sus dos primeras líneas idénticas entre versiones porque `cmd.exe` relee el `.cmd` por posición al terminar `node`.

### Problemas conocidos
- Un **borrador** que quede de un intento fallido hace que `gh release view` diga que «ya existe»: borrarlo a mano (con aprobación del usuario) y relanzar.
- Una release publicada como `untagged-…` no la ve el actualizador: el workflow fija `--tag` y lo comprueba; si falla, editar la release en la web y elegir la etiqueta.
- **macOS no se ha validado nunca en un Mac real**: el paquete, el instalador (`install.sh`, quita la cuarentena de Gatekeeper), `chip-chop update` y `chip-chop ui` (`open`) están sin probar más allá del smoke del runner.
- Los instalables no van firmados (SmartScreen / Gatekeeper avisan); el `.exe`, el `.dmg` y los de Linux nunca se han instalado a mano: solo se ha probado que el empaquetado arranca en el CI.
- Los paquetes no van firmados; no hay firma ni notarización.
- Publicar en npm es manual: `npm publish --workspace chip-chop --access public` (el nombre `chip-chop` no está verificado).
