param(
    [string]$SkillName = "telegram-codex-bridge",
    [string]$DestinationRoot = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($DestinationRoot)) {
    if ($env:CODEX_HOME) {
        $DestinationRoot = Join-Path $env:CODEX_HOME "skills"
    }
    else {
        $DestinationRoot = Join-Path $HOME ".codex\skills"
    }
}

$destinationSkill = Join-Path $DestinationRoot $SkillName

if (Test-Path $destinationSkill) {
    Remove-Item -Recurse -Force $destinationSkill
    Write-Host "Skill eliminada de: $destinationSkill"
}
else {
    Write-Host "No existe la skill en: $destinationSkill"
}
