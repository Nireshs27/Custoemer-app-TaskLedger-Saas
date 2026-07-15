# Bootstrap local PostgreSQL for Task Ledger (Windows).
# Creates role/db matching RDS naming so DATABASE_URL can later swap to AWS.
# Requires Administrator for pg_hba reload when postgres password is unknown.

$ErrorActionPreference = "Stop"

$PgRoot = "C:\Program Files\PostgreSQL\17"
$Port = 5433
$DataDir = Join-Path $PgRoot "data"
$Psql = Join-Path $PgRoot "bin\psql.exe"
$PgCtl = Join-Path $PgRoot "bin\pg_ctl.exe"
$Hba = Join-Path $DataDir "pg_hba.conf"
$HbaBackup = Join-Path $DataDir "pg_hba.conf.bak-taskledger"

$DbName = "taskledger"
$DbUser = "tl_admin"
# Local-only password; change before any shared/prod use.
$DbPass = "tl_local_dev_password"

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "Re-launching elevated..." -ForegroundColor Yellow
  $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  Start-Process powershell.exe -Verb RunAs -ArgumentList $arg -Wait
  exit $LASTEXITCODE
}

if (-not (Test-Path $Psql)) { throw "psql not found at $Psql" }

Write-Step "Backing up and enabling temporary localhost trust auth"
if (-not (Test-Path $HbaBackup)) {
  Copy-Item $Hba $HbaBackup -Force
}
$raw = Get-Content $Hba -Raw
$raw = $raw -replace '(?m)^(host\s+all\s+all\s+127\.0\.0\.1/32\s+)\S+','$1trust'
$raw = $raw -replace '(?m)^(host\s+all\s+all\s+::1/128\s+)\S+','$1trust'
Set-Content -Path $Hba -Value $raw -NoNewline

Write-Step "Reloading PostgreSQL 17 (port $Port)"
& $PgCtl reload -D $DataDir
Start-Sleep -Seconds 1

Write-Step "Creating role and database"
& $Psql -U postgres -h 127.0.0.1 -p $Port -d postgres -v ON_ERROR_STOP=1 -c @"
DO `$`$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DbUser') THEN
    CREATE ROLE $DbUser LOGIN PASSWORD '$DbPass';
  ELSE
    ALTER ROLE $DbUser WITH LOGIN PASSWORD '$DbPass';
  END IF;
END
`$`$;
"@

$exists = & $Psql -U postgres -h 127.0.0.1 -p $Port -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$DbName'"
if ($exists -ne "1") {
  & $Psql -U postgres -h 127.0.0.1 -p $Port -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DbName OWNER $DbUser;"
} else {
  & $Psql -U postgres -h 127.0.0.1 -p $Port -d postgres -c "ALTER DATABASE $DbName OWNER TO $DbUser;"
}

& $Psql -U postgres -h 127.0.0.1 -p $Port -d $DbName -v ON_ERROR_STOP=1 -c @"
GRANT ALL ON SCHEMA public TO $DbUser;
ALTER SCHEMA public OWNER TO $DbUser;
GRANT ALL ON DATABASE $DbName TO $DbUser;
"@

Write-Step "Restoring scram-sha-256 auth"
if (Test-Path $HbaBackup) {
  Copy-Item $HbaBackup $Hba -Force
} else {
  $raw2 = Get-Content $Hba -Raw
  $raw2 = $raw2 -replace '(?m)^(host\s+all\s+all\s+127\.0\.0\.1/32\s+)\S+','$1scram-sha-256'
  $raw2 = $raw2 -replace '(?m)^(host\s+all\s+all\s+::1/128\s+)\S+','$1scram-sha-256'
  Set-Content -Path $Hba -Value $raw2 -NoNewline
}
& $PgCtl reload -D $DataDir
Start-Sleep -Seconds 1

Write-Step "Verifying login as $DbUser"
$env:PGPASSWORD = $DbPass
& $Psql -U $DbUser -h 127.0.0.1 -p $Port -d $DbName -c "SELECT current_user, current_database();"
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

$url = "postgresql://${DbUser}:${DbPass}@127.0.0.1:${Port}/${DbName}?sslmode=disable"
Write-Host "`nLocal DATABASE_URL:" -ForegroundColor Green
Write-Host $url
Write-Host "`nDone. Set this in .env as DATABASE_URL." -ForegroundColor Green

# Write a machine-local helper file (gitignored patterns should cover .env.*)
$out = Join-Path $PSScriptRoot "local-database-url.txt"
Set-Content -Path $out -Value $url -NoNewline
Write-Host "Also wrote $out"
