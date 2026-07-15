import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const TASK_LEDGER_PREFIX = "task_ledger/uploaded_documents";
const MAX_FILENAME_LENGTH = 120;

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    const region =
      process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION ||
      "ap-south-1";
    s3Client = new S3Client({ region });
  }
  return s3Client;
}

function getAwsBucketName(fallback: string): string {
  return process.env.S3_DOCUMENT_BUCKET?.trim() || fallback;
}

/**
 * Canonical source for the Task Ledger storage bucket.
 * Uses S3_DOCUMENT_BUCKET env var, defaults to "documents".
 */
export function getTaskLedgerBucket(): string {
  return process.env.S3_DOCUMENT_BUCKET?.trim() || "documents";
}

/**
 * Build the storage object key for Task Ledger document uploads.
 * Pure function, no IO. Path: task_ledger/uploaded_documents/<orgId>/<documentId>/<sanitizedFileName>
 */
export function buildTaskLedgerObjectKey(params: {
  orgId: string;
  documentId: string;
  originalFileName: string;
}): string {
  const { orgId, documentId, originalFileName } = params;
  let base = originalFileName.replace(/[/\\]/g, "").replace(/\s/g, "_");
  base = base.replace(/[\x00-\x1f\x7f]/g, "");
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".")) : "";
  const nameWithoutExt = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
  let safe = nameWithoutExt.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
  if (ext) safe += ext;
  if (safe.length > MAX_FILENAME_LENGTH) safe = safe.slice(0, MAX_FILENAME_LENGTH);
  if (!safe) safe = "file";
  return `${TASK_LEDGER_PREFIX}/${orgId}/${documentId}/${safe}`;
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  /**
   * Get signed upload URL using S3
   * @param bucket S3 bucket name (e.g., "documents")
   * @param path Object path within bucket (no leading slash)
   * @returns Signed upload URL and token (token is empty for S3)
   */
  async getUploadURL(bucket: string, path: string): Promise<{ uploadURL: string; token: string }> {
    const s3 = getS3Client();
    const bucketName = getAwsBucketName(bucket);
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: path,
    });
    const uploadURL = await getSignedUrl(s3, command, { expiresIn: 900 });
    return {
      uploadURL,
      token: "",
    };
  }

  /**
   * Get signed download URL using S3
   * @param bucket S3 bucket name
   * @param path Object path within bucket
   * @returns Signed download URL (1 hour expiry)
   */
  async getDownloadURL(bucket: string, path: string): Promise<string> {
    const s3 = getS3Client();
    const bucketName = getAwsBucketName(bucket);
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: path,
    });
    return await getSignedUrl(s3, command, { expiresIn: 3600 });
  }

  /**
   * Get signed preview URL using S3
   * Creates a URL valid for 10 minutes (600 seconds)
   * @param bucket S3 bucket name
   * @param path Object path within bucket
   * @returns Signed preview URL
   */
  async getPreviewURL(bucket: string, path: string): Promise<string> {
    const s3 = getS3Client();
    const bucketName = getAwsBucketName(bucket);
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: path,
    });
    return await getSignedUrl(s3, command, { expiresIn: 600 });
  }

  /**
   * Delete object from S3
   * @param bucket S3 bucket name
   * @param path Object path within bucket
   */
  async deleteObject(bucket: string, path: string): Promise<void> {
    const s3 = getS3Client();
    const bucketName = getAwsBucketName(bucket);
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: path,
        }),
      );
    } catch (error) {
      console.warn(
        `Failed to delete S3 object ${bucketName}/${path}:`,
        (error as Error).message,
      );
    }
  }

  /**
   * Upload object to S3
   * @param bucket S3 bucket name
   * @param path Object path within bucket
   * @param content File content (Buffer or Uint8Array)
   * @param mimeType MIME type of the file
   */
  async uploadObject(bucket: string, path: string, content: Buffer | Uint8Array, mimeType: string): Promise<void> {
    const s3 = getS3Client();
    const bucketName = getAwsBucketName(bucket);
    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: path,
        Body: content,
        ContentType: mimeType,
      }),
    );
  }

  /**
   * Get object bytes from S3
   * @param bucket S3 bucket name
   * @param path Object path within bucket
   * @returns File content as Buffer
   */
  async getObjectBuffer(bucket: string, path: string): Promise<Buffer> {
    const s3 = getS3Client();
    const bucketName = getAwsBucketName(bucket);
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: path,
      }),
    );
    const body = response.Body;
    if (!body) {
      throw new Error("S3 download returned no data");
    }
    const chunks: Uint8Array[] = [];
    for await (const chunk of body as any as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Verify object existence using HEAD request.
   * @param bucket S3 bucket name
   * @param key Object path within bucket
   * @returns true if exists, false otherwise
   */
  async verifyObjectExists(bucket: string, key: string): Promise<boolean> {
    const s3 = getS3Client();
    const bucketName = getAwsBucketName(bucket);
    try {
      await s3.send(
        new HeadObjectCommand({
          Bucket: bucketName,
          Key: key,
        }),
      );
      return true;
    } catch (error) {
      const msg = (error as any)?.name || "";
      if (msg === "NotFound" || msg === "NoSuchKey") {
        return false;
      }
      throw error;
    }
  }

  /**
   * STRICT Delete object from S3.
   * Returns true if delete succeeded OR object not found.
   * Returns false if delete failed. Does NOT throw.
   * @param bucket S3 bucket name
   * @param path Object path within bucket
   */
  async deleteObjectStrict(bucket: string, path: string): Promise<boolean> {
    const s3 = getS3Client();
    const bucketName = getAwsBucketName(bucket);
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: path,
        }),
      );
      return true;
    } catch (e) {
      console.error(
        `Unexpected error during STRICT delete for S3 object ${bucketName}/${path}:`,
        e,
      );
      return false;
    }
  }
}
