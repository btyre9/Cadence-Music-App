# Windows counterpart of test.sh: the C# ports of the Swift tests, then the shared interface tests.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
function Run([string]$exe, [string[]]$arguments) { & $exe @arguments; if ($LASTEXITCODE -ne 0) { throw "$exe $arguments failed" } }
Run dotnet @('run', '--project', (Join-Path $PSScriptRoot 'Cadence.Tests'))
Push-Location $root
try {
  Run node @('--check', 'Resources/app.js')
  Run node @('Tests/adapters.cjs')
  Run node @('Tests/custom-client.cjs')
  Run node @('--check', 'Resources/library-ui.js')
  Run node @('Tests/library.cjs')
  Run node @('--check', 'Resources/music-info.js')
  Run node @('Tests/now-release.cjs')
  Run node @('Tests/radio-navigation.cjs')
  Run node @('Tests/radio-save.cjs')
  Run node @('Tests/browse.cjs')
} finally { Pop-Location }
