$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$launcher = Join-Path $PSScriptRoot 'start-village.ps1'
$oldExecutable = Join-Path $projectRoot 'dist\Village\Village.Desktop.exe'
$executable = Join-Path $projectRoot 'dist\Village\Village.exe'
if (-not (Test-Path -LiteralPath $executable)) { throw "Execute tools/build-native.ps1 -Export primeiro." }
$iconPath = Join-Path $projectRoot 'assets\app-icon\villagegen-flat.ico'
if (-not (Test-Path -LiteralPath $iconPath)) {
    throw "Icone do Village nao encontrado: $iconPath"
}
$desktopPath = [Environment]::GetFolderPath('DesktopDirectory')
$shortcutPath = Join-Path $desktopPath 'VillageGen.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
if ((Test-Path -LiteralPath $shortcutPath) -and -not $shortcut.Arguments.Contains($launcher) -and $shortcut.TargetPath -ne $executable -and $shortcut.TargetPath -ne $oldExecutable) {
    throw "Ja existe outro atalho em $shortcutPath. Ele foi preservado."
}
$shortcut.TargetPath = $executable
$shortcut.Arguments = ''
$shortcut.WorkingDirectory = Split-Path $executable -Parent
$shortcut.Description = 'VillageGen — gerador procedural nativo, Godot e C#.'
$shortcut.IconLocation = "$iconPath,0"
$shortcut.WindowStyle = 1
$shortcut.Save()
Write-Output $shortcutPath
