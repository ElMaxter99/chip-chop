// Lógica pura del actualizador de la app de escritorio (sin Electron). La versión a instalar la elige el núcleo
// (canales «Solo estables» / «Últimas», ver packages/core/src/updater.ts); aquí solo se decide el modo y el feed.
export const RELEASES_URL = "https://github.com/ElMaxter99/chip-chop/releases";

/**
 * «auto»: la app descarga e instala sola (Windows NSIS y Linux AppImage).
 * «package»: Linux instalado con .deb/.rpm: la app descarga el paquete, pide la contraseña de administrador (polkit) y se reinicia.
 * «manual»: el botón abre la página de descargas (macOS sin firmar, o Linux sin un paquete reconocible).
 */
export function updateMode({ platform, appImage = false, packageKind = null }) {
  if (platform === "win32") return "auto";
  if (platform === "linux") return appImage ? "auto" : packageKind ? "package" : "manual";
  return "manual";
}

/**
 * Versión elegida → feed «generic» de esa release y nombre del canal de electron-updater. Desde una «-rc.N» el
 * canal «latest» nunca vería la final, así que se fija la etiqueta elegida y el archivo de canal que le corresponde
 * (`rc.yml` para una candidata, `latest.yml` para una final).
 */
export function feedForVersion(version) {
  const m = /^v?(\d+\.\d+\.\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(version ?? "").trim());
  if (!m) return null;
  const clean = m[1] + (m[2] ? `-${m[2]}` : "");
  return { url: `${RELEASES_URL}/download/v${clean}/`, channel: m[2] ? m[2].split(".")[0] : "latest" };
}
