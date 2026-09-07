$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$executable = Join-Path $projectRoot 'dist\Village\Village.exe'
if (-not (Test-Path -LiteralPath $executable)) {
    throw 'Execute tools/build-native.ps1 -Export para gerar o aplicativo Windows.'
}
Start-Process -FilePath $executable -WorkingDirectory (Split-Path $executable -Parent) -WindowStyle Normal
