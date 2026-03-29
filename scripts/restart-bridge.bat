@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%.."
set "TASK_NAME=CodexTelegramBridge"
set "START_MODE="

pushd "%PROJECT_ROOT%" >nul

if not exist ".env" (
  echo [ERROR] No se encontro .env en "%PROJECT_ROOT%".
  popd >nul
  exit /b 1
)

echo [1/4] Compilando el proyecto...
call npm run build
if errorlevel 1 (
  echo [ERROR] La compilacion ha fallado.
  popd >nul
  exit /b 1
)

echo [2/5] Deteniendo instancias anteriores del bridge...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%stop-bridge-processes.ps1"
if errorlevel 1 (
  echo [ERROR] No se pudieron detener las instancias previas del bridge.
  popd >nul
  exit /b 1
)

echo [3/5] Registrando o actualizando el inicio automatico...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install-startup-task.ps1" -TaskName "%TASK_NAME%"
if not errorlevel 1 (
  set "START_MODE=task"
)

if errorlevel 1 (
  echo [WARN] No se pudo registrar la tarea programada. Voy a usar el inicio automatico del usuario.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install-startup-shortcut.ps1"
  if errorlevel 1 (
    echo [ERROR] Tampoco se pudo instalar el acceso directo de inicio.
    popd >nul
    exit /b 1
  )
  set "START_MODE=shortcut"
)

echo [4/5] Reiniciando la tarea...
if "%START_MODE%"=="task" (
  powershell -NoProfile -Command "try { Stop-ScheduledTask -TaskName '%TASK_NAME%' -ErrorAction SilentlyContinue } catch { }"
  powershell -NoProfile -Command "Start-ScheduledTask -TaskName '%TASK_NAME%'"
  if errorlevel 1 (
    echo [ERROR] No se pudo iniciar la tarea programada.
    popd >nul
    exit /b 1
  )
)

if "%START_MODE%"=="shortcut" (
  cscript //nologo "%SCRIPT_DIR%start-bridge-hidden.vbs"
  if errorlevel 1 (
    echo [ERROR] No se pudo iniciar el bridge usando el acceso directo de inicio.
    popd >nul
    exit /b 1
  )
)

echo [5/5] Estado actual:
if "%START_MODE%"=="task" (
  powershell -NoProfile -Command "Get-ScheduledTaskInfo -TaskName '%TASK_NAME%' | Format-List LastRunTime,LastTaskResult,NextRunTime"
)

if "%START_MODE%"=="shortcut" (
  powershell -NoProfile -Command "$projectRoot = (Resolve-Path '.').Path; Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*dist/index.js*' -and $_.CommandLine -like ('*' + $projectRoot.Replace('\', '\\') + '*') } | Select-Object ProcessId,Name,CommandLine | Format-List"
)

echo.
echo Servicio reiniciado correctamente.
if "%START_MODE%"=="task" (
  echo Quedara configurado para iniciarse al iniciar sesion en Windows mediante tarea programada.
)

if "%START_MODE%"=="shortcut" (
  echo Quedara configurado para iniciarse al iniciar sesion en Windows mediante la carpeta Inicio del usuario.
)

popd >nul
endlocal
