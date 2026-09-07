param([string]$Blender = 'C:\Program Files\Blender Foundation\Blender 4.5\blender.exe')
$ErrorActionPreference = 'Stop'
& $Blender --background --factory-startup --python "$PSScriptRoot/export_models.py"
if ($LASTEXITCODE -ne 0) { throw "Blender export failed: $LASTEXITCODE" }
