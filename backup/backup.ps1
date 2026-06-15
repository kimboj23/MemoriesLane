<#
  Local backup of the Supabase-hosted MemoryLane data.

  Produces, under backup/:
    db/memorylane-<timestamp>.sql   - full pg_dump (schema + data) via the postgres:16 image
    photos-<timestamp>/             - every object from the private Storage bucket

  Both run in Docker, so no local psql / node install is needed.
  Reads DATABASE_URL + SUPABASE_* from ../backend/.env.

  Run manually:   powershell -ExecutionPolicy Bypass -File backup\backup.ps1
  Or let the scheduled task (see register-task.ps1) run it daily.
#>
param(
  [int]$KeepDays = 14   # delete dumps/photo folders older than this many days
)

$ErrorActionPreference = "Stop"
$root      = Split-Path -Parent $PSScriptRoot          # project root
$backupDir = $PSScriptRoot
$envFile   = Join-Path $root "backend\.env"
$stamp     = Get-Date -Format "yyyy-MM-dd_HHmmss"

if (-not (Test-Path $envFile)) { throw "backend/.env not found at $envFile" }

# Read DATABASE_URL from backend/.env
$dbLine = Get-Content $envFile | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
$dbUrl  = $dbLine -replace '^\s*DATABASE_URL\s*=\s*', ''
if ([string]::IsNullOrWhiteSpace($dbUrl)) { throw "DATABASE_URL not set in backend/.env" }

New-Item -ItemType Directory -Force -Path (Join-Path $backupDir "db") | Out-Null

# 1. Database dump (postgres:16 image)
$sqlName = "memorylane-$stamp.sql"
Write-Host "[backup] dumping database -> db/$sqlName"
# postgres:17 — pg_dump must be >= the Supabase server version (17.x)
$dumpArgs = @("run","--rm","-v","${backupDir}:/backup","postgres:17",
              "pg_dump",$dbUrl,"--no-owner","--no-privileges","-f","/backup/db/$sqlName")
& docker $dumpArgs
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed (exit $LASTEXITCODE)" }

# 2. Photo bucket (backend image already has @supabase/supabase-js)
$photoDir = "photos-$stamp"
Write-Host "[backup] downloading photos -> $photoDir"
$photoArgs = @("run","--rm","--env-file",$envFile,"-v","${backupDir}:/backup",
               "memorieslane-backend","node","scripts/backup-photos.js","/backup/$photoDir")
& docker $photoArgs
if ($LASTEXITCODE -ne 0) { Write-Warning "photo backup failed (exit $LASTEXITCODE) - DB dump still saved" }

# 3. Retention
$cutoff = (Get-Date).AddDays(-$KeepDays)
Get-ChildItem (Join-Path $backupDir "db") -Filter "memorylane-*.sql" -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt $cutoff } | Remove-Item -Force
Get-ChildItem $backupDir -Directory -Filter "photos-*" -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt $cutoff } | Remove-Item -Recurse -Force

Write-Host "[backup] done: db/$sqlName + $photoDir"
