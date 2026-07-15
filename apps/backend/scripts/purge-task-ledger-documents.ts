// scripts/purge-task-ledger-documents.ts
// Purge task ledger documents from S3 and PostgreSQL database
import "dotenv/config";
import pg from "pg";
import {
  S3Client,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const DATABASE_URL = process.env.DATABASE_URL;
const BUCKET = process.env.S3_DOCUMENT_BUCKET || "documents";
const AWS_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1";
const DRY_RUN = process.env.DRY_RUN === "true";

const ORG_ID = process.env.ORG_ID || "";
const PREFIX = process.env.PREFIX || "task_ledger/";

console.log("🚀 Startup Validation:");
console.log(`- BUCKET: ${BUCKET}`);
console.log(`- PREFIX: ${PREFIX}`);
console.log(`- DRY_RUN: ${DRY_RUN}`);

if (!BUCKET) {
  console.error("❌ Error: BUCKET name is empty. Check S3_DOCUMENT_BUCKET env var.");
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

type DocRow = {
  id: string;
  org_id: string;
  bucket_key: string;
  pending_delete: boolean;
};

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
        const delay = Math.min(30000, backoff * Math.pow(2, attempt));
        await sleep(delay);
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

async function getLinkCounts(docIds: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  docIds.forEach(id => counts[id] = 0);

  for (const batch of chunk(docIds, 100)) {
    const placeholders = batch.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(
      `SELECT document_id, COUNT(*) as count FROM task_ledger_document_links WHERE document_id IN (${placeholders}) GROUP BY document_id`,
      batch
    );
    for (const row of result.rows) {
      counts[row.document_id] = parseInt(row.count, 10);
    }
  }
  return counts;
}

async function main() {
  console.log(`Searching for documents... (ORG_ID=${ORG_ID || "ALL"}, PREFIX=${PREFIX})`);

  let query = `SELECT id, org_id, bucket_key, pending_delete FROM task_ledger_documents WHERE 1=1`;
  const params: string[] = [];
  let paramIdx = 1;

  if (ORG_ID) {
    query += ` AND org_id = $${paramIdx++}`;
    params.push(ORG_ID);
  }
  if (PREFIX) {
    query += ` AND bucket_key LIKE $${paramIdx++}`;
    params.push(`${PREFIX}%`);
  }

  const { rows } = await pool.query(query, params);
  const docs = rows as DocRow[];

  const report = {
    totalDocsFound: docs.length,
    docsToProcess: 0,
    storageDeleted: 0,
    storageFailed: [] as string[],
    linksDeleted: 0,
    docsDeleted: 0,
    dryRun: DRY_RUN
  };

  if (docs.length === 0) {
    console.log("No documents found matching filters.");
    console.log(JSON.stringify(report, null, 2));
    await pool.end();
    return;
  }

  console.log(`Verifying link counts for ${docs.length} documents...`);
  const docIds = docs.map(d => d.id);
  const linkCounts = await getLinkCounts(docIds);

  const docsWithLinks = docs.map(doc => ({
    ...doc,
    linkCount: linkCounts[doc.id] || 0
  }));

  report.docsToProcess = docsWithLinks.length;

  if (DRY_RUN) {
    console.log("📋 Sample documents (first 5):");
    docsWithLinks.slice(0, 5).forEach(r => console.log(`  - ${r.bucket_key} (links: ${r.linkCount}, pendingDelete: ${r.pending_delete})`));
    console.log("✨ Dry run complete. No deletions performed.");
    console.log(JSON.stringify(report, null, 2));
    await pool.end();
    return;
  }

  const docIdsToUnlink = docs.filter(d => !d.pending_delete).map(d => d.id);

  if (docIdsToUnlink.length > 0) {
    console.log(`Deleting links for ${docIdsToUnlink.length} active documents matching filter...`);
    for (const batch of chunk(docIdsToUnlink, 100)) {
      const placeholders = batch.map((_, i) => `$${i + 1}`).join(',');
      let deleteQuery = `DELETE FROM task_ledger_document_links WHERE document_id IN (${placeholders})`;
      const deleteParams = [...batch];

      if (ORG_ID) {
        deleteQuery += ` AND org_id = $${batch.length + 1}`;
        deleteParams.push(ORG_ID);
      }

      const result = await pool.query(deleteQuery, deleteParams);
      report.linksDeleted += result.rowCount || 0;
    }
  }

  console.log(`Checking which documents have 0 links remaining...`);
  const remainingCounts = await getLinkCounts(docIds);
  const docsToDelete = docs.filter(doc => (remainingCounts[doc.id] || 0) === 0 || doc.pending_delete);

  docs.forEach(doc => {
    const remCount = remainingCounts[doc.id] || 0;
    if (remCount > 0 && !doc.pending_delete) {
      console.log(`  - Preserving storage for ${doc.bucket_key} (${remCount} links remain)`);
    }
  });

  if (docsToDelete.length === 0) {
    console.log("No documents are ready for full deletion (storage + metadata).");
    console.log(JSON.stringify(report, null, 2));
    await pool.end();
    return;
  }

  const paths = docsToDelete.map((d) => d.bucket_key).filter(Boolean);
  const uniquePaths = Array.from(new Set(paths));

  const successfullyDeletedPaths = new Set<string>();

  console.log(`Deleting ${uniquePaths.length} storage objects from bucket "${BUCKET}"...`);
  for (const batch of chunk(uniquePaths, 100)) {
    const result = await deleteWithRetry(batch);
    result.deleted.forEach(p => successfullyDeletedPaths.add(p));
    report.storageDeleted += result.deleted.length;
    report.storageFailed.push(...result.failed);
    console.log(`  - Removed batch: ${result.deleted.length} successful, ${result.failed.length} failed`);
  }

  if (report.storageFailed.length > 0) {
    console.warn(`❌ Failed to delete ${report.storageFailed.length} paths:`);
    report.storageFailed.forEach(p => console.warn(`  - ${p}`));
    console.warn(`These will be kept in DB with pending_delete=true for manual reconciliation or future retries.`);
  }

  const finalDocsToDelete = docsToDelete.filter(d => successfullyDeletedPaths.has(d.bucket_key));
  const finalDocIdsToDelete = finalDocsToDelete.map(d => d.id);

  if (finalDocIdsToDelete.length > 0) {
    console.log(`Deleting ${finalDocIdsToDelete.length} document metadata rows...`);
    for (const batch of chunk(finalDocIdsToDelete, 500)) {
      const placeholders = batch.map((_, i) => `$${i + 1}`).join(',');
      const result = await pool.query(
        `DELETE FROM task_ledger_documents WHERE id IN (${placeholders})`,
        batch
      );
      report.docsDeleted += result.rowCount || 0;
    }
  }

  const docsToMarkPending = docsToDelete.filter(d => !d.pending_delete && !successfullyDeletedPaths.has(d.bucket_key));
  if (docsToMarkPending.length > 0) {
    console.log(`Marking ${docsToMarkPending.length} documents as pending_delete for future retries...`);
    for (const batch of chunk(docsToMarkPending, 100)) {
      const ids = batch.map(d => d.id);
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
      await pool.query(
        `UPDATE task_ledger_documents SET pending_delete = true WHERE id IN (${placeholders})`,
        ids
      );
    }
  }

  console.log("✅ Cleanup complete.");
  console.log(JSON.stringify(report, null, 2));
  await pool.end();
}

main().catch((e) => {
  console.error("❌ Cleanup failed:", e);
  pool.end();
  process.exit(1);
});
