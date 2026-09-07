param([switch]$DownloadOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$bench = Join-Path $root 'workbench'
$downloads = Join-Path $bench 'downloads'
New-Item -ItemType Directory -Path $downloads -Force | Out-Null
$godotVersion = '4.7.2-stable'
$base = "https://github.com/godotengine/godot-builds/releases/download/$godotVersion"
function Fetch($url, $path) {
    if (-not (Test-Path -LiteralPath $path)) {
        Write-Output "Downloading $url"
        Invoke-WebRequest -Uri $url -OutFile $path
    }
}
Fetch "$base/SHA512-SUMS.txt" (Join-Path $downloads 'Godot-SHA512-SUMS.txt')
foreach ($name in @("Godot_v$($godotVersion)_mono_win64.zip", "Godot_v$($godotVersion)_mono_export_templates.tpz")) {
    $path = Join-Path $downloads $name
    Fetch "$base/$name" $path
    $line = Get-Content (Join-Path $downloads 'Godot-SHA512-SUMS.txt') | Where-Object { $_ -match [regex]::Escape($name) }
    if (-not $line) { throw "Checksum missing for $name" }
    $expected = ($line -split '\s+')[0]
    if ((Get-FileHash -Algorithm SHA512 -LiteralPath $path).Hash -ne $expected) { throw "Checksum mismatch: $name" }
}
$metadataPath = Join-Path $downloads 'dotnet-8-releases.json'
Fetch 'https://builds.dotnet.microsoft.com/dotnet/release-metadata/8.0/releases.json' $metadataPath
$metadata = Get-Content $metadataPath -Raw | ConvertFrom-Json
$sdk = $metadata.releases[0].sdk
$file = $sdk.files | Where-Object { $_.rid -eq 'win-x64' -and $_.name -like '*.zip' } | Select-Object -First 1
if (-not $file) { throw 'No Windows x64 .NET SDK archive found' }
$sdkPath = Join-Path $downloads "dotnet-sdk-$($sdk.version)-win-x64.zip"
Fetch $file.url $sdkPath
if ((Get-FileHash -Algorithm SHA512 -LiteralPath $sdkPath).Hash -ne $file.hash) { throw 'SDK checksum mismatch' }
if (-not $DownloadOnly) {
    if (-not (Test-Path (Join-Path $bench 'dotnet/dotnet.exe'))) { Expand-Archive -LiteralPath $sdkPath -DestinationPath (Join-Path $bench 'dotnet') -Force }
    $godotPath = Join-Path $bench 'godot'
    if (-not (Test-Path "$godotPath/Godot_v$($godotVersion)_mono_win64")) {
        Expand-Archive -LiteralPath (Join-Path $downloads "Godot_v$($godotVersion)_mono_win64.zip") -DestinationPath $godotPath -Force
    }
    $templates = Join-Path $bench 'templates'
    if (-not (Test-Path "$templates/templates")) {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $downloads "Godot_v$($godotVersion)_mono_export_templates.tpz"), $templates)
    }
}
Write-Output "Portable native tools ready: $bench"
