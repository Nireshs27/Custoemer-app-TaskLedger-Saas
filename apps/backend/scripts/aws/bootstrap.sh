#!/bin/bash
# EC2 bootstrap for Task Ledger on AWS (ap-south-1)
# Installs Node.js, pulls artifact from S3, loads /opt/task-ledger/.env, starts PM2.
set -exo pipefail

APP_DIR=/opt/task-ledger
ARTIFACT_BUCKET=task-ledger-artifacts-prod
REGION=ap-south-1

dnf install -y nodejs unzip || {
  curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
  dnf install -y nodejs unzip
}

npm install -g pm2

mkdir -p "$APP_DIR"
cd "$APP_DIR"

aws s3 cp "s3://${ARTIFACT_BUCKET}/latest/app.zip" /tmp/app.zip --region "$REGION"
rm -rf "$APP_DIR"/*
unzip -o /tmp/app.zip -d "$APP_DIR"
cd "$APP_DIR"

npm ci --omit=dev 2>/dev/null || npm install --omit=dev

export NODE_ENV=$(aws ssm get-parameter --region "$REGION" --name /task-ledger/prod/NODE_ENV --query Parameter.Value --output text)
export PORT=$(aws ssm get-parameter --region "$REGION" --name /task-ledger/prod/PORT --query Parameter.Value --output text)
export DATABASE_URL=$(aws ssm get-parameter --region "$REGION" --with-decryption --name /task-ledger/prod/DATABASE_URL --query Parameter.Value --output text)
export SESSION_SECRET=$(aws ssm get-parameter --region "$REGION" --with-decryption --name /task-ledger/prod/SESSION_SECRET --query Parameter.Value --output text)
export APP_BASE_URL=$(aws ssm get-parameter --region "$REGION" --name /task-ledger/prod/APP_BASE_URL --query Parameter.Value --output text)
export SINGLE_TENANT_MODE=$(aws ssm get-parameter --region "$REGION" --name /task-ledger/prod/SINGLE_TENANT_MODE --query Parameter.Value --output text)
export ALLOW_PUBLIC_REGISTRATION=$(aws ssm get-parameter --region "$REGION" --name /task-ledger/prod/ALLOW_PUBLIC_REGISTRATION --query Parameter.Value --output text)
export S3_DOCUMENT_BUCKET=$(aws ssm get-parameter --region "$REGION" --name /task-ledger/prod/S3_DOCUMENT_BUCKET --query Parameter.Value --output text)

npx drizzle-kit push || true

pm2 delete task-ledger 2>/dev/null || true
pm2 start dist/index.js --name task-ledger
pm2 save
pm2 startup systemd -u root --hp /root || true
