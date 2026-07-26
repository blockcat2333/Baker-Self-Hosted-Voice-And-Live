[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')]
    [string] $Configuration = 'Debug',

    [switch] $WithWebRTC
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$cmake = Get-BakerLiteCMake
$ctest = Join-Path (Split-Path -Parent $cmake) 'ctest.exe'
if (-not (Test-Path -LiteralPath $ctest)) {
    throw "CTest was not found next to CMake: $ctest"
}

$preset = if ($WithWebRTC) { 'media-tests' } else { 'shell-tests' }
if ($WithWebRTC -and $Configuration -ne 'Release') {
    throw 'The pinned WebRTC library is a Release build; use -Configuration Release.'
}

Push-Location $projectRoot
try {
    Invoke-BakerLiteNative $ctest @(
        '--preset',
        $preset,
        '--output-on-failure'
    ) 'Baker Lite tests failed'
}
finally {
    Pop-Location
}
