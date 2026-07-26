[CmdletBinding()]
param(
    [ValidateSet('All', 'Qt', 'WebRTC', 'Mediasoup', 'Tools')]
    [string] $Component = 'All',

    [string] $CacheRoot,

    [switch] $SkipWebRtcBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'Common.ps1')
$versions = Import-PowerShellDataFile (Join-Path $PSScriptRoot 'dependency-versions.psd1')
$dependencyRoot = Get-BakerLiteDependencyRoot -RequestedRoot $CacheRoot
$dependencyRoot = [IO.Path]::GetFullPath($dependencyRoot)
New-Item -ItemType Directory -Force -Path $dependencyRoot | Out-Null

function Assert-Command {
    param([Parameter(Mandatory)][string] $Name)
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "Required command is not available: $Name"
    }
    return $command.Source
}

function Set-BakerLiteWebRtcBuildPolicy {
    param([Parameter(Mandatory)][string] $SourceRoot)

    $winConfig = Join-Path $SourceRoot 'build\config\win\BUILD.gn'
    $winText = [IO.File]::ReadAllText($winConfig)
    $dynamicCrt = @'
    } else {
      # Baker Lite is a Qt DLL application and must keep the /MD ABI.
      configs = [ ":dynamic_crt" ]
    }
'@
    $patchedWinText = [regex]::Replace(
        $winText,
        '(?m)^    \} else \{\r?\n      # Desktop Windows: static CRT\.\r?\n      configs = \[ ":static_crt" \]\r?\n    \}',
        $dynamicCrt.TrimEnd()
    )
    if ($patchedWinText -ne $winText) {
        [IO.File]::WriteAllText(
            $winConfig,
            $patchedWinText,
            [Text.UTF8Encoding]::new($false)
        )
    }
    elseif (-not $winText.Contains('Baker Lite is a Qt DLL application')) {
        throw "Cannot apply the pinned WebRTC /MD build policy: $winConfig"
    }

    $rootBuild = Join-Path $SourceRoot 'BUILD.gn'
    $rootText = [IO.File]::ReadAllText($rootBuild)
    $bakerDependencies = @'
      "api:create_peerconnection_factory",
      "api:enable_media_with_defaults",
      "api:field_trials",
      "api:enable_media",
'@
    $patchedRootText = [regex]::Replace(
        $rootText,
        '(?m)^      "api:create_peerconnection_factory",\r?\n      "api:enable_media",',
        $bakerDependencies.TrimEnd()
    )
    if ($patchedRootText -ne $rootText) {
        $rootText = $patchedRootText
    }
    elseif (-not $rootText.Contains('"api:enable_media_with_defaults"')) {
        throw "Cannot add Baker Lite media factories to WebRTC: $rootBuild"
    }

    if (-not $rootText.Contains(
            '"modules/audio_device:audio_device_module_from_input_and_output"'
        )) {
        $patchedRootText = [regex]::Replace(
            $rootText,
            '(?m)^      "modules/video_capture:video_capture_internal_impl",',
            @'
      "modules/audio_device:audio_device_module_from_input_and_output",
      "modules/video_capture:video_capture_internal_impl",
'@.TrimEnd()
        )
        if ($patchedRootText -eq $rootText) {
            throw "Cannot add Baker Lite audio device factory to WebRTC: $rootBuild"
        }
        $rootText = $patchedRootText
    }
    [IO.File]::WriteAllText(
        $rootBuild,
        $rootText,
        [Text.UTF8Encoding]::new($false)
    )
}

