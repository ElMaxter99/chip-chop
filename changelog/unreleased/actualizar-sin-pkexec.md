---
type: Fixed
---
**«Actualizar ahora» del aviso de versión nueva ahora actualiza de verdad** (antes solo cambiaba de pestaña): abre la misma ventana de progreso que el botón Actualizar. **Si `pkexec` no puede elevar permisos** (error «pkexec must be setuid root», típico al abrir la app desde la terminal de un editor en snap/flatpak) se abre una terminal para escribir la contraseña con `sudo` y la actualización continúa; si tampoco hay terminal, se deja el paquete descargado y se explica el comando.
