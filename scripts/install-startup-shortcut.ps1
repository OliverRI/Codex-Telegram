Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$launcherPath = Join-Path $PSScriptRoot "start-bridge-hidden.vbs"
$startupDir = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDir "CodexTelegramBridge.lnk"
$wscriptExe = Join-Path $env:WINDIR "System32\wscript.exe"

if (-not (Test-Path (Join-Path $projectRoot ".env"))) {
    throw "No se encontro .env en $projectRoot"
}

if (-not (Test-Path (Join-Path $projectRoot "dist\index.js"))) {
    throw "No se encontro dist\index.js. Ejecuta 'npm run build' antes de instalar el inicio automatico."
}

if (-not (Test-Path $launcherPath)) {
    throw "No se encontro el lanzador oculto en $launcherPath"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $wscriptExe
$shortcut.Arguments = "`"$launcherPath`""
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = "Inicia Codex Telegram Bridge al iniciar sesion"
$shortcut.IconLocation = "$wscriptExe,0"
$shortcut.Save()

Write-Host "Acceso directo de inicio creado en: $shortcutPath"
Write-Host "Se abrira al iniciar sesion en Windows sin necesitar permisos de administrador."
