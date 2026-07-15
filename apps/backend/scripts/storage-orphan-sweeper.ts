// scripts/storage-orphan-sweeper.ts
// Sweep orphaned objects from S3 that have no corresponding DB record
import "dotenv/config";
import pg from "pg";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const DATABASE_URL = process.env.DATABASE_URL;
const BUCKET = process.env.S3_DOCUMENT_BUCKET || "documents";
const AWS_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1";
const PREFIX = process.env.PREFIX || "task_ledger/";
const DRY_RUN = process.env.DRY_RUN === "true";

console.log("🚀 Storage Orphan Sweeper Startup:");
console.log(`- BUCKET: ${BUCKET}`);
console.log(`- PREFIX: ${PREFIX}`);
console.log(`- DRY_RUN: ${DRY_RUN}`);

if (!BUCKET) {
  console.error("❌ Error: BUCKET name is empty.");
  process.exit(1);
}

if (!DATABASE_URL) {
  throw new Error("Missing DATABASE_URL");
}

const sslDisabled = /sslmode=disable|ssl=false/i.test(DATABASE_URL);
const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: sslDisabled ? false : { rejectUnauthorized: false },
  max: 5,
});

const s3Client = new S3Client({ region: AWS_REGION });

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listAllObjects(prefix: string): Promise<string[]> {
  const allObjects: string[] = [];
  let continuationToken: string | undefined;

  do {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    });

    const response = await s3Client.send(command);

    if (response.Contents) {
      for (const obj of response.Contents) {
        if (obj.Key) {
          allObjects.push(obj.Key);
        }
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return allObjects;
}

async function deleteS3Object(key: string): Promise<boolean> {
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: key,
      })
    );
    return true;
  } catch (error) {
    console.error(`  - Failed to delete S3 object ${key}:`, (error as Error).message);
    return false;
  }
}

async function deleteWithRetry(batch: string[], retries = 3, backoff = 1000): Promise<{ deleted: string[], failed: string[] }> {
  const deleted: string[] = [];
  const failed: string[] = [];

  for (const path of batch) {
    let success = false;
    for (let attempt = 0; attempt < retries; attempt++) {
      if (attempt > 0) {
        console.log(`  - Retry attempt ${attempt} for ${path}...`);
        await sleep(backoff * attempt);
      }
      success = await deleteS3Object(path);
      if (success) break;
    }
    if (success) {
      deleted.push(path);
    } else {
      failed.push(path);
    }
  }

  return { deleted, failed };
}

async function main() {
  console.log(`Listing all objects in bucket "${BUCKET}" under prefix "${PREFIX}"...`);
  const storagePaths = await listAllObjects(PREFIX);
  console.log(`Found ${storagePaths.length} objects in storage.`);

  console.log(`Fetching all document keys from database...`);
  const { rows } = await pool.query(`SELECT bucket_key FROM task_ledger_documents`);
  const dbPaths = new Set(rows.map((d: { bucket_key: string }) => d.bucket_key));
  console.log(`Found ${dbPaths.size} document keys in database.`);

  const orphans = storagePaths.filter(path => !dbPaths.has(path));
  console.log(`Identified ${orphans.length} orphaned objects.`);

  const report = {
    totalStorageObjects: storagePaths.length,
    totalDbDocuments: dbPaths.size,
    orphansFound: orphans.length,
    orphansDeleted: 0,
    orphansFailed: [] as string[],
    dryRun: DRY_RUN
  };

  if (orphans.length === 0) {
    console.log(JSON.stringify(report, null, 2));
    await pool.end();
    return;
  }

  if (DRY_RUN) {
    console.log("📋 Sample orphans (first 5):");
    orphans.slice(0, 5).forEach(p => console.log(`  - ${p}`));
    console.log("✨ Dry run complete. No deletions performed.");
    console.log(JSON.stringify(report, null, 2));
    await pool.end();
    return;
  }

  console.log(`Deleting ${orphans.length} orphaned objects from storage...`);
  for (const batch of chunk(orphans, 100)) {
    const result = await deleteWithRetry(batch);
    report.orphansDeleted += result.deleted.length;
    report.orphansFailed.push(...result.failed);
    console.log(`  - Removed batch: ${result.deleted.length} successful, ${result.failed.length} failed`);
  }

  console.log("✅ Orphan sweep complete.");
  console.log(JSON.stringify(report, null, 2));
  await pool.end();
}

main().catch((e) => {
  console.error("❌ Orphan sweep failed:", e);
  pool.end();
  process.exit(1);
});
