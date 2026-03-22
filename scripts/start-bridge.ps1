Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $projectRoot "logs"
$stdoutLog = Join-Path $logDir "bridge.stdout.log"
$stderrLog = Join-Path $logDir "bridge.stderr.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Set-Location $projectRoot

if (-not (Test-Path (Join-Path $projectRoot ".env"))) {
    throw "No se encontro .env en $projectRoot"
}

if (-not (Test-Path (Join-Path $projectRoot "dist\\index.js"))) {
    throw "No se encontro dist\\index.js. Ejecuta 'npm run build' antes de instalar el arranque automatico."
}

$nodeCommand = Get-Command node -ErrorAction Stop

while ($true) {
    Add-Content -Path $stdoutLog -Value ("[{0}] Iniciando Codex Telegram Bridge" -f (Get-Date -Format s))

    & $nodeCommand.Source "dist/index.js" 1>> $stdoutLog 2>> $stderrLog
    $exitCode = $LASTEXITCODE

    if ($exitCode -eq 0) {
        Add-Content -Path $stdoutLog -Value ("[{0}] Proceso finalizado con codigo 0. Reiniciando en 5 segundos." -f (Get-Date -Format s))
    }
    else {
        Add-Content -Path $stderrLog -Value ("[{0}] Proceso finalizado con codigo {1}. Reintentando en 10 segundos." -f (Get-Date -Format s), $exitCode)
        Start-Sleep -Seconds 10
        continue
    }

    Start-Sleep -Seconds 5
}
