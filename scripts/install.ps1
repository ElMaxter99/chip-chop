# chip-chop installer for Windows. Needs Node >= 22 and git. Run:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = if ($env:CHIPCHOP_PREFIX) { $env:CHIPCHOP_PREFIX } else { Join-Path $env:LOCALAPPDATA "chip-chop" }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node 22+ is required (https://nodejs.org)" }
$major = [int](node -p "process.versions.node.split('.')[0]")
if ($major -lt 22) { throw "Node 22+ is required, found $(node -v)" }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "git is required" }

# Se instala en un directorio nuevo y se conmuta (renombrar), en vez de borrar $dest y copiar encima: `chip-chop update` se
# ejecuta desde esa misma instalación y, si algo la ocupa (un terminal dentro de ella), la instalación anterior se conserva.
$dest = $dest.TrimEnd("\", "/")
$stage = "$dest.new"; $old = "$dest.old"
foreach ($p in @($stage, $old)) { if (Test-Path -LiteralPath $p) { Remove-Item -Recurse -Force -LiteralPath $p } }
try {
  New-Item -ItemType Directory -Force -Path $stage | Out-Null
  Copy-Item -Recurse -Force (Join-Path $here "chip-chop\*") $stage
  $stageBin = Join-Path $stage "bin"
  New-Item -ItemType Directory -Force -Path $stageBin | Out-Null
  # Las dos primeras lineas NO deben cambiar entre versiones: cmd.exe relee el .bat por posicion al terminar node, y un
  # `chip-chop update` en curso sigue leyendo el launcher que acaba de ser reemplazado. La tercera linea cierra con el codigo de node.
  Set-Content -Encoding ASCII -Path (Join-Path $stageBin "chip-chop.cmd") -Value "@echo off`r`nnode `"%~dp0..\dist\cli.js`" %*`r`nexit /b %errorlevel%"
} catch {
  if (Test-Path -LiteralPath $stage) { Remove-Item -Recurse -Force -LiteralPath $stage -ErrorAction SilentlyContinue }
  throw
}
$hadOld = Test-Path -LiteralPath $dest
try {
  if ($hadOld) {
    # antivirus/indexador pueden ocupar la carpeta unos instantes: unos reintentos antes de rendirse
    for ($i = 1; $true; $i++) {
      try { Move-Item -LiteralPath $dest -Destination $old; break } catch { if ($i -ge 5) { throw }; Start-Sleep -Milliseconds 700 }
    }
  }
  Move-Item -LiteralPath $stage -Destination $dest
} catch {
  $err = $_
  if ($hadOld -and -not (Test-Path -LiteralPath $dest) -and (Test-Path -LiteralPath $old)) { Move-Item -LiteralPath $old -Destination $dest }
  if (Test-Path -LiteralPath $stage) { Remove-Item -Recurse -Force -LiteralPath $stage -ErrorAction SilentlyContinue }
  throw "Could not replace $dest (is a terminal or program using that folder?). The previous installation was kept. $err"
}
if (Test-Path -LiteralPath $old) {
  try { Remove-Item -Recurse -Force -LiteralPath $old -ErrorAction Stop }
  catch { Write-Host "Note: could not delete $old (in use); it is removed on the next install." }
}
$bin = Join-Path $dest "bin"

if (-not $env:CHIPCHOP_SKIP_PATH) {
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (($userPath -split ";") -notcontains $bin) {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$bin", "User")
    Write-Host "Added $bin to your user PATH. Open a new terminal to use 'chip-chop'."
  }
}
if (-not $env:CHIPCHOP_SKIP_BROWSER) {
  Write-Host "Installing Chromium for Playwright (one-time download)..."
  Push-Location $dest
  node node_modules\playwright\cli.js install chromium
  Pop-Location
}
Write-Host "Installed: $bin\chip-chop.cmd"
Write-Host "Next: chip-chop doctor"
