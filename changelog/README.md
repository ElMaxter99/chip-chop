# CHANGELOG por ficheros

Cada PR que cambie la app (`packages/core/src|ui`, instaladores) añade **un fichero** en `changelog/unreleased/` en vez de editar `CHANGELOG.md`; así dos PRs nunca chocan. Al subir de versión se juntan y se borran.

```
---
type: Added
---
**Título en negrita:** qué cambia y por qué.
```

`type`: `Added`, `Changed`, `Fixed`, `Security`, `Removed` o `none` (la PR no necesita entrada).

- `npm run changelog:check -- --base origin/main` · valida (el CI falla si una PR toca la app sin entrada).
- `npm run changelog:preview` · cómo quedaría la próxima sección.
- `npm run changelog:release -- X.Y.Z` · escribe la sección en `CHANGELOG.md` y borra los ficheros.
