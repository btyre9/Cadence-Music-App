# Builds Cadence for Windows into one folder you can run from (Cadence.exe).
# Usage: .\build.ps1 [destination] [-Runtime win-x64|win-arm64]
param([string]$Destination = "", [string]$Runtime = "win-x64")
$ErrorActionPreference = 'Stop'
if (-not $Destination) { $Destination = Join-Path $PSScriptRoot "..\build\Cadence-Windows" }
$Destination = [IO.Path]::GetFullPath($Destination)
dotnet publish (Join-Path $PSScriptRoot "Cadence\Cadence.csproj") -c Release -r $Runtime --self-contained true -o $Destination
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Built $Destination\Cadence.exe"
