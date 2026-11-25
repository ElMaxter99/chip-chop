#!/usr/bin/env bash
# chip-chop installer for Linux and macOS (macOS: sin validar en un Mac real). Needs Node >= 22 and git. Installs under ~/.local.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="${CHIPCHOP_PREFIX:-$HOME/.local/share/chip-chop}"
BIN="${CHIPCHOP_BIN:-$HOME/.local/bin}"

command -v node >/dev/null || { echo "Node 22+ is required (https://nodejs.org)"; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || { echo "Node 22+ is required, found $(node -v)"; exit 1; }
command -v git >/dev/null || { echo "git is required"; exit 1; }

rm -rf "$DEST"; mkdir -p "$DEST" "$BIN"
cp -r "$HERE/chip-chop/." "$DEST/"
printf '#!/usr/bin/env bash\nexec node "%s/dist/cli.js" "$@"\n' "$DEST" > "$BIN/chip-chop"
chmod +x "$BIN/chip-chop"
# macOS: quita la marca de cuarentena que deja un archivo descargado con el navegador (si no, Gatekeeper puede bloquear el binario de Chromium).
[ "$(uname -s)" = "Darwin" ] && xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

if [ -z "${CHIPCHOP_SKIP_BROWSER:-}" ]; then
  echo "Installing Chromium for Playwright (one-time download)..."
  (cd "$DEST" && node node_modules/playwright/cli.js install chromium)
fi
echo "Installed: $BIN/chip-chop"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "Add to your PATH:  export PATH=\"$BIN:\$PATH\"  (en macOS: ~/.zshrc)";; esac
echo "Next: chip-chop doctor"
