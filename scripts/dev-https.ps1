<#
.SYNOPSIS
  Starts an HTTPS reverse proxy (Caddy) in front of the web dev server.

.DESCRIPTION
  Browsers (especially mobile) require a secure context (HTTPS) for microphone access.
  This script starts Caddy and proxies to the running `apps/web` dev server so you can
  access the UI at an HTTPS origin.

  Defaults:
    - HTTPS address: https://localhost:8443 (TLS: internal)
    - Upstream: auto-detected from output/dev/pids.json (dev-up), else WEB_PORT from .env, else 80

  Notes:
    - `-TlsMode public` (Let's Encrypt) typically requires binding to ports 80/443 (admin) and
      public reachability of the host.
    - `-TlsMode internal` works offline but uses an internal CA. For a trusted cert on Windows,
      run `caddy trust` (may require admin). For mobile devices, use a publicly trusted cert.

.PARAMETER SiteHost
  Hostname to serve (default: localhost). Examples: localhost, demo.example.com

.PARAMETER HttpsPort
  HTTPS listen port for internal TLS (default: 8443).

.PARAMETER TlsMode
  internal (default) | public | off

.PARAMETER Email
  ACME account email for `-TlsMode public` (optional but recommended).

.PARAMETER Upstream
  Upstream target to proxy to. Accepts `host:port` or a URL like `http://127.0.0.1:3233`.

.PARAMETER UpstreamPort
  Convenience override for upstream port (used when -Upstream is not provided).

.PARAMETER TrustLocalCA
  If set and -TlsMode internal, runs `caddy trust` to install the local CA into the OS store.

.PARAMETER Detach
  If set, starts Caddy and returns immediately (no supervisor loop).

.PARAMETER KeepOpen
  If set, pauses on exit (useful when launching from Explorer).
#>

[CmdletBinding()]
param(
  [Alias('Host')]
  [string]$SiteHost = 'localhost',
  [int]$HttpsPort = 8443,
  [ValidateSet('internal', 'public', 'off')]
  [string]$TlsMode = 'internal',
  [string]$Email,
  [string]$Upstream,
  [int]$UpstreamPort,
  [switch]$TrustLocalCA,
  [switch]$Detach,
  [switch]$KeepOpen
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Ensure-Dir([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) {
    New-Item -ItemType Directory -Path $path | Out-Null
  }
}

function Test-PortListening([int]$port) {
  $lines = netstat -ano -p tcp | Select-String -Pattern 'LISTENING' | ForEach-Object { $_.Line }
  foreach ($line in $lines) {
    if ($line -match "[:.]$port\\s+LISTENING\\s+\\d+\\s*$") { return $true }
  }
  return $false
}

function Wait-PortListening([int]$port, [int]$timeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-PortListening -port $port) { return $true }
    Start-Sleep -Milliseconds 250
  }
  return (Test-PortListening -port $port)
}

function Get-WindowsArch() {
  $arch = $env:PROCESSOR_ARCHITECTURE
  if ($arch -and $arch.ToUpperInvariant() -eq 'ARM64') { return 'arm64' }
  return 'amd64'
}

function Ensure-Caddy([string]$repoRoot) {
  $cmd = Get-Command caddy -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $toolsDir = Join-Path $repoRoot 'output\dev\tools'
  Ensure-Dir $toolsDir
  $exePath = Join-Path $toolsDir 'caddy.exe'

  if (-not (Test-Path -LiteralPath $exePath)) {
    $arch = Get-WindowsArch
    $uri = "https://caddyserver.com/api/download?os=windows&arch=$arch"
    Write-Host "Caddy not found on PATH. Downloading to: $exePath"
    Write-Host "From: $uri"
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $exePath
    } catch {
      throw "Failed to download Caddy. Details: $($_.Exception.Message)"
    }
  }

  return $exePath
}

