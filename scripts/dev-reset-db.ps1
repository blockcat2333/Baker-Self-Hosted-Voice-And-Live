<#
.SYNOPSIS
  Resets the local dev database by deleting Docker volumes (postgres + redis).

.DESCRIPTION
  This is destructive for local dev only. It runs:
    docker compose down -v
    docker compose up -d postgres redis
  Then it best-effort runs drizzle db:push.

.PARAMETER Force
  Required to actually delete volumes.
#>

[CmdletBinding(SupportsShouldProcess)]
param(
  [switch]$Force,
  [string]$AdminPassword = 'admin',
  [switch]$KeepOpen
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $repoRoot
$hadError = $false
try {
  $shouldReset = $Force
  if (-not $shouldReset) {
    Write-Warning 'This will DELETE local Docker volumes for postgres + redis for this repo.'
    $confirm = Read-Host 'Type RESET to continue (or anything else to cancel)'
    if ($confirm -ne 'RESET') {
      Write-Host 'Cancelled.'
      return
    }
    $shouldReset = $true
  }

  try {
    Write-Host 'Checking Docker...'
    try {
      docker info | Out-Null
    } catch {
      throw "Docker does not appear to be running or accessible. Start Docker Desktop, then retry. Details: $($_.Exception.Message)"
    }

    if ($shouldReset -and $PSCmdlet.ShouldProcess('docker compose', 'down -v (delete volumes)')) {
      Write-Host 'Stopping infra and deleting volumes (postgres + redis)...'
      docker compose down -v
    }

    Write-Host 'Starting infra (postgres, redis)...'
    pnpm infra:up

    Write-Host 'Applying DB schema (drizzle push)...'
    try {
      pnpm --filter @baker/db db:push
    } catch {
      Write-Warning "db:push failed ($($_.Exception.Message)). You may need to apply migrations manually."
    }

    Write-Host "Resetting admin panel password in DB to '${AdminPassword}'..."
    try {
      $env:ADMIN_PASSWORD = $AdminPassword
      node scripts\reset-admin-password.mjs
    } catch {
      Write-Warning "Failed to reset admin password: $($_.Exception.Message)"
    } finally {
      Remove-Item Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue
    }

    Write-Host 'Done.'
  } catch {
    $hadError = $true
    Write-Error $_
  }
} finally {
  Pop-Location
  if ($KeepOpen -or $hadError) {
    Write-Host ''
    [void](Read-Host 'Press Enter to close')
  }
}
