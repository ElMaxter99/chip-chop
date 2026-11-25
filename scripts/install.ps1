# chip-chop installer for Windows. Needs Node >= 22 and git. Run:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = if ($env:CHIPCHOP_PREFIX) { $env:CHIPCHOP_PREFIX } else { Join-Path $env:LOCALAPPDATA "chip-chop" }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node 22+ is required (https://nodejs.org)" }
$major = [int](node -p "process.versions.node.split('.')[0]")
if ($major -lt 22) { throw "Node 22+ is required, found $(node -v)" }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "git is required" }

if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Recurse -Force (Join-Path $here "chip-chop\*") $dest
$bin = Join-Path $dest "bin"
New-Item -ItemType Directory -Force -Path $bin | Out-Null
Set-Content -Encoding ASCII -Path (Join-Path $bin "chip-chop.cmd") -Value "@echo off`r`nnode `"%~dp0..\dist\cli.js`" %*"

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