function Read-DotEnv([string]$path) {
  $result = @{}
  if (-not (Test-Path -LiteralPath $path)) { return $result }
  foreach ($line in Get-Content -LiteralPath $path -ErrorAction SilentlyContinue) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    $idx = $trimmed.IndexOf('=')
    if ($idx -lt 1) { continue }
    $k = $trimmed.Substring(0, $idx).Trim()
    $v = $trimmed.Substring($idx + 1).Trim()
    if ($k) { $result[$k] = $v }
  }
  return $result
}

function Get-ListeningPortsByPid([int]$processId) {
  $lines = netstat -ano -p tcp | Select-String -Pattern 'LISTENING' | ForEach-Object { $_.Line }
  $ports = New-Object System.Collections.Generic.HashSet[int]
  foreach ($line in $lines) {
    $parts = ($line -split '\s+') | Where-Object { $_ }
    if ($parts.Length -lt 5) { continue }
    $local = $parts[1]
    $state = $parts[3]
    $pidText = $parts[4]
    if ($state -ne 'LISTENING') { continue }
    if (-not ($pidText -match '^\d+$')) { continue }
    if ([int]$pidText -ne $processId) { continue }
    if ($local -match ':(\d+)$') {
      [void]$ports.Add([int]$Matches[1])
    }
  }
  return $ports
}

function Get-WebPortFromViteLog([string]$logPath) {
  if (-not $logPath) { return $null }
  if (-not (Test-Path -LiteralPath $logPath)) { return $null }
  try {
    # Vite writes lines like: "Local: http://localhost:3233/"
    foreach ($line in Get-Content -LiteralPath $logPath -Tail 200 -ErrorAction SilentlyContinue) {
      if ($line -match 'Local:\s+http://localhost:(\d+)/?') {
        $p = [int]$Matches[1]
        if ($p -gt 0) { return $p }
      }
    }
  } catch {
    return $null
  }
  return $null
}

function Stop-Pid([int]$processId, [string]$reason) {
  try {
    try {
      taskkill.exe /PID $processId /T /F 2>$null | Out-Null
    } catch {
      Stop-Process -Id $processId -Force -ErrorAction Stop
    }
    Write-Host "Stopped PID $processId ($reason)"
  } catch {
    Write-Warning "Failed to stop PID $processId ($reason): $($_.Exception.Message)"
  }
}

function Normalize-Upstream([string]$value) {
  $trimmed = $value
  if ($null -eq $trimmed) { $trimmed = '' }
  $trimmed = $trimmed.Trim()
  if (-not $trimmed) { return $null }

  if ($trimmed -match '^\w+://') {
    try {
      $u = [Uri]$trimmed
      if ($u.Host -and $u.Port) { return "$($u.Host):$($u.Port)" }
    } catch {
      # fall through
    }
  }

  $noPath = $trimmed.Split('/')[0]
  return $noPath
}

