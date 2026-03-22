param(
    [string]$SkillName = "telegram-codex-bridge",
    [string]$DestinationRoot = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceSkill = Join-Path $projectRoot "skills\$SkillName"

if (-not (Test-Path $sourceSkill)) {
    throw "No se encontro la skill en $sourceSkill"
}

if ([string]::IsNullOrWhiteSpace($DestinationRoot)) {
    if ($env:CODEX_HOME) {
        $DestinationRoot = Join-Path $env:CODEX_HOME "skills"
    }
    else {
        $DestinationRoot = Join-Path $HOME ".codex\skills"
    }
}

$destinationSkill = Join-Path $DestinationRoot $SkillName

New-Item -ItemType Directory -Force -Path $DestinationRoot | Out-Null

if (Test-Path $destinationSkill) {
    Remove-Item -Recurse -Force $destinationSkill
}

Copy-Item -Recurse -Force $sourceSkill $destinationSkill

Write-Host "Skill instalada en: $destinationSkill"
Write-Host "Puedes invocarla desde Codex como `$${SkillName}"
