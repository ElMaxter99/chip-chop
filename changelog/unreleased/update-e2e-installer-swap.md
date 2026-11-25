---
type: Fixed
---
**Actualización probada de extremo a extremo y más segura:** `chip-chop update --check` ya no ignora `--channel` (ni, sin canal, instalaba en vez de solo comprobar); los instaladores (`install.sh`, `install.ps1`) copian a una carpeta nueva y la conmutan, de modo que un fallo o una carpeta ocupada en Windows no dejan la instalación rota; nuevo `CHIPCHOP_RELEASES_URL` (solo pruebas) y e2e `update.e2e.ts` con releases y paquetes falsos.