function Resolve-UpstreamHostPort(
  [string]$repoRoot,
  [string]$upstream,
  [int]$upstreamPort
) {
  if ($upstream) {
    $normalized = Normalize-Upstream $upstream
    if (-not $normalized) { throw "Invalid -Upstream: '$upstream'" }
    return $normalized
  }

  if ($upstreamPort -gt 0) {
    return "127.0.0.1:$upstreamPort"
  }

  # Prefer an explicit runtime port snapshot written by dev-up.
  $runtimePortsPath = Join-Path $repoRoot 'output\dev\runtime-ports.json'
  if (Test-Path -LiteralPath $runtimePortsPath) {
    try {
      $runtime = Get-Content -LiteralPath $runtimePortsPath -Raw | ConvertFrom-Json
      if ($runtime -and $runtime.webPort -and ($runtime.webPort -as [int])) {
        return "127.0.0.1:$([int]$runtime.webPort)"
      }
    } catch {
      # ignore
    }
  }

  # Prefer the running `web` dev server PID from dev-up, and ask netstat what port it's listening on.
  $pidsPath = Join-Path $repoRoot 'output\dev\pids.json'
  if (Test-Path -LiteralPath $pidsPath) {
    try {
      $saved = Get-Content -LiteralPath $pidsPath -Raw | ConvertFrom-Json
      $web = @($saved) | Where-Object { $_.name -eq 'web' } | Select-Object -First 1
      if ($web -and $web.stdout) {
        $vitePort = Get-WebPortFromViteLog -logPath ([string]$web.stdout)
        if ($vitePort) {
          return "127.0.0.1:$vitePort"
        }
      }
      if ($web -and $web.pid -and ($web.pid -as [int])) {
        $ports = @(Get-ListeningPortsByPid -processId ([int]$web.pid)) | Sort-Object
        if ($ports.Length -gt 0) {
          return "127.0.0.1:$($ports[0])"
        }
        Write-Warning "Found web PID ($($web.pid)) but could not detect a listening port. Is the web dev server running?"
      }
    } catch {
      # ignore
    }
  }

  $envMap = Read-DotEnv (Join-Path $repoRoot '.env')
  if ($envMap.ContainsKey('WEB_PORT') -and $envMap['WEB_PORT']) {
    try {
      $p = [int]$envMap['WEB_PORT']
      if ($p -gt 0) { return "127.0.0.1:$p" }
    } catch {
      # ignore
    }
  }

  return '127.0.0.1:80'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $repoRoot
$hadError = $false
try {
  $caddyExe = Ensure-Caddy -repoRoot $repoRoot

  $outDir = Join-Path $repoRoot 'output\dev'
  $logDir = Join-Path $outDir 'logs'
  Ensure-Dir $outDir
  Ensure-Dir $logDir

  $pidFile = Join-Path $outDir 'caddy.pid.json'
  if (Test-Path -LiteralPath $pidFile) {
    try {
      $saved = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
      if ($saved -and $saved.pid -and ($saved.pid -as [int])) {
        Stop-Pid -processId ([int]$saved.pid) -reason 'saved:caddy'
      }
    } catch {
      Write-Warning "Could not read ${pidFile}: $($_.Exception.Message)"
    }
  }

  $upstreamHostPort = Resolve-UpstreamHostPort -repoRoot $repoRoot -upstream $Upstream -upstreamPort $UpstreamPort
  if ($upstreamHostPort -match ':(\d+)$') {
    $upstreamPortDetected = [int]$Matches[1]
    if (-not (Wait-PortListening -port $upstreamPortDetected -timeoutSeconds 8)) {
      Write-Warning "Upstream does not appear to be listening on $upstreamHostPort yet. Start the web dev server (scripts/dev-up.ps1) first, or pass -UpstreamPort explicitly."
    }
  }

  $caddyfile = Join-Path $outDir 'Caddyfile.dev'
  $stdout = Join-Path $logDir 'caddy.out.log'
  $stderr = Join-Path $logDir 'caddy.err.log'
  $accessLog = Join-Path $logDir 'caddy.access.log'

  $globalBlock = @()
  if ($TlsMode -eq 'public' -and $Email) {
    $globalBlock += "{"
    $globalBlock += "  email $Email"
    $globalBlock += "}"
    $globalBlock += ""
  }

  $siteAddress = $null
  $siteBlock = @()
  if ($TlsMode -eq 'off') {
    $siteAddress = "http://${SiteHost}:$HttpsPort"
  } elseif ($TlsMode -eq 'internal') {
    $siteAddress = "https://${SiteHost}:$HttpsPort"
    $siteBlock += "  tls internal"
    if ($SiteHost -ne 'localhost' -and $SiteHost -ne '127.0.0.1') {
      Write-Warning "TLS mode is 'internal'. On mobile devices, this will NOT be a secure context unless the CA is trusted on the device. For real domains, prefer -TlsMode public."
    }
  } else {
    # public (ACME). Prefer 443 with host-only site label when possible.
    if ($HttpsPort -eq 443) {
      $siteAddress = "$SiteHost"
    } else {
      $siteAddress = "https://${SiteHost}:$HttpsPort"
      Write-Warning "ACME certificates require a public challenge on port 80 (HTTP-01) and/or 443 (TLS-ALPN-01). Even if you serve the site on :$HttpsPort, you still must allow inbound 80/443 to this machine for issuance/renewal. If this fails, use -TlsMode internal or run on 443."
    }
  }

  $siteBlock += "  reverse_proxy $upstreamHostPort"
  $siteBlock += "  log {"
  $siteBlock += "    output file $accessLog"
  $siteBlock += "    format console"
  $siteBlock += "  }"

  $contents = @()
  $contents += $globalBlock
  $contents += "$siteAddress {"
  $contents += $siteBlock
  $contents += "}"
  ($contents -join "`n") | Set-Content -LiteralPath $caddyfile -Encoding UTF8

  if ($TrustLocalCA -and $TlsMode -eq 'internal') {
    try {
      caddy trust | Out-Null
      Write-Host 'Installed Caddy local CA into OS trust store.'
    } catch {
      Write-Warning "Failed to run 'caddy trust' ($($_.Exception.Message)). You may need to run this terminal as Administrator."
    }
  }

  $commonArgs = @{
    FilePath               = $caddyExe
    ArgumentList           = @('run', '--config', $caddyfile, '--adapter', 'caddyfile')
    WorkingDirectory       = $repoRoot
    PassThru               = $true
    WindowStyle            = 'Hidden'
    RedirectStandardOutput = $stdout
    RedirectStandardError  = $stderr
  }

  $p = Start-Process @commonArgs
  $saved = [pscustomobject]@{
    pid       = $p.Id
    host      = $SiteHost
    port      = $HttpsPort
    tlsMode   = $TlsMode
    upstream  = $upstreamHostPort
    caddyfile = $caddyfile
    startedAt = (Get-Date).ToString('o')
  }
  $saved | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8

  $scheme = if ($TlsMode -eq 'off') { 'http' } else { 'https' }
  Write-Host ''
  Write-Host "HTTPS:  ${scheme}://${SiteHost}:$HttpsPort  ->  $upstreamHostPort"
  if ($TlsMode -ne 'off') {
    Write-Host "Note:  You must open the site with https:// (http:// on this port will show 'Client sent an HTTP request to an HTTPS server')."
  }
  Write-Host "Logs:   $logDir"
  Write-Host "PIDs:   $pidFile"
  Write-Host "Config: $caddyfile"

  if (-not $Detach) {
    Write-Host ''
    Write-Host 'Supervisor: running. Press Ctrl+C to stop Caddy and exit.'
    try {
      while ($true) {
        $isRunning = $null -ne (Get-Process -Id $p.Id -ErrorAction SilentlyContinue)
        if (-not $isRunning) {
          Write-Warning "Caddy exited (PID $($p.Id)). See: $stderr"
          try {
            $tail = Get-Content -LiteralPath $stderr -ErrorAction SilentlyContinue -Tail 60
            if ($tail) {
              Write-Host "---- tail caddy.err ----"
              $tail | ForEach-Object { Write-Host $_ }
              Write-Host "-----------------------"
            }
          } catch {
            # ignore
          }
          break
        }
        Start-Sleep -Seconds 2
      }
    } finally {
      Write-Host ''
      Write-Host 'Stopping Caddy...'
      Stop-Pid -processId ([int]$p.Id) -reason 'shutdown:caddy'
    }
  }
} catch {
  $hadError = $true
  Write-Error $_
} finally {
  Pop-Location
  if ($KeepOpen -or $hadError) {
    Write-Host ''
    [void](Read-Host 'Press Enter to close')
  }
}
