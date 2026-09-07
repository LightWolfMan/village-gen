param([switch]$Export, [switch]$Smoke)
. "$PSScriptRoot/native-env.ps1"
Push-Location $VillageRoot
try {
    node tools/sync-native-assets.mjs
    if ($LASTEXITCODE) { throw 'Asset sync failed' }
    & "$env:DOTNET_ROOT/dotnet.exe" build native/Village.Native.csproj -c Debug --nologo
    if ($LASTEXITCODE) { throw 'C# build failed' }
    & $VillageGodot --headless --path native --editor --import --quit
    if ($LASTEXITCODE) { throw 'Godot import failed' }
    if ($Smoke) {
        $env:VILLAGE_SMOKE_DIR = Join-Path $VillageRoot '.cache/native-smoke'
        & $VillageGodot --path native -- --smoke
        if ($LASTEXITCODE) { throw 'Native smoke failed' }
    }
    if ($Export) {
        New-Item -ItemType Directory -Path dist/Village -Force | Out-Null
        & $VillageGodot --headless --path native --export-release 'Windows Desktop' '../dist/Village/Village.exe'
        if ($LASTEXITCODE) { throw 'Native export failed' }
        Copy-Item -LiteralPath native/assets/ui/LICENSE-lucide -Destination dist/Village/LICENSE-lucide.txt
        Copy-Item -LiteralPath native/assets/ui/color/LICENSE -Destination dist/Village/LICENSE-fluent-emoji.txt
        Copy-Item -LiteralPath native/ThirdParty/LICENSE-selo-empire.txt -Destination dist/Village/LICENSE-selo-empire.txt
        Copy-Item -LiteralPath native/ThirdParty/LICENSE-road-generator.txt -Destination dist/Village/LICENSE-road-generator.txt
    }
} finally { Pop-Location }
