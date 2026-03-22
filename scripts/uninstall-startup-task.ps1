param(
    [string]$TaskName = "CodexTelegramBridge"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Tarea eliminada: $TaskName"
}
else {
    Write-Host "No existe la tarea: $TaskName"
}
