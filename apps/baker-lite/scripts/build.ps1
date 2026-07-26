[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')]
    [string] $Configuration = 'Debug',

    [switch] $WithWebRTC,

    [switch] $Bootstrap,

    [switch] $ConfigureOnly,

    [string] $CacheRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$dependencyRoot = Get-BakerLiteDependencyRoot -RequestedRoot $CacheRoot
$env:BAKER_LITE_DEPS_ROOT = $dependencyRoot

if ($Bootstrap) {
    $component = if ($WithWebRTC) { 'All' } else { 'Qt' }
    & (Join-Path $PSScriptRoot 'bootstrap-dependencies.ps1') `
        -Component $component `
        -CacheRoot $dependencyRoot
    if ($LASTEXITCODE -ne 0) {
        throw 'Dependency bootstrap failed.'
    }
}

$cmake = Get-BakerLiteCMake
$configurePreset = if ($WithWebRTC) { 'windows-x64-media' } else { 'windows-x64-shell' }
$buildPreset = if ($WithWebRTC) {
    if ($Configuration -ne 'Release') {
        throw 'The pinned WebRTC library is a Release build; use -Configuration Release.'
    }
    'media-release'
}
elseif ($Configuration -eq 'Release') {
    'shell-release'
}
else {
    'shell-debug'
}

Push-Location $projectRoot
try {
    Invoke-BakerLiteNative $cmake @('--preset', $configurePreset) 'Baker Lite configuration failed'
    if (-not $ConfigureOnly) {
        Invoke-BakerLiteNative $cmake @('--build', '--preset', $buildPreset) 'Baker Lite build failed'
    }
}
finally {
    Pop-Location
}
