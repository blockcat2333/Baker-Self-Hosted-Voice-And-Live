[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $FilePath,

    [string] $CertificateThumbprint = $env:BAKER_LITE_SIGN_CERT_THUMBPRINT,

    [string] $TimestampUrl = 'http://timestamp.digicert.com',

    [string] $SignToolPath,

    [string] $CustomSignScript = $env:BAKER_LITE_SIGN_SCRIPT
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$resolvedFile = (Resolve-Path -LiteralPath $FilePath).Path

if ($CustomSignScript) {
    $resolvedHook = (Resolve-Path -LiteralPath $CustomSignScript).Path
    & $resolvedHook -FilePath $resolvedFile
    if ($LASTEXITCODE -ne 0) {
        throw "Custom signing hook failed with exit code $LASTEXITCODE."
    }
    Write-Host "Signed with custom hook: $resolvedFile"
    return
}

if (-not $CertificateThumbprint) {
    throw 'No signing identity was supplied. Set BAKER_LITE_SIGN_CERT_THUMBPRINT or BAKER_LITE_SIGN_SCRIPT.'
}

if (-not $SignToolPath) {
    $kitsBin = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    $SignToolPath = Get-ChildItem -LiteralPath $kitsBin -Directory -ErrorAction SilentlyContinue |
        Sort-Object { try { [version]$_.Name } catch { [version]'0.0' } } -Descending |
        ForEach-Object { Join-Path $_.FullName 'x64\signtool.exe' } |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
}
if (-not $SignToolPath -or -not (Test-Path -LiteralPath $SignToolPath)) {
    throw 'signtool.exe was not found. Install the Windows 10/11 SDK or pass -SignToolPath.'
}

Invoke-BakerLiteNative $SignToolPath @(
    'sign',
    '/sha1', $CertificateThumbprint,
    '/fd', 'SHA256',
    '/tr', $TimestampUrl,
    '/td', 'SHA256',
    '/v',
    $resolvedFile
) 'Authenticode signing failed'

Invoke-BakerLiteNative $SignToolPath @('verify', '/pa', '/v', $resolvedFile) 'Authenticode verification failed'
Write-Host "Signed and verified: $resolvedFile"
