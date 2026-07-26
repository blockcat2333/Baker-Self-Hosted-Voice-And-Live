[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $ArtifactPath,

    [Parameter(Mandatory)]
    [string] $Version,

    [Parameter(Mandatory)]
    [string] $DownloadUrl,

    [string] $OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$artifact = Get-Item -LiteralPath $ArtifactPath
if (-not $artifact -or $artifact.PSIsContainer) {
    throw "Installer artifact does not exist: $ArtifactPath"
}
if ($Version -notmatch '^\d+\.\d+\.\d+(?:[a-z]|[-+][0-9A-Za-z.-]+)?$') {
    throw "Version must use Baker client or SemVer-compatible format: $Version"
}

$uri = $null
if (-not [Uri]::TryCreate($DownloadUrl, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -ne 'https') {
    throw 'DownloadUrl must be an absolute HTTPS URL.'
}

if (-not $OutputPath) {
    $OutputPath = Join-Path $artifact.DirectoryName 'baker-lite-update.json'
}
$resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $resolvedOutput
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$manifest = [ordered]@{
    schemaVersion = 1
    product = 'baker-lite'
    version = $Version
    downloadUrl = $uri.AbsoluteUri
    sha512 = (Get-FileHash -LiteralPath $artifact.FullName -Algorithm SHA512).Hash.ToLowerInvariant()
    publishedAt = [DateTime]::UtcNow.ToString('o')
    fileName = $artifact.Name
    size = $artifact.Length
}

$manifest |
    ConvertTo-Json |
    Set-Content -LiteralPath $resolvedOutput -Encoding utf8

Write-Host "Update manifest written to $resolvedOutput"
