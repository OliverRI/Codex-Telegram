Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$bridgeParents = @(
    Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -eq "powershell.exe" -and
            $_.CommandLine -and
            $_.CommandLine -like "*scripts\start-bridge.ps1*"
        }
)

$bridgeLaunchers = @(
    Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -in @("wscript.exe", "cscript.exe") -and
            $_.CommandLine -and
            $_.CommandLine -like "*start-bridge-hidden.vbs*"
        }
)

$bridgeParentIds = @($bridgeParents | ForEach-Object { $_.ProcessId })
$nodeChildren = @(
    Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -eq "node.exe" -and (
                $_.ParentProcessId -in $bridgeParentIds -or
                ($_.CommandLine -and $_.CommandLine -like "*dist/index.js*")
            )
        }
)

$toStop = @($nodeChildren + $bridgeParents + $bridgeLaunchers) |
    Sort-Object ProcessId -Unique

if ($toStop.Count -eq 0) {
    Write-Output "No habia procesos activos del bridge."
    exit 0
}

foreach ($process in $toStop) {
    try {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    } catch {
        Write-Warning ("No se pudo detener {0} ({1}): {2}" -f $process.Name, $process.ProcessId, $_.Exception.Message)
    }
}

$toStop |
    Select-Object ProcessId, Name, ParentProcessId, CommandLine |
    Format-Table -AutoSize
