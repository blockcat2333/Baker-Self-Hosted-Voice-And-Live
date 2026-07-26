[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $InstallRoot,

    [ValidateSet('Debug', 'Release')]
    [string] $Configuration = 'Release',

    [string] $QtRoot,

    [string] $CacheRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$dependencyRoot = Get-BakerLiteDependencyRoot -RequestedRoot $CacheRoot
if (-not $QtRoot) {
    $QtRoot = Get-BakerLiteQtRoot -DependencyRoot $dependencyRoot
}

$deployTool = Join-Path $QtRoot 'bin\windeployqt.exe'
if (-not (Test-Path -LiteralPath $deployTool)) {
    throw "windeployqt was not found: $deployTool"
}

$resolvedInstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$executableName = if ($Configuration -eq 'Debug') { 'Baker Lited.exe' } else { 'Baker Lite.exe' }
$executable = Join-Path $resolvedInstallRoot $executableName
if (-not (Test-Path -LiteralPath $executable)) {
    throw "Baker Lite executable was not found: $executable"
}

$configurationArgument = if ($Configuration -eq 'Debug') { '--debug' } else { '--release' }
Invoke-BakerLiteNative $deployTool @(
    $configurationArgument,
    '--force',
    '--compiler-runtime',
    '--no-translations',
    '--dir', $resolvedInstallRoot,
    $executable
) 'Qt runtime deployment failed'

$forbiddenNames = @(
    'Qt6Qml*.dll',
    'Qt6Quick*.dll',
    'Qt6WebEngine*.dll',
    'QtWebEngineProcess.exe',
    'node.exe',
    'electron.exe',
    'chrome_elf.dll'
)
foreach ($pattern in $forbiddenNames) {
    $match = Get-ChildItem -LiteralPath $resolvedInstallRoot -Filter $pattern -Recurse -File -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($match) {
        throw "Forbidden browser/QML runtime was deployed: $($match.FullName)"
    }
}

Write-Host "Qt runtime deployed to $resolvedInstallRoot"
