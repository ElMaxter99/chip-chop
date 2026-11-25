#!/usr/bin/env bash
# Builds chip-chop-<version>-linux.tar.gz, -macos.tar.gz (sin validar en un Mac real) and -windows.zip.
# Dependencies are pure JavaScript (browsers are downloaded at install time), so one tree serves both.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="$(node -p "require('$ROOT/packages/core/package.json').version")"
TGZ="$(cd "$ROOT" && npm pack --workspace chip-chop --pack-destination "$ROOT" --silent | tail -1)"
make() { # $1 = linux|macos|windows, $2 = installer script
  local OUT="$ROOT/chip-chop-$VER-$1"
  rm -rf "$OUT"; mkdir -p "$OUT/chip-chop"
  tar xzf "$ROOT/$TGZ" --strip-components=1 -C "$OUT/chip-chop"
  (cd "$OUT/chip-chop" && npm install --omit=dev --ignore-scripts --no-audit --no-fund)
  cp "$ROOT/scripts/$2" "$OUT/$2"; chmod +x "$OUT/$2"
  cp "$ROOT/README.md" "$ROOT/LICENSE" "$OUT/"
}
make linux install.sh
make macos install.sh
make windows install.ps1
tar czf "$ROOT/chip-chop-$VER-linux.tar.gz" -C "$ROOT" "chip-chop-$VER-linux"
tar czf "$ROOT/chip-chop-$VER-macos.tar.gz" -C "$ROOT" "chip-chop-$VER-macos"
(cd "$ROOT" && zip -qr "chip-chop-$VER-windows.zip" "chip-chop-$VER-windows")
rm -rf "$ROOT/chip-chop-$VER-linux" "$ROOT/chip-chop-$VER-macos" "$ROOT/chip-chop-$VER-windows"
ls -la "$ROOT"/chip-chop-"$VER"*
