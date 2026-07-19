param(
  [string]$BlenderPath = 'C:\Program Files\Blender Foundation\Blender 4.5\blender.exe'
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$scriptPath = Join-Path $PSScriptRoot 'render_temperate_buildings.py'
$outputPath = Join-Path $projectRoot 'assets\buildings\temperate'

if (-not (Test-Path -LiteralPath $BlenderPath -PathType Leaf)) {
  throw "Blender nao encontrado em: $BlenderPath"
}

& $BlenderPath --background --factory-startup --python $scriptPath -- --output $outputPath
if ($LASTEXITCODE -ne 0) {
  throw "O Blender encerrou com codigo $LASTEXITCODE."
}

Write-Host "Sprites atualizados em $outputPath"
