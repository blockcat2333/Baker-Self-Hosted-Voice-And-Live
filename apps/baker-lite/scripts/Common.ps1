Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-BakerLiteNative {
    param(
        [Parameter(Mandatory)]
        [string] $FilePath,

        [Parameter()]
        [string[]] $ArgumentList = @(),

        [Parameter()]
        [string] $FailureMessage = "Native command failed"
    )

    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage (exit code $LASTEXITCODE): $FilePath $($ArgumentList -join ' ')"
    }
}

function Get-BakerLiteCMake {
    $candidates = @(
        (Join-Path $env:ProgramFiles 'CMake\bin\cmake.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft Visual Studio\2022\Professional\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft Visual Studio\2022\Enterprise\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'),
        (Get-Command cmake -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique

    foreach ($candidate in $candidates) {
        $versionText = & $candidate --version | Select-Object -First 1
        if ($versionText -match '(\d+)\.(\d+)\.(\d+)') {
            $version = [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])"
            if ($version -ge [version]'3.24.0') {
                return $candidate
            }
        }
    }

    throw 'CMake 3.24 or newer is required. Install the current x64 CMake release.'
}

function Get-BakerLiteDependencyRoot {
    param([string] $RequestedRoot)

    if ($RequestedRoot) {
        return [IO.Path]::GetFullPath($RequestedRoot)
    }
    if ($env:BAKER_LITE_DEPS_ROOT) {
        return [IO.Path]::GetFullPath($env:BAKER_LITE_DEPS_ROOT)
    }
    if (-not $env:LOCALAPPDATA) {
        throw 'LOCALAPPDATA is unavailable; pass -CacheRoot explicitly.'
    }
    return Join-Path $env:LOCALAPPDATA 'BakerLite\deps'
}

function Get-BakerLiteQtRoot {
    param(
        [Parameter(Mandatory)]
        [string] $DependencyRoot
    )

    if ($env:BAKER_LITE_QT_ROOT) {
        return [IO.Path]::GetFullPath($env:BAKER_LITE_QT_ROOT)
    }
    return Join-Path $DependencyRoot 'qt\6.8.3\msvc2022_64'
}

function Get-BakerLiteNsisRoot {
    param(
        [Parameter(Mandatory)]
        [string] $DependencyRoot,

        [string] $Version = '3.12'
    )

    return Join-Path $DependencyRoot "tools\nsis-$Version\nsis-$Version"
}