function Initialize-PinnedGitCheckout {
    param(
        [Parameter(Mandatory)][string] $Repository,
        [Parameter(Mandatory)][string] $Revision,
        [Parameter(Mandatory)][string] $Destination,
        [string] $Tag
    )

    $createdCheckout = $false
    if (-not (Test-Path -LiteralPath (Join-Path $Destination '.git'))) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
        Invoke-BakerLiteNative git @('clone', '--filter=blob:none', $Repository, $Destination) "Cannot clone $Repository"
        $createdCheckout = $true
    }

    if (-not $createdCheckout) {
        $dirty = & git -C $Destination status --porcelain
        if ($LASTEXITCODE -ne 0) {
            throw "Cannot inspect checkout: $Destination"
        }
        if ($dirty) {
            throw "Dependency checkout contains local changes and was left untouched: $Destination"
        }
    }

    if ($Tag) {
        Invoke-BakerLiteNative git @('-C', $Destination, 'fetch', '--force', 'origin', "refs/tags/${Tag}:refs/tags/${Tag}") "Cannot fetch tag $Tag"
    }
    Invoke-BakerLiteNative git @('-C', $Destination, 'fetch', '--depth', '1', 'origin', $Revision) "Cannot fetch revision $Revision"
    Invoke-BakerLiteNative git @('-C', $Destination, 'checkout', '--detach', $Revision) "Cannot checkout revision $Revision"

    $actual = (& git -C $Destination rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $actual -ne $Revision) {
        throw "Revision verification failed for $Destination. Expected $Revision, got $actual"
    }
}

function Install-Qt {
    $qtRoot = Get-BakerLiteQtRoot -DependencyRoot $dependencyRoot
    $requiredQtFiles = @(
        (Join-Path $qtRoot 'bin\Qt6Core.dll'),
        (Join-Path $qtRoot 'bin\Qt6Svg.dll'),
        (Join-Path $qtRoot 'bin\Qt6WebSockets.dll'),
        (Join-Path $qtRoot 'bin\lrelease.exe'),
        (Join-Path $qtRoot 'bin\windeployqt.exe')
    )
    if (-not ($requiredQtFiles | Where-Object { -not (Test-Path -LiteralPath $_) })) {
        Write-Host "Qt $($versions.QtVersion) already present at $qtRoot"
        return
    }

    $python = Assert-Command python
    $venvRoot = Join-Path $dependencyRoot "tools\aqt-$($versions.AqtInstallVersion)"
    $venvPython = Join-Path $venvRoot 'Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $venvPython)) {
        Invoke-BakerLiteNative $python @('-m', 'venv', $venvRoot) 'Cannot create the aqt virtual environment'
    }
    Invoke-BakerLiteNative $venvPython @(
        '-m', 'pip', '--disable-pip-version-check', 'install',
        "--upgrade", "aqtinstall==$($versions.AqtInstallVersion)"
    ) 'Cannot install pinned aqtinstall'

    $qtOutputRoot = Join-Path $dependencyRoot 'qt'
    $arguments = @(
        '-m', 'aqt', 'install-qt',
        'windows', 'desktop',
        $versions.QtVersion,
        $versions.QtArchitecture,
        '--outputdir', $qtOutputRoot,
        '-m'
    ) + [string[]]$versions.QtModules
    Invoke-BakerLiteNative $venvPython $arguments 'Cannot install Qt'

    $missingQtFiles = $requiredQtFiles | Where-Object { -not (Test-Path -LiteralPath $_) }
    if ($missingQtFiles) {
        throw "Qt installation completed without required files: $($missingQtFiles -join ', ')"
    }
}

function Install-MediasoupSources {
    $mediasoupSource = Join-Path $dependencyRoot "libmediasoupclient\$($versions.LibMediasoupClientVersion)\source"
    Initialize-PinnedGitCheckout `
        -Repository $versions.LibMediasoupClientRepository `
        -Revision $versions.LibMediasoupClientCommit `
        -Destination $mediasoupSource `
        -Tag $versions.LibMediasoupClientVersion

    $tagObject = (& git -C $mediasoupSource rev-parse "$($versions.LibMediasoupClientVersion)^{tag}").Trim()
    if ($LASTEXITCODE -ne 0 -or $tagObject -ne $versions.LibMediasoupClientTagObject) {
        throw "libmediasoupclient tag-object verification failed. Expected $($versions.LibMediasoupClientTagObject), got $tagObject"
    }

    $sdpSource = Join-Path $dependencyRoot "libsdptransform\$($versions.LibSdpTransformVersion)\source"
    Initialize-PinnedGitCheckout `
        -Repository $versions.LibSdpTransformRepository `
        -Revision $versions.LibSdpTransformCommit `
        -Destination $sdpSource `
        -Tag $versions.LibSdpTransformVersion
}

