<#
.SYNOPSIS
  Stops leftover Baker dev servers (by saved PIDs + known ports) and starts infra + services.

.DESCRIPTION
  - Stops any previously-started processes recorded in output/dev/pids.json
  - Finds and stops processes listening on the known dev ports (web/api/gateway/media/admin/desktop)
    but only if their command line contains the repo root (safety guard).
  - Starts docker infra (postgres + redis)
  - Runs drizzle db push (best-effort)
  - Starts API, Gateway, Media, Web, Admin in background with logs under output/dev/logs/

.PARAMETER WebPort
  Web dev server port (default: from .env WEB_PORT, else 80)

.PARAMETER ApiPort
  API port (default: from .env API_PORT, else 3001)

.PARAMETER GatewayPort
  Gateway port (default: from .env GATEWAY_PORT, else 3002)

.PARAMETER MediaPort
  Media port (default: from .env MEDIA_PORT, else 3003)

.PARAMETER AdminPort
  Admin panel port (default: 5180)

.PARAMETER DesktopPort
  Desktop dev server port (default: 5174)

.PARAMETER EnableTurn
  If set, also starts a local TURN relay (docker compose service `turn`) and injects TURN_* env vars for this run.
  This improves cross-network voice/stream reliability (VPN/NAT/UDP-blocked networks).

.PARAMETER TurnHost
  Public hostname/IP clients should use to reach TURN (e.g. demo.example.com). Used when -EnableTurn and
  TURN_URLS is not set in .env.

.PARAMETER ForceKillPorts
  If set, stops any process listening on the known ports even if we cannot confirm it's from this repo.

.PARAMETER ShowWindows
  If set, service processes will spawn visible PowerShell windows (useful for debugging).

.PARAMETER Detach
  If set, starts services and returns immediately (no supervisor loop).
