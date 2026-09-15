$ErrorActionPreference = "Stop"

if (-not $env:CREATOR_DATABASE_URL) {
    throw "CREATOR_DATABASE_URL is required."
}

$backupRoot = Join-Path $PSScriptRoot "..\backups\creator"
$resolvedProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
$resolvedBackupRoot = (Resolve-Path $backupRoot).Path
if (-not $resolvedBackupRoot.StartsWith($resolvedProjectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe backup directory."
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$output = Join-Path $resolvedBackupRoot "castaryn-creator-$timestamp.dump"

# Pass the connection string (which contains the password) via the PGDATABASE
# environment variable instead of a CLI argument -- libpq accepts a full
# connection URI there, and unlike argv, env vars don't show up in the
# process list for other users on the machine (`Get-Process`/`ps`).
$env:PGDATABASE = $env:CREATOR_DATABASE_URL
try {
    & pg_dump --format=custom --no-owner --no-privileges --file=$output
    if ($LASTEXITCODE -ne 0) {
        throw "pg_dump failed."
    }

    & pg_restore --list $output | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Backup verification failed."
    }
} catch {
    if (Test-Path $output) {
        Remove-Item $output -Force
    }
    throw
} finally {
    Remove-Item Env:\PGDATABASE -ErrorAction SilentlyContinue
}

Write-Output $output