function Install-BuildTools {
    $nsisRoot = Get-BakerLiteNsisRoot `
        -DependencyRoot $dependencyRoot `
        -Version $versions.NsisVersion
    $compiler = Join-Path $nsisRoot 'makensis.exe'
    if (Test-Path -LiteralPath $compiler) {
        Write-Host "NSIS $($versions.NsisVersion) already present at $nsisRoot"
        return
    }

    $curl = Assert-Command curl.exe
    $archive = Join-Path $dependencyRoot "tools\nsis-$($versions.NsisVersion).zip"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $archive) | Out-Null
    Invoke-BakerLiteNative $curl @(
        '-L', '--fail', '--retry', '2',
        '-o', $archive,
        $versions.NsisArchiveUrl
    ) 'Cannot download the pinned NSIS archive'

    $actualHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
    if ($actualHash -ne $versions.NsisArchiveSha256) {
        throw "NSIS archive checksum mismatch. Expected $($versions.NsisArchiveSha256), got $actualHash"
    }
    $destination = Split-Path -Parent $nsisRoot
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force
    if (-not (Test-Path -LiteralPath $compiler)) {
        throw "NSIS archive did not contain makensis.exe: $compiler"
    }
}

function Install-WebRtc {
    Assert-Command git | Out-Null

    $depotTools = Join-Path $dependencyRoot "depot_tools\$($versions.DepotToolsCommit)"
    Initialize-PinnedGitCheckout `
        -Repository $versions.DepotToolsRepository `
        -Revision $versions.DepotToolsCommit `
        -Destination $depotTools

    $previousPath = $env:Path
    $previousToolchain = $env:DEPOT_TOOLS_WIN_TOOLCHAIN
    $previousUpdate = $env:DEPOT_TOOLS_UPDATE
    try {
        $env:Path = "$depotTools;$env:Path"
        $env:DEPOT_TOOLS_WIN_TOOLCHAIN = '0'
        $env:DEPOT_TOOLS_UPDATE = '0'

        $winTools = Join-Path $depotTools 'bootstrap\win_tools.bat'
        Invoke-BakerLiteNative $winTools @() `
            'Cannot bootstrap the pinned depot_tools Windows wrappers'
        $gclient = Assert-Command gclient
        $webrtcRoot = Join-Path $dependencyRoot "webrtc\$($versions.WebRtcMilestone)"
        $webrtcSource = Join-Path $webrtcRoot 'src'
        New-Item -ItemType Directory -Force -Path $webrtcRoot | Out-Null

        if (-not (Test-Path -LiteralPath (Join-Path $webrtcRoot '.gclient'))) {
            Push-Location $webrtcRoot
            try {
                Invoke-BakerLiteNative $gclient @(
                    'config', '--name', 'src', $versions.WebRtcRepository
                ) 'Cannot initialize the WebRTC gclient workspace'
            }
            finally {
                Pop-Location
            }
        }

        $syncStamp = Join-Path $webrtcRoot ".baker-lite-sync-$($versions.WebRtcCommit)"
        if (-not (Test-Path -LiteralPath $syncStamp)) {
            Push-Location $webrtcRoot
            try {
                Invoke-BakerLiteNative $gclient @(
                    'sync',
                    '--no-history',
                    '--nohooks',
                    '--with_branch_heads',
                    '--revision', "src@$($versions.WebRtcCommit)"
                ) 'Cannot synchronize the pinned WebRTC checkout'
                Set-Content `
                    -LiteralPath $syncStamp `
                    -Value $versions.WebRtcCommit `
                    -Encoding ascii
            }
            finally {
                Pop-Location
            }
        }
        else {
            Write-Host "WebRTC $($versions.WebRtcCommit) already synchronized."
        }

        $actual = (& git -C $webrtcSource rev-parse HEAD).Trim()
        if ($LASTEXITCODE -ne 0 -or $actual -ne $versions.WebRtcCommit) {
            throw "WebRTC revision verification failed. Expected $($versions.WebRtcCommit), got $actual"
        }

        Set-BakerLiteWebRtcBuildPolicy -SourceRoot $webrtcSource

        Push-Location $webrtcRoot
        try {
            Invoke-BakerLiteNative $gclient @('runhooks') 'WebRTC hooks failed'
        }
        finally {
            Pop-Location
        }

        if ($SkipWebRtcBuild) {
            Write-Host 'WebRTC sources and toolchain are ready; the native library build was skipped.'
            return
        }

        $gn = Join-Path $webrtcSource 'buildtools\win\gn.exe'
        $ninja = Join-Path $webrtcSource 'third_party\ninja\ninja.exe'
        if (-not (Test-Path -LiteralPath $gn)) {
            throw "Pinned WebRTC checkout is missing GN: $gn"
        }
        if (-not (Test-Path -LiteralPath $ninja)) {
            throw "Pinned WebRTC checkout is missing Ninja: $ninja"
        }
        $output = Join-Path $webrtcSource 'out\baker-lite'
        $gnArgs = @(
            'target_os=\"win\"'
            'target_cpu=\"x64\"'
            'is_debug=false'
            'is_component_build=false'
            'is_clang=true'
            'use_lld=false'
            'use_rtti=true'
            'use_custom_libcxx=false'
            'rtc_include_tests=false'
            'rtc_build_examples=false'
            'rtc_build_tools=false'
            'rtc_use_h264=true'
            'proprietary_codecs=true'
            'treat_warnings_as_errors=false'
            'symbol_level=0'
        ) -join ' '
        Invoke-BakerLiteNative $gn @(
            'gen',
            $output,
            "--root=$webrtcSource",
            "--args=$gnArgs"
        ) 'Cannot generate the WebRTC Ninja build'
        Invoke-BakerLiteNative $ninja @('-C', $output, 'webrtc') 'Cannot build libwebrtc'

        $objectDirectory = Join-Path $output 'obj'
        $canonicalLibrary = Join-Path $objectDirectory 'libwebrtc.lib'
        $libraryCandidates = @(
            (Join-Path $objectDirectory 'webrtc.lib'),
            $canonicalLibrary
        )
        $builtLibrary = $libraryCandidates |
            Where-Object { Test-Path -LiteralPath $_ } |
            Select-Object -First 1
        if (-not $builtLibrary) {
            throw "The WebRTC build did not produce webrtc.lib under $objectDirectory"
        }
        if ($builtLibrary -ne $canonicalLibrary) {
            Copy-Item -LiteralPath $builtLibrary -Destination $canonicalLibrary -Force
        }
    }
    finally {
        $env:Path = $previousPath
        $env:DEPOT_TOOLS_WIN_TOOLCHAIN = $previousToolchain
        $env:DEPOT_TOOLS_UPDATE = $previousUpdate
    }
}

Assert-Command git | Out-Null

if ($Component -in @('All', 'Qt')) {
    Install-Qt
}
if ($Component -in @('All', 'Mediasoup')) {
    Install-MediasoupSources
}
if ($Component -in @('All', 'Tools')) {
    Install-BuildTools
}
if ($Component -in @('All', 'WebRTC')) {
    Install-WebRtc
}

$summary = [ordered]@{
    schemaVersion = 1
    generatedAt = [DateTime]::UtcNow.ToString('o')
    dependencyRoot = $dependencyRoot
    qtVersion = $versions.QtVersion
    libmediasoupclient = @{
        version = $versions.LibMediasoupClientVersion
        tagObject = $versions.LibMediasoupClientTagObject
        commit = $versions.LibMediasoupClientCommit
    }
    libwebrtc = @{
        milestone = $versions.WebRtcMilestone
        branch = $versions.WebRtcBranch
        commit = $versions.WebRtcCommit
    }
}
$summary |
    ConvertTo-Json -Depth 4 |
    Set-Content -LiteralPath (Join-Path $dependencyRoot 'bootstrap-state.json') -Encoding utf8

Write-Host "Baker Lite dependency cache is ready: $dependencyRoot"
