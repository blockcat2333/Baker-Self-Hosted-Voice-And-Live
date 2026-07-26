[CmdletBinding()]
param(
    [switch] $WithWebRTC,

    [switch] $Sign,

    [string] $DownloadUrl,

    [string] $CacheRoot,

    [string] $OutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$dependencyRoot = Get-BakerLiteDependencyRoot -RequestedRoot $CacheRoot
$env:BAKER_LITE_DEPS_ROOT = $dependencyRoot
$cmake = Get-BakerLiteCMake
$cpack = Join-Path (Split-Path -Parent $cmake) 'cpack.exe'
if (-not (Test-Path -LiteralPath $cpack)) {
    throw "cpack.exe was not found next to CMake: $cpack"
}
$versions = Import-PowerShellDataFile (Join-Path $PSScriptRoot 'dependency-versions.psd1')
$nsisRoot = Get-BakerLiteNsisRoot `
    -DependencyRoot $dependencyRoot `
    -Version $versions.NsisVersion
$makensis = Join-Path $nsisRoot 'makensis.exe'
if (-not (Test-Path -LiteralPath $makensis)) {
    & (Join-Path $PSScriptRoot 'bootstrap-dependencies.ps1') `
        -Component Tools `
        -CacheRoot $dependencyRoot
    if ($LASTEXITCODE -ne 0) {
        throw 'NSIS bootstrap failed.'
    }
}
$env:Path = "$nsisRoot;$env:Path"

$preset = if ($WithWebRTC) { 'windows-x64-media' } else { 'windows-x64-shell' }
$buildPreset = if ($WithWebRTC) { 'media-release' } else { 'shell-release' }
$buildDirectory = if ($WithWebRTC) {
    Join-Path $projectRoot 'out\build-media'
}
else {
    Join-Path $projectRoot 'out\build-shell'
}
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $projectRoot 'out\package'
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

Push-Location $projectRoot
try {
    Invoke-BakerLiteNative $cmake @('--preset', $preset) 'Baker Lite configuration failed'
    Invoke-BakerLiteNative $cmake @('--build', '--preset', $buildPreset) 'Baker Lite release build failed'
    Invoke-BakerLiteNative $cpack @(
        '--config', (Join-Path $buildDirectory 'CPackConfig.cmake'),
        '-C', 'Release',
        '-G', 'NSIS',
        '-B', $OutputDirectory
    ) 'Baker Lite NSIS packaging failed'
}
finally {
    Pop-Location
}

$artifact = Get-ChildItem -LiteralPath $OutputDirectory -Filter 'Baker-Lite-Setup-*-x64.exe' -File |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
if (-not $artifact) {
    throw "CPack did not produce a Baker Lite installer in $OutputDirectory"
}

if ($Sign) {
    & (Join-Path $PSScriptRoot 'sign-artifact.ps1') -FilePath $artifact.FullName
    if ($LASTEXITCODE -ne 0) {
        throw 'Installer signing failed.'
    }
}

$version = if ($artifact.BaseName -match '^Baker-Lite-Setup-(.+)-x64$') {
    $Matches[1]
}
else {
    throw "Cannot extract a version from installer name: $($artifact.Name)"
}
if (-not $DownloadUrl) {
    $DownloadUrl = "https://github.com/blockcat2333/Baker-Self-Hosted-Voice-And-Live/releases/download/baker-lite-v$version/$($artifact.Name)"
}

& (Join-Path $PSScriptRoot 'generate-update-manifest.ps1') `
    -ArtifactPath $artifact.FullName `
    -Version $version `
    -DownloadUrl $DownloadUrl `
    -OutputPath (Join-Path $OutputDirectory 'baker-lite-update.json')
if ($LASTEXITCODE -ne 0) {
    throw 'Update manifest generation failed.'
}

Write-Host "Installer: $($artifact.FullName)"
Write-Host "Manifest:  $(Join-Path $OutputDirectory 'baker-lite-update.json')"