#>
[CmdletBinding()]
param(
  [int]$WebPort,
  [int]$ApiPort,
  [int]$GatewayPort,
  [int]$MediaPort,
  [int]$AdminPort = 5180,
  [int]$DesktopPort = 5174,
  [string]$AllowedHosts,
  [switch]$EnableTurn,
  [string]$TurnHost,
  [switch]$ForceKillPorts,
  [switch]$ShowWindows,
  [switch]$Detach
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$webPortExplicit = $PSBoundParameters.ContainsKey('WebPort')

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

function Ensure-Dir([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) {
    New-Item -ItemType Directory -Path $path | Out-Null
  }
}

function Get-ExcludedPortRanges([string]$protocol) {
  $ranges = @()
  try {
    $lines = netsh interface ipv4 show excludedportrange protocol=$protocol | ForEach-Object { $_.ToString() }
  } catch {
    return $ranges
  }

  foreach ($line in $lines) {
    if ($line -match '^\s*(\d+)\s+(\d+)\s*(\*?)\s*$') {
      $start = [int]$Matches[1]
      $end = [int]$Matches[2]
      $ranges += [pscustomobject]@{ Start = $start; End = $end }
    }
  }

  return $ranges
}

function Get-ExcludedTcpPortRanges() {
  return Get-ExcludedPortRanges -protocol 'tcp'
}

function Get-ExcludedUdpPortRanges() {
  return Get-ExcludedPortRanges -protocol 'udp'
}

function Test-PortExcluded([int]$port, $ranges) {
  foreach ($r in @($ranges)) {
    if ($port -ge $r.Start -and $port -le $r.End) { return $true }
  }
  return $false
}

function Test-PortInUse([int]$port) {
  return @((Get-ListeningPids -port $port)).Length -gt 0
}

function Find-FreeTcpPort([int]$preferred, [int]$startSearchAt, $excludedRanges) {
  if (-not (Test-PortExcluded -port $preferred -ranges $excludedRanges) -and -not (Test-PortInUse -port $preferred)) {
    return $preferred
  }

  for ($p = $startSearchAt; $p -lt ($startSearchAt + 2000); $p++) {
    if (Test-PortExcluded -port $p -ranges $excludedRanges) { continue }
    if (Test-PortInUse -port $p) { continue }
    return $p
  }

  throw "Could not find a free TCP port near $startSearchAt."
}

function Find-FreeTcpPortUnique([int]$preferred, [int]$startSearchAt, $excludedRanges, $reservedPorts) {
  $isReserved = $reservedPorts -and $reservedPorts.Contains($preferred)
  if (-not $isReserved -and -not (Test-PortExcluded -port $preferred -ranges $excludedRanges) -and -not (Test-PortInUse -port $preferred)) {
    return $preferred
  }

  for ($p = $startSearchAt; $p -lt ($startSearchAt + 2000); $p++) {
    if (Test-PortExcluded -port $p -ranges $excludedRanges) { continue }
    if (Test-PortInUse -port $p) { continue }
    if ($reservedPorts -and $reservedPorts.Contains($p)) { continue }
    return $p
  }

  throw "Could not find a free TCP port near $startSearchAt."
}

function Get-PrimaryIPv4() {
  try {
    $candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object {
        $_.IPAddress -and
        $_.IPAddress -ne '127.0.0.1' -and
        -not $_.IPAddress.StartsWith('169.254.')
      } |
      Sort-Object -Property PrefixLength -Descending

    $first = $candidates | Select-Object -First 1
    if ($first -and $first.IPAddress) { return [string]$first.IPAddress }
  } catch {
    # ignore
  }

  return '127.0.0.1'
}

function Get-ListeningPids([int]$port) {
  $lines = netstat -ano -p tcp | Select-String -Pattern 'LISTENING' | ForEach-Object { $_.Line }
  $pids = New-Object System.Collections.Generic.HashSet[int]

  foreach ($line in $lines) {
    $parts = ($line -split '\s+') | Where-Object { $_ }
    if ($parts.Length -lt 5) { continue }
    $local = $parts[1]
    $state = $parts[3]
    $pidText = $parts[4]
    if ($state -ne 'LISTENING') { continue }

    if ($local -match ':(\d+)$') {
      $p = [int]$Matches[1]
      if ($p -eq $port) {
        if ($pidText -match '^\d+$') {
          [void]$pids.Add([int]$pidText)
        }
      }
    }
  }

  return $pids
}

function Test-UdpPortInUse([int]$port) {
  try {
    $lines = netstat -ano -p udp | ForEach-Object { $_.ToString() }
  } catch {
    return $false
  }
  foreach ($line in $lines) {
    if ($line -match '\\s+UDP\\s+[^\\s]+:(\\d+)\\s+\\*:\\*\\s+(\\d+)\\s*$') {
      if ([int]$Matches[1] -eq $port) { return $true }
    }
  }
  return $false
}

function Find-FreePortTcpUdp([int]$preferred, [int]$startSearchAt, $excludedTcp, $excludedUdp) {
  function Is-Free([int]$p) {
    if (Test-PortExcluded -port $p -ranges $excludedTcp) { return $false }
    if (Test-PortExcluded -port $p -ranges $excludedUdp) { return $false }
    if (Test-PortInUse -port $p) { return $false }
    if (Test-UdpPortInUse -port $p) { return $false }
    return $true
  }

  if (Is-Free $preferred) { return $preferred }

  for ($p = $startSearchAt; $p -lt ($startSearchAt + 2000); $p++) {
    if (Is-Free $p) { return $p }
  }

  throw "Could not find a free TCP/UDP port near $startSearchAt."
}

function Get-ListeningPidPortPairs() {
  $lines = netstat -ano -p tcp | Select-String -Pattern 'LISTENING' | ForEach-Object { $_.Line }
  $pairs = @()

  foreach ($line in $lines) {
    $parts = ($line -split '\s+') | Where-Object { $_ }
    if ($parts.Length -lt 5) { continue }
    $local = $parts[1]
    $state = $parts[3]
    $pidText = $parts[4]
    if ($state -ne 'LISTENING') { continue }
    if (-not ($pidText -match '^\d+$')) { continue }
    if ($local -match ':(\d+)$') {
      $pairs += [pscustomobject]@{ Port = [int]$Matches[1]; Pid = [int]$pidText }
    }
  }

  return $pairs
}

function Get-ProcCommandLine([int]$processId) {
  try {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction Stop
    return [string]$proc.CommandLine
  } catch {
    return $null
  }
}

function LooksLike-BakerProcess([string]$commandLine, [string]$repoRoot) {
  if (-not $commandLine) { return $false }
  return $commandLine.ToLowerInvariant().Contains($repoRoot.ToLowerInvariant())
}

function Stop-Pid([int]$processId, [string]$reason) {
  try {
    # Prefer killing the whole process tree so pnpm/node children don't leak.
    try {
      taskkill.exe /PID $processId /T /F 2>$null | Out-Null
    } catch {
      Stop-Process -Id $processId -Force -ErrorAction Stop
    }
    Write-Host "Stopped PID $processId ($reason)"
  } catch {
    $msg = [string]$_.Exception.Message
    $msgLower = $msg.ToLowerInvariant()
    $isMissing =
      $msgLower.Contains('cannot find a process') -or
      $msgLower.Contains('cannot find the process') -or
      $msgLower.Contains('process not found')
    if ($isMissing) {
      Write-Host "Skip PID $processId ($reason): process not running"
    } else {
      Write-Warning "Failed to stop PID $processId ($reason): $msg"
    }
  }
}

function Get-DockerEngineStatus() {
  $status = [pscustomobject]@{
    Ready = $false
    ServerVersion = $null
    ErrorMessage = $null
  }

  $dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $dockerCmd) {
    $status.ErrorMessage = 'Docker CLI not found on PATH.'
    return $status
  }

  try {
    $raw = & docker info --format '{{.ServerVersion}}' 2>&1
    $code = $LASTEXITCODE
    $text = (($raw | ForEach-Object { $_.ToString() }) -join "`n").Trim()
    if ($code -eq 0) {
      $status.Ready = $true
      $status.ServerVersion = $text
      return $status
    }
    $status.ErrorMessage = if ($text) { $text } else { "docker info failed with exit code $code." }
    return $status
  } catch {
    $status.ErrorMessage = $_.Exception.Message
    return $status
  }
}

function Test-DockerEngineReady() {
  return (Get-DockerEngineStatus).Ready
}

