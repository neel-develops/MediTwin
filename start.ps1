# MediTwin one-command launcher (Windows PowerShell).
#   powershell -ExecutionPolicy Bypass -File start.ps1            # build + run on http://localhost:8000
#   powershell -ExecutionPolicy Bypass -File start.ps1 -Dev       # hot-reload dev mode (API :8000, UI :5173)
#   powershell -ExecutionPolicy Bypass -File start.ps1 -Reset     # start with fresh demo data
param([switch]$Dev, [switch]$Reset, [int]$Port = 8000)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$py = Join-Path $backend '.venv\Scripts\python.exe'

function Step($msg) { Write-Host "`n> $msg" -ForegroundColor Cyan }

if (-not (Test-Path $py)) {
  Step 'Creating Python virtual environment'
  $sysPy = Get-Command python -ErrorAction SilentlyContinue
  if (-not $sysPy) { $sysPy = Get-Command py -ErrorAction SilentlyContinue }
  if (-not $sysPy) { throw 'Python 3.11+ is required (https://www.python.org/downloads/).' }
  & $sysPy.Source -m venv (Join-Path $backend '.venv')
}
Step 'Installing backend packages'
& $py -m pip install -q --disable-pip-version-check -r (Join-Path $backend 'requirements.txt')

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'Node.js 20+ is required (https://nodejs.org/).' }
if (-not (Test-Path (Join-Path $frontend 'node_modules'))) {
  Step 'Installing frontend packages'
  npm --prefix $frontend install --no-audit --no-fund
}

if ($Reset) {
  Step 'Resetting demo data'
  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $backend 'data\meditwin.db*')
}

if ($Dev) {
  Step "Starting API on http://localhost:$Port and UI on http://localhost:5173"
  $api = Start-Process -PassThru -NoNewWindow $py -ArgumentList '-m', 'uvicorn', 'app.main:app', '--app-dir', $backend, '--port', $Port, '--reload', '--reload-dir', (Join-Path $backend 'app')
  try { npm --prefix $frontend run dev } finally { Stop-Process -Id $api.Id -ErrorAction SilentlyContinue }
} else {
  Step 'Building the frontend'
  npm --prefix $frontend run build
  Step "MediTwin is running at http://localhost:$Port  (Ctrl+C to stop)"
  Start-Process "http://localhost:$Port" | Out-Null
  & $py -m uvicorn app.main:app --app-dir $backend --port $Port
}
