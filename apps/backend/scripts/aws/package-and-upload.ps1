# Build Task Ledger and upload deployment artifact to S3 (ap-south-1)
# Usage: .\scripts\aws\package-and-upload.ps1
$ErrorActionPreference = "Stop"
$Region = "ap-south-1"
$Bucket = "task-ledger-artifacts-prod"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $Root

Write-Host "Building..."
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$Staging = Join-Path $env:TEMP "task-ledger-deploy"
if (Test-Path $Staging) { Remove-Item -Recurse -Force $Staging }
New-Item -ItemType Directory -Path $Staging | Out-Null

Copy-Item -Recurse dist $Staging\dist
Copy-Item package.json, package-lock.json $Staging\
Copy-Item -Recurse shared $Staging\shared
Copy-Item drizzle.config.ts $Staging\
Copy-Item -Recurse migrations $Staging\migrations -ErrorAction SilentlyContinue
Copy-Item scripts\aws\bootstrap.sh $Staging\bootstrap.sh

$ZipPath = Join-Path $env:TEMP "task-ledger-app.zip"
if (Test-Path $ZipPath) { Remove-Item $ZipPath }
Compress-Archive -Path "$Staging\*" -DestinationPath $ZipPath -Force

Write-Host "Uploading to s3://$Bucket/latest/app.zip ..."
aws s3 cp $ZipPath "s3://$Bucket/latest/app.zip" --region $Region
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Done. Trigger instance refresh or re-run bootstrap on EC2."