function Get-DockerDesktopExePath() {
  $candidates = @()
  if ($env:ProgramFiles) {
    $candidates += (Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe')
  }
  if (${env:ProgramFiles(x86)}) {
    $candidates += (Join-Path ${env:ProgramFiles(x86)} 'Docker\Docker\Docker Desktop.exe')
  }
  if ($env:LocalAppData) {
    $candidates += (Join-Path $env:LocalAppData 'Docker\Docker Desktop.exe')
  }
  foreach ($path in $candidates) {
    if ($path -and (Test-Path -LiteralPath $path)) {
      return $path
    }
  }
  return $null
}

function Try-RecoverDockerEngine([string]$dockerDesktopPath) {
  if (-not $dockerDesktopPath) {
    $dockerDesktopPath = Get-DockerDesktopExePath
  }
  if (-not $dockerDesktopPath) {
    Write-Warning 'Docker auto-recovery skipped: Docker Desktop executable not found.'
    return $false
  }

  Write-Warning 'Docker engine appears stuck. Attempting one automatic recovery (restart Docker Desktop + WSL shutdown)...'

  try {
    $dockerProcesses = Get-Process -ErrorAction SilentlyContinue | Where-Object {
      $_.ProcessName -like 'Docker Desktop*' -or $_.ProcessName -like 'com.docker.*'
    } | Sort-Object -Property Id -Unique
    foreach ($proc in @($dockerProcesses)) {
      try {
        Stop-Process -Id $proc.Id -Force -ErrorAction Stop
      } catch {
        Write-Warning "Failed to stop process $($proc.ProcessName) (PID $($proc.Id)): $($_.Exception.Message)"
      }
    }
  } catch {
    Write-Warning "Could not enumerate Docker Desktop processes: $($_.Exception.Message)"
  }

  Start-Sleep -Seconds 2

  if (Get-Command wsl.exe -ErrorAction SilentlyContinue) {
    try {
      & wsl.exe --shutdown 2>$null
      if ($LASTEXITCODE -eq 0) {
        Write-Host 'Ran wsl --shutdown successfully.'
      } else {
        Write-Warning "wsl --shutdown returned exit code $LASTEXITCODE."
      }
    } catch {
      Write-Warning "wsl --shutdown failed: $($_.Exception.Message)"
    }
  } else {
    Write-Warning 'wsl.exe not found; skipping WSL shutdown step.'
  }

  Start-Sleep -Seconds 2
  try {
    Start-Process -FilePath $dockerDesktopPath | Out-Null
    Write-Host 'Docker Desktop restart triggered. Waiting for engine readiness...'
    return $true
  } catch {
    Write-Warning "Failed to restart Docker Desktop automatically: $($_.Exception.Message)"
    return $false
  }
}

function Ensure-DockerEngineReady([int]$timeoutSeconds = 120) {
  $initialStatus = Get-DockerEngineStatus
  if ($initialStatus.Ready) {
    $serverVersion = if ($initialStatus.ServerVersion) { $initialStatus.ServerVersion } else { 'unknown' }
    Write-Host "Docker engine is ready (server version: $serverVersion)."
    return
  }

  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker CLI not found on PATH. Please install Docker Desktop and retry.'
  }

  $dockerService = Get-Service -Name 'com.docker.service' -ErrorAction SilentlyContinue
  if ($dockerService -and $dockerService.Status -ne 'Running') {
    try {
      Start-Service -Name 'com.docker.service' -ErrorAction Stop
      Write-Host 'Started Windows service com.docker.service.'
    } catch {
      Write-Warning "Could not start com.docker.service automatically: $($_.Exception.Message)"
    }
  }

  $dockerDesktop = Get-DockerDesktopExePath
  if ($dockerDesktop) {
    $desktopRunning = $null -ne (Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue)
    if (-not $desktopRunning) {
      Write-Host "Docker engine is not ready. Starting Docker Desktop: $dockerDesktop"
      try {
        Start-Process -FilePath $dockerDesktop | Out-Null
      } catch {
        Write-Warning "Failed to auto-start Docker Desktop: $($_.Exception.Message)"
      }
    } else {
      Write-Host "Docker Desktop process is running but engine is not ready yet. Waiting (timeout ${timeoutSeconds}s)..."
    }
  } else {
    Write-Warning 'Docker Desktop executable was not found in common install paths. Waiting for Docker engine...'
  }

  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  $lastErrorMessage = ''
  $nextProgressAt = Get-Date
  $stuckStartupErrorHits = 0
  $recoveryAttempted = $false
  while ((Get-Date) -lt $deadline) {
    $status = Get-DockerEngineStatus
    if ($status.Ready) {
      $serverVersion = if ($status.ServerVersion) { $status.ServerVersion } else { 'unknown' }
      Write-Host "Docker engine is ready (server version: $serverVersion)."
      return
    }

    $err = [string]$status.ErrorMessage
    if (-not $err) { $err = 'engine not responding yet' }
    if ($err -ne $lastErrorMessage -or (Get-Date) -ge $nextProgressAt) {
      Write-Host "Waiting for Docker engine... $err"
      $lastErrorMessage = $err
      $nextProgressAt = (Get-Date).AddSeconds(10)
    }

    $errLower = $err.ToLowerInvariant()
    if ($errLower.Contains('permission denied') -or $errLower.Contains('access is denied')) {
      throw "Docker daemon pipe access was denied. Confirm Docker Desktop is running for user '$env:USERNAME', then sign out/in (or reboot) and retry."
    }

    $looksLikeStuckStartup =
      $errLower.Contains('context deadline exceeded') -or
      $errLower.Contains('still waiting for the engine') -or
      $errLower.Contains('supports the requested api version')
    if ($looksLikeStuckStartup) {
      $stuckStartupErrorHits += 1
      if ($stuckStartupErrorHits -ge 3) {
        if (-not $recoveryAttempted) {
          $recoveryAttempted = $true
          $recoveryStarted = Try-RecoverDockerEngine -dockerDesktopPath $dockerDesktop
          if ($recoveryStarted) {
            $stuckStartupErrorHits = 0
            $nextProgressAt = Get-Date
            $deadline = (Get-Date).AddSeconds($timeoutSeconds)
            Start-Sleep -Seconds 3
            continue
          }
        }
        throw "Docker Desktop backend appears stuck in 'starting' state after automatic recovery. Close Docker Desktop completely, run `wsl --shutdown`, then start Docker Desktop again and wait for 'Engine running'. Last error: $err"
      }
    } else {
      $stuckStartupErrorHits = 0
    }

    Start-Sleep -Seconds 2
  }

  $tail = if ($lastErrorMessage) { " Last Docker error: $lastErrorMessage" } else { '' }
  throw "Docker engine did not become ready within ${timeoutSeconds}s. Open Docker Desktop, wait until status is 'Engine running', then retry.$tail"
}

