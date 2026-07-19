$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'render-temperate.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar edificios.' }
& (Join-Path $PSScriptRoot 'render-environment.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar ambiente.' }
