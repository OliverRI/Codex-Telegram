param(
    [string]$TaskName = "CodexTelegramBridge"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $PSScriptRoot "start-bridge.ps1"
$powershellExe = Join-Path $env:WINDIR "System32\\WindowsPowerShell\\v1.0\\powershell.exe"
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

if (-not (Test-Path (Join-Path $projectRoot ".env"))) {
    throw "No se encontro .env en $projectRoot"
}

if (-not (Test-Path (Join-Path $projectRoot "dist\\index.js"))) {
    throw "No se encontro dist\\index.js. Ejecuta 'npm run build' antes de instalar la tarea."
}

$action = New-ScheduledTaskAction `
    -Execute $powershellExe `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""

$trigger = New-ScheduledTaskTrigger -AtLogOn

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1)

$principal = New-ScheduledTaskPrincipal `
    -UserId $currentUser `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Inicia el puente Telegram -> Codex al iniciar sesion" `
    -Force | Out-Null

Write-Host "Tarea instalada: $TaskName"
Write-Host "Proyecto: $projectRoot"
Write-Host "Script de arranque: $scriptPath"
Write-Host "Para lanzarla ahora: Start-ScheduledTask -TaskName $TaskName"