function Stop-BakerListenersInRange([int]$minPort, [int]$maxPort) {
  $pairs = Get-ListeningPidPortPairs
  foreach ($pair in @($pairs)) {
    if ($pair.Port -lt $minPort -or $pair.Port -gt $maxPort) { continue }
    $cmd = Get-ProcCommandLine -processId $pair.Pid
    if ($ForceKillPorts -or (LooksLike-BakerProcess -commandLine $cmd -repoRoot $repoRoot)) {
      Stop-Pid -processId $pair.Pid -reason "port:$($pair.Port)"
    }
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envMap = Read-DotEnv (Join-Path $repoRoot '.env')

function Get-EnvInt([hashtable]$map, [string]$key, [int]$fallback) {
  if ($map.ContainsKey($key) -and $map[$key]) {
    try { return [int]$map[$key] } catch { return $fallback }
  }
  return $fallback
}

function Get-EnvString([hashtable]$map, [string]$key, [string]$fallback) {
  if ($map.ContainsKey($key) -and $map[$key]) {
    return [string]$map[$key]
  }
  return $fallback
}

if (-not $WebPort) { $WebPort = Get-EnvInt $envMap 'WEB_PORT' 80 }
if (-not $ApiPort) { $ApiPort = Get-EnvInt $envMap 'API_PORT' 3001 }
if (-not $GatewayPort) { $GatewayPort = Get-EnvInt $envMap 'GATEWAY_PORT' 3002 }
if (-not $MediaPort) { $MediaPort = Get-EnvInt $envMap 'MEDIA_PORT' 3003 }
if (-not $AllowedHosts) { $AllowedHosts = Get-EnvString $envMap 'VITE_ALLOWED_HOSTS' '' }

$stunUrls = Get-EnvString $envMap 'STUN_URLS' ''
$turnUrls = Get-EnvString $envMap 'TURN_URLS' ''
$turnUsername = Get-EnvString $envMap 'TURN_USERNAME' ''
$turnPassword = Get-EnvString $envMap 'TURN_PASSWORD' ''
$turnExternalIp = Get-EnvString $envMap 'TURN_EXTERNAL_IP' ''
$turnRealm = Get-EnvString $envMap 'TURN_REALM' ''
$turnPort = Get-EnvInt $envMap 'TURN_PORT' 3478
$turnMinPort = Get-EnvInt $envMap 'TURN_MIN_PORT' 49160
$turnMaxPort = Get-EnvInt $envMap 'TURN_MAX_PORT' 49200

$outDir = Join-Path $repoRoot 'output\dev'
$logDir = Join-Path $outDir 'logs'
$turnRuntimeFile = Join-Path $outDir 'turn-runtime.json'
$runtimePortsFile = Join-Path $outDir 'runtime-ports.json'
Ensure-Dir $outDir
Ensure-Dir $logDir

# 1) Stop previously recorded processes.
$pidFile = Join-Path $outDir 'pids.json'
if (Test-Path -LiteralPath $pidFile) {
  try {
    $saved = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
    foreach ($entry in @($saved)) {
      if ($entry.pid -and ($entry.pid -as [int])) {
        Stop-Pid -processId ([int]$entry.pid) -reason "saved:$($entry.name)"
      }
    }
  } catch {
    Write-Warning "Could not read ${pidFile}: $($_.Exception.Message)"
  }
}
if (Test-Path -LiteralPath $runtimePortsFile) {
  Remove-Item -LiteralPath $runtimePortsFile -ErrorAction SilentlyContinue
}

# 2a) Stop any leftover Baker listeners on typical dev ports (including auto-selected 31xx).
Stop-BakerListenersInRange -minPort 3000 -maxPort 3999

# Select usable ports after cleanup.
$excluded = Get-ExcludedTcpPortRanges
$excludedUdp = Get-ExcludedUdpPortRanges
$reservedPorts = New-Object System.Collections.Generic.HashSet[int]
$resolvedWebPort = Find-FreeTcpPortUnique -preferred $WebPort -startSearchAt 3233 -excludedRanges $excluded -reservedPorts $reservedPorts
[void]$reservedPorts.Add($resolvedWebPort)
$resolvedApiPort = Find-FreeTcpPortUnique -preferred $ApiPort -startSearchAt 3101 -excludedRanges $excluded -reservedPorts $reservedPorts
[void]$reservedPorts.Add($resolvedApiPort)
$resolvedGatewayPort = Find-FreeTcpPortUnique -preferred $GatewayPort -startSearchAt 3102 -excludedRanges $excluded -reservedPorts $reservedPorts
[void]$reservedPorts.Add($resolvedGatewayPort)
$resolvedMediaPort = Find-FreeTcpPortUnique -preferred $MediaPort -startSearchAt 3103 -excludedRanges $excluded -reservedPorts $reservedPorts
[void]$reservedPorts.Add($resolvedMediaPort)

if ($resolvedWebPort -ne $WebPort) {
  Write-Warning "WEB_PORT $WebPort is unavailable/excluded on this machine. Using $resolvedWebPort instead."
  $WebPort = $resolvedWebPort
}
if ($resolvedApiPort -ne $ApiPort) {
  Write-Warning "API_PORT $ApiPort is unavailable/excluded on this machine. Using $resolvedApiPort instead."
  $ApiPort = $resolvedApiPort
}
if ($resolvedGatewayPort -ne $GatewayPort) {
  Write-Warning "GATEWAY_PORT $GatewayPort is unavailable/excluded on this machine. Using $resolvedGatewayPort instead."
  $GatewayPort = $resolvedGatewayPort
}
if ($resolvedMediaPort -ne $MediaPort) {
  Write-Warning "MEDIA_PORT $MediaPort is unavailable/excluded on this machine. Using $resolvedMediaPort instead."
  $MediaPort = $resolvedMediaPort
}

$primaryIp = Get-PrimaryIPv4

# 2) Stop any leftover listeners on known ports.
$ports = @($WebPort, $ApiPort, $GatewayPort, $MediaPort, $AdminPort, $DesktopPort) | Sort-Object -Unique
foreach ($port in $ports) {
  foreach ($processId in Get-ListeningPids -port $port) {
    $cmd = Get-ProcCommandLine -processId $processId
    if ($ForceKillPorts -or (LooksLike-BakerProcess -commandLine $cmd -repoRoot $repoRoot)) {
      Stop-Pid -processId $processId -reason "port:$port"
    } else {
      Write-Warning "Port $port is in use by PID $processId (not confirmed Baker). Re-run with -ForceKillPorts to stop it. Cmd: $cmd"
    }
  }
}

# 3) Start infra.
Push-Location $repoRoot
try {
  Ensure-DockerEngineReady -timeoutSeconds 120
  Write-Host 'Starting infra (postgres, redis)...'
  pnpm infra:up
  if ($LASTEXITCODE -ne 0) {
    throw "pnpm infra:up failed (exit code $LASTEXITCODE). Check Docker Desktop is running and accessible."
  }

  Write-Host 'Applying DB schema (drizzle push)...'
  try {
    pnpm --filter @baker/db db:push
    if ($LASTEXITCODE -ne 0) {
      throw "db:push failed (exit code $LASTEXITCODE)."
    }
  } catch {
    Write-Warning "db:push failed ($($_.Exception.Message)). You may need to apply migrations manually."
  }

  function New-RandomToken([int]$length = 32) {
    $chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    $sb = New-Object System.Text.StringBuilder
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
      $bytes = New-Object byte[] ($length)
      $rng.GetBytes($bytes)
      foreach ($b in $bytes) {
        [void]$sb.Append($chars[$b % $chars.Length])
      }
    } finally {
      $rng.Dispose()
    }
    return $sb.ToString()
  }

  function Try-GetPublicIPv4() {
    try {
      $ip = Invoke-RestMethod -UseBasicParsing -Uri 'https://api.ipify.org' -Method Get -TimeoutSec 4
      $text = [string]$ip
      if ($text -match '^\\d{1,3}(\\.\\d{1,3}){3}$') { return $text }
    } catch {
      return $null
    }
    return $null
  }

  function Test-PrivateIPv4([string]$value) {
    if (-not $value) { return $false }
    if (-not ($value -match '^\\d{1,3}(\\.\\d{1,3}){3}$')) { return $false }
    if ($value -match '^10\\.') { return $true }
    if ($value -match '^127\\.') { return $true }
    if ($value -match '^192\\.168\\.') { return $true }
    if ($value -match '^169\\.254\\.') { return $true }
    if ($value -match '^172\\.(1[6-9]|2[0-9]|3[0-1])\\.') { return $true }
    return $false
  }

  function Try-ResolvePublicIPv4FromHost([string]$hostName) {
    if (-not $hostName) { return $null }
    $candidate = $hostName.Trim()
    if (-not $candidate) { return $null }

    if ($candidate -match '^\\d{1,3}(\\.\\d{1,3}){3}$') {
      if (-not (Test-PrivateIPv4 $candidate)) { return $candidate }
      return $null
    }

    try {
      $resolved = Resolve-DnsName -Name $candidate -Type A -ErrorAction Stop
      foreach ($entry in @($resolved)) {
        $ip = [string]$entry.IPAddress
        if ($ip -and ($ip -match '^\\d{1,3}(\\.\\d{1,3}){3}$') -and -not (Test-PrivateIPv4 $ip)) {
          return $ip
        }
      }
    } catch {
      # Fall back to .NET DNS if Resolve-DnsName is unavailable/fails.
    }

    try {
      $addresses = [System.Net.Dns]::GetHostAddresses($candidate)
      foreach ($address in @($addresses)) {
        if ($address.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { continue }
        $ip = $address.IPAddressToString
        if ($ip -and -not (Test-PrivateIPv4 $ip)) {
          return $ip
        }
      }
    } catch {
      return $null
    }

    return $null
  }

  function Test-TurnHostNeedsPublicExternalIp([string]$turnHostCandidate) {
    if (-not $turnHostCandidate) { return $false }
    $normalized = $turnHostCandidate.Trim().ToLowerInvariant()
    if (-not $normalized) { return $false }
    if ($normalized -eq 'localhost') { return $false }
    if (Test-PrivateIPv4 $normalized) { return $false }
    if ($normalized -eq '0.0.0.0') { return $false }
    return $true
  }

  # Optional: start TURN relay and inject TURN_* for this run.
  if ($EnableTurn) {
    # Pick a TURN listen port that isn't blocked by Windows excluded port ranges.
    # (On some Windows setups, 3478 is reserved and Docker cannot bind it.)
    $resolvedTurnPort = Find-FreePortTcpUdp -preferred $turnPort -startSearchAt 3478 -excludedTcp $excluded -excludedUdp $excludedUdp
    if ($resolvedTurnPort -ne $turnPort) {
      Write-Warning "TURN_PORT $turnPort is unavailable/excluded on this machine. Using $resolvedTurnPort instead."
      $turnPort = $resolvedTurnPort
    }

    if (-not $turnUrls) {
      if (-not $TurnHost) {
        throw 'TURN_URLS is empty and -TurnHost was not provided. Example: scripts/dev-up.ps1 -EnableTurn -TurnHost demo.example.com'
      }
      if (Test-TurnHostNeedsPublicExternalIp $TurnHost) {
        # Public deployments: put hostname first to avoid external clients preferring an unroutable LAN IP.
        # Keep LAN fallback URL for local/LAN troubleshooting.
        # Use ${TurnHost} to avoid PowerShell interpreting `$TurnHost:...` as a scoped variable reference.
        $turnUrls = "turn:${TurnHost}:${turnPort}?transport=udp,turn:${TurnHost}:${turnPort}?transport=tcp,turn:${primaryIp}:${turnPort}?transport=udp,turn:${primaryIp}:${turnPort}?transport=tcp"
      } else {
        $turnUrls = "turn:${primaryIp}:${turnPort}?transport=udp,turn:${primaryIp}:${turnPort}?transport=tcp"
      }
    }

    Write-Host "TURN:   $turnUrls"
    Write-Host "TURN relay ports: ${turnMinPort}-${turnMaxPort}"

    if (-not $turnUsername) { $turnUsername = "baker-${env:USERNAME}" }
    if (-not $turnPassword) { $turnPassword = New-RandomToken 40 }
    if (-not $turnRealm) {
      if ($TurnHost) { $turnRealm = $TurnHost } else { $turnRealm = 'baker' }
    }
    $needsPublicExternalIp = Test-TurnHostNeedsPublicExternalIp $TurnHost
    if ($needsPublicExternalIp) {
      if ($turnExternalIp -and (Test-PrivateIPv4 $turnExternalIp)) {
        throw "TURN_EXTERNAL_IP is private ($turnExternalIp) while TurnHost is public ($TurnHost). Set TURN_EXTERNAL_IP to a public IPv4."
      }
      if (-not $turnExternalIp) {
        $resolvedFromHost = Try-ResolvePublicIPv4FromHost $TurnHost
        if ($resolvedFromHost) {
          $turnExternalIp = $resolvedFromHost
          Write-Host "TURN_EXTERNAL_IP: $turnExternalIp (resolved from TurnHost DNS)"
        } else {
          $publicIp = Try-GetPublicIPv4
          if ($publicIp -and -not (Test-PrivateIPv4 $publicIp)) {
            $turnExternalIp = $publicIp
            Write-Host "TURN_EXTERNAL_IP: $turnExternalIp (auto-detected public IP)"
          } else {
            throw "Could not determine a public TURN external IP for TurnHost '$TurnHost'. Set TURN_EXTERNAL_IP in .env to your public IPv4 and retry."
          }
        }
      }
    } elseif (-not $turnExternalIp) {
      # For local Docker coturn in same-LAN testing, LAN IP avoids NAT hairpin dependencies.
      $turnExternalIp = $primaryIp
      Write-Host "TURN_EXTERNAL_IP: $turnExternalIp (LAN IP for local/LAN testing)"
    }

    # Pass TURN env to docker compose for the turn service.
    $env:TURN_USERNAME = $turnUsername
    $env:TURN_PASSWORD = $turnPassword
    $env:TURN_REALM = $turnRealm
    $env:TURN_PORT = [string]$turnPort
    $env:TURN_MIN_PORT = [string]$turnMinPort
    $env:TURN_MAX_PORT = [string]$turnMaxPort
    if ($turnExternalIp) { $env:TURN_EXTERNAL_IP = $turnExternalIp }

    Write-Host 'Starting TURN relay (docker compose service: turn)...'
    try {
      docker compose up -d --force-recreate turn | Out-Host
      $turnContainerReady = $false
      for ($attempt = 0; $attempt -lt 24; $attempt++) {
        $inspect = ''
        try {
          $inspect = docker inspect baker-turn --format '{{.State.Status}}|{{.State.Running}}|{{.State.Restarting}}|{{.State.ExitCode}}' 2>$null
        } catch {
          $inspect = ''
        }
        if ($LASTEXITCODE -eq 0 -and $inspect) {
          $parts = $inspect.Trim().Split('|')
          if ($parts.Length -ge 4) {
            $isRunning = $parts[1] -eq 'true'
            $isRestarting = $parts[2] -eq 'true'
            if ($isRunning -and -not $isRestarting) {
              $turnContainerReady = $true
              break
            }
            if ($parts[0] -eq 'exited' -or $parts[0] -eq 'dead') {
              break
            }
          }
        }
        Start-Sleep -Milliseconds 500
      }

      if (-not $turnContainerReady) {
        Write-Warning 'TURN container failed to stay running after startup. Voice/stream across networks will fail until TURN is healthy.'
        try {
          docker logs --tail 40 baker-turn | Out-Host
        } catch {
          # ignore
        }
      } else {
        [pscustomobject]@{
          host = if ($TurnHost) { $TurnHost } else { $primaryIp }
          port = $turnPort
          minPort = $turnMinPort
          maxPort = $turnMaxPort
          externalIp = $turnExternalIp
          urls = $turnUrls
          startedAt = (Get-Date).ToString('o')
        } | ConvertTo-Json | Set-Content -LiteralPath $turnRuntimeFile -Encoding UTF8
      }
    } catch {
      Write-Warning "Failed to start TURN via docker compose: $($_.Exception.Message)"
      Write-Warning 'Voice/stream across NAT/VPN may remain unstable. You can run `docker compose up -d turn` manually after setting TURN_USERNAME/TURN_PASSWORD.'
    }
  } else {
    if (Test-Path -LiteralPath $turnRuntimeFile) {
      Remove-Item -LiteralPath $turnRuntimeFile -ErrorAction SilentlyContinue
    }
  }

  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $script:processes = @()

  function Wait-HttpOk([string]$url, [int]$timeoutSeconds = 20) {
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
    while ((Get-Date) -lt $deadline) {
      try {
        $res = Invoke-WebRequest -UseBasicParsing -Uri $url -Method Get -TimeoutSec 2
        if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 300) { return $true }
      } catch {
        # ignore while waiting
      }
      Start-Sleep -Milliseconds 500
    }
    return $false
  }

  function Try-GetPublicServerConfig([string]$apiOrigin) {
    try {
      return Invoke-RestMethod -UseBasicParsing -Uri "$apiOrigin/v1/meta/public-config" -Method Get -TimeoutSec 4
    } catch {
      return $null
    }
  }

  function Build-CmdEnvPrefix([hashtable]$vars) {
    $parts = @()
    foreach ($kv in $vars.GetEnumerator()) {
      $parts += "set `"$($kv.Key)=$($kv.Value)`""
    }
    if ($parts.Count -eq 0) { return '' }
    return ($parts -join ' && ') + ' && '
  }

  function Start-ServiceProcess([string]$name, [string]$command) {
    $stdout = Join-Path $logDir "$timestamp-$name.out.log"
    $stderr = Join-Path $logDir "$timestamp-$name.err.log"
    $cmdLine = "cd /d `"$repoRoot`" && $command"

    $commonArgs = @{
      FilePath = 'cmd.exe'
      PassThru = $true
      ArgumentList = @('/d', '/s', '/c', $cmdLine)
      RedirectStandardOutput = $stdout
      RedirectStandardError = $stderr
    }

    # Default: keep a single *visible* main window (this one) and spawn child processes hidden.
    if ($ShowWindows) {
      $p = Start-Process @commonArgs -WindowStyle Normal
    } else {
      $p = Start-Process @commonArgs -WindowStyle Hidden
    }

    $script:processes += [pscustomobject]@{
      name = $name
      pid = $p.Id
      stdout = $stdout
      stderr = $stderr
      exitNotified = $false
    }
    Write-Host "Started $name (PID $($p.Id))"
  }

  # Services
  $baseEnvVars = @{
    API_PORT = $ApiPort
    GATEWAY_PORT = $GatewayPort
    MEDIA_PORT = $MediaPort
    MEDIA_INTERNAL_URL = "http://127.0.0.1:$MediaPort"
  }
  if ($stunUrls) { $baseEnvVars['STUN_URLS'] = $stunUrls }
  if ($turnUrls) { $baseEnvVars['TURN_URLS'] = $turnUrls }
  if ($turnUsername) { $baseEnvVars['TURN_USERNAME'] = $turnUsername }
  if ($turnPassword) { $baseEnvVars['TURN_PASSWORD'] = $turnPassword }

  $baseEnv = Build-CmdEnvPrefix $baseEnvVars
  Start-ServiceProcess -name 'api' -command "${baseEnv}pnpm --filter @baker/api dev"
  if (-not (Wait-HttpOk -url "http://127.0.0.1:$ApiPort/health" -timeoutSeconds 25)) {
    Write-Warning "API did not become healthy in time (http://127.0.0.1:$ApiPort/health). Check api logs."
  }

  # If the admin panel changed the configured web port, honor it on restart.
  # This still requires a restart (we cannot rebind a running Vite server), but
  # it makes the persisted settings effective for the next dev-up run.
  try {
    $public = Try-GetPublicServerConfig -apiOrigin "http://127.0.0.1:$ApiPort"
    if ($public -and $public.webPort) {
      $configuredWebPort = 0
      try { $configuredWebPort = [int]$public.webPort } catch { $configuredWebPort = 0 }
      if (-not $webPortExplicit -and $configuredWebPort -gt 0 -and $configuredWebPort -ne $WebPort) {
        $resolvedConfiguredWebPort = Find-FreeTcpPortUnique -preferred $configuredWebPort -startSearchAt $configuredWebPort -excludedRanges $excluded -reservedPorts $reservedPorts
        if ($resolvedConfiguredWebPort -ne $configuredWebPort) {
          Write-Warning "Configured webPort $configuredWebPort is unavailable/excluded. Using $resolvedConfiguredWebPort instead."
        } else {
          Write-Host "Using configured webPort from server settings: $configuredWebPort"
        }
        $WebPort = $resolvedConfiguredWebPort
      }
    }
  } catch {
    # ignore (keep existing $WebPort)
  }

  Start-ServiceProcess -name 'gateway' -command "${baseEnv}pnpm --filter @baker/gateway dev"
  Start-ServiceProcess -name 'media' -command "${baseEnv}pnpm --filter @baker/media dev"

  $webEnv = Build-CmdEnvPrefix @{
    API_PORT = $ApiPort
    GATEWAY_PORT = $GatewayPort
    MEDIA_PORT = $MediaPort
    MEDIA_INTERNAL_URL = "http://127.0.0.1:$MediaPort"
    WEB_PORT = $WebPort
    VITE_API_BASE_URL = ''
    # Prefer same-origin `/ws` via Vite proxy so HTTPS deployments don't hit mixed-content.
    VITE_GATEWAY_URL = ''
    VITE_MEDIA_BASE_URL = "http://${primaryIp}:$MediaPort"
    VITE_ALLOWED_HOSTS = $AllowedHosts
  }
  Start-ServiceProcess -name 'web' -command "${webEnv}pnpm --filter @baker/web dev"

  $adminEnv = Build-CmdEnvPrefix @{
    API_PORT = $ApiPort
    GATEWAY_PORT = $GatewayPort
    MEDIA_PORT = $MediaPort
    MEDIA_INTERNAL_URL = "http://127.0.0.1:$MediaPort"
    ADMIN_PORT = $AdminPort
    # Use same-origin requests in the browser (Vite proxy forwards /v1 -> API),
    # so the admin panel works from other LAN devices too.
    VITE_API_BASE_URL = ''
    VITE_ALLOWED_HOSTS = $AllowedHosts
  }
  Start-ServiceProcess -name 'admin' -command "${adminEnv}pnpm --filter @baker/admin dev"

  $script:processes | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8
  [pscustomobject]@{
    host = $primaryIp
    webPort = $WebPort
    apiPort = $ApiPort
    gatewayPort = $GatewayPort
    mediaPort = $MediaPort
    adminPort = $AdminPort
    generatedAt = (Get-Date).ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $runtimePortsFile -Encoding UTF8

  Write-Host ''
  Write-Host "Web:    http://localhost:$WebPort"
  Write-Host "API:    http://localhost:$ApiPort"
  Write-Host "Gateway: ws://localhost:$GatewayPort/ws"
  Write-Host "Admin:  http://localhost:$AdminPort"
  Write-Host "LAN:    http://${primaryIp}:$WebPort"
  Write-Host ''
  Write-Host 'Required open ports (Port / Protocol / Purpose):'
  Write-Host "  $WebPort / TCP       / Web (HTTP dev)"
  Write-Host "  $ApiPort / TCP       / API"
  Write-Host "  $GatewayPort / TCP   / Gateway WebSocket"
  Write-Host "  $AdminPort / TCP     / Admin panel"
  Write-Host "  5432 / TCP           / PostgreSQL"
  Write-Host "  6379 / TCP           / Redis"
  Write-Host "  $turnPort / TCP+UDP  / TURN entry"
  Write-Host "  $turnMinPort-$turnMaxPort / TCP+UDP / TURN relay range"
  Write-Host ''
  if (-not $turnUrls) {
    Write-Warning 'TURN_URLS is not set. Cross-network voice/stream may be unstable (VPN/NAT/UDP-blocked networks). Configure TURN_URLS/TURN_USERNAME/TURN_PASSWORD in .env to enable a TURN relay.'
  } elseif (-not $EnableTurn) {
    Write-Host 'TURN_URLS is set. If you are using the local compose TURN relay, re-run with -EnableTurn or run `docker compose up -d turn`.'
  }
  Write-Host "Logs:   $logDir"
  Write-Host "PIDs:   $pidFile"
  Write-Host "Ports:  $runtimePortsFile"

  if (-not $Detach) {
    Write-Host ''
    Write-Host 'Supervisor: running. Press Ctrl+C to stop services and exit.'
    Write-Host 'Tip: open the *.err.log file when something fails.'

    try {
      while ($true) {
        foreach ($proc in @($script:processes)) {
          $isRunning = $null -ne (Get-Process -Id $proc.pid -ErrorAction SilentlyContinue)
          if (-not $isRunning -and -not $proc.exitNotified) {
            $proc.exitNotified = $true
            Write-Warning "$($proc.name) exited (PID $($proc.pid)). See: $($proc.stderr)"
            try {
              $tail = Get-Content -LiteralPath $proc.stderr -ErrorAction SilentlyContinue -Tail 30
              if ($tail) {
                Write-Host "---- tail $($proc.name).err ----"
                $tail | ForEach-Object { Write-Host $_ }
                Write-Host "------------------------------"
              }
            } catch {
              # ignore
            }
          }
        }
        Start-Sleep -Seconds 2
      }
    } finally {
      Write-Host ''
      Write-Host 'Stopping services...'
      foreach ($proc in @($script:processes)) {
        Stop-Pid -processId ([int]$proc.pid) -reason "shutdown:$($proc.name)"
      }
    }
  }
} finally {
  Pop-Location
}
