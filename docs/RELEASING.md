# Cómo se publica una versión

Flujo copiado de [pdf-annotator](https://github.com/ElMaxter99/pdf-annotator) y adaptado a chip-chop (sin Electron: los «instaladores» son los paquetes `chip-chop-<versión>-{linux.tar.gz,macos.tar.gz,windows.zip}` más el `.tgz` de npm).
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
- El actualizador (`packages/core/src/updater.ts`) elige la release así: `stable` solo versiones finales, `latest` además `-rc.N`; la final gana a sus RC; los borradores nunca cuentan; busca el asset `-linux.tar.gz`, `-windows.zip` o `-macos.tar.gz`.

### Problemas conocidos
- Un **borrador** que quede de un intento fallido hace que `gh release view` diga que «ya existe»: borrarlo a mano (con aprobación del usuario) y relanzar.
- Una release publicada como `untagged-…` no la ve el actualizador: el workflow fija `--tag` y lo comprueba; si falla, editar la release en la web y elegir la etiqueta.
- **macOS no se ha validado nunca en un Mac real**: el paquete, el instalador (`install.sh`, quita la cuarentena de Gatekeeper), `chip-chop update` y `chip-chop ui` (`open`) están sin probar más allá del smoke del runner.
- Los paquetes no van firmados; no hay firma ni notarización.
- Publicar en npm es manual: `npm publish --workspace chip-chop --access public` (el nombre `chip-chop` no está verificado).
