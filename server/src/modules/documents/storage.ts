// Document byte storage. TWO drivers, selected by STORAGE_DRIVER (fs | s3) — switching is an env change,
// never a code change. Bytes NEVER go in Postgres either way. No localhost (Rule 1): every value is env-injected.
//
//   fs  (default): bytes live on a local persistent volume (DOCUMENTS_DIR, e.g. /data/documents mounted by
//                  Coolify). Simplest for a single-VPS deploy — no extra service, no keys, no bucket. Retrieval
//                  is streamed by the app through an authenticated same-origin route (session-cookie auth).
//   s3  (optional): S3-compatible object storage (MinIO on the VPS, or external S3 / Cloudflare R2). Retrieval
//                  via short-lived presigned URLs. Flip STORAGE_DRIVER=s3 + set S3_* — same upload/registry logic.

import { Readable } from 'node:stream';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { dirname, normalize, resolve as resolvePath, sep } from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '../../core/config.js';
import type { Logger } from '../../core/logger.js';

// The storage contract the documents service depends on. The service branches on `kind` for retrieval:
// s3 → presigned URL; fs → an authenticated app route that streams the bytes (service.readContent).
export interface StorageDriver {
  readonly kind: 'fs' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  ping(): Promise<boolean>;
  // s3 only — a short-lived presigned GET URL. fs throws (its retrieval goes through the app).
  signedGetUrl(key: string, contentType?: string): Promise<string>;
}

export function createStorage(config: AppConfig, logger: Logger): StorageDriver {
  return config.STORAGE_DRIVER === 's3'
    ? new ObjectStorage(config, logger)
    : new FsStorage(config, logger);
}

// ---------- filesystem driver (default) ----------
export class FsStorage implements StorageDriver {
  readonly kind = 'fs' as const;
  private readonly baseDir: string;

  constructor(
    config: AppConfig,
    private readonly logger: Logger,
  ) {
    this.baseDir = resolvePath(config.DOCUMENTS_DIR);
  }

  // Keys are app-generated (documents/<date>/<uuid>.<ext>); still guard against path traversal defensively.
  private full(key: string): string {
    const target = resolvePath(this.baseDir, normalize(key));
    if (target !== this.baseDir && !target.startsWith(this.baseDir + sep)) {
      throw new Error('invalid storage key');
    }
    return target;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const file = this.full(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.full(key));
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.full(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; // already gone is fine
    }
  }

  // Readiness: the volume exists and is writable (mkdir is idempotent).
  async ping(): Promise<boolean> {
    try {
      await mkdir(this.baseDir, { recursive: true });
      return true;
    } catch (error) {
      this.logger.warn({ err: error, dir: this.baseDir }, 'fs storage ping failed');
      return false;
    }
  }

  async signedGetUrl(): Promise<string> {
    throw new Error('signedGetUrl is not supported by the fs storage driver (retrieval is app-streamed)');
  }
}

// ---------- S3-compatible driver (optional) ----------
export class ObjectStorage implements StorageDriver {
  readonly kind = 's3' as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly signedUrlTtl: number;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {
    this.bucket = config.S3_BUCKET;
    this.signedUrlTtl = config.S3_SIGNED_URL_TTL;
    // S3_* are guaranteed present here by the config superRefine (required when STORAGE_DRIVER=s3).
    this.client = new S3Client({
      endpoint: config.S3_ENDPOINT!,
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE, // MinIO needs path-style addressing
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY!,
        secretAccessKey: config.S3_SECRET_KEY!,
      },
    });
  }

  // Store bytes under a key. The key is the documents.storage_path (file_ref) — set by the editor upload path
  // only, never by the AI.
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async read(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return ObjectStorage.toBuffer(res.Body as Readable);
  }

  // A short-lived signed GET URL — nothing in the bucket is publicly readable; the SPA requests a fresh URL.
  async signedGetUrl(key: string, contentType?: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(contentType ? { ResponseContentType: contentType } : {}),
      }),
      { expiresIn: this.signedUrlTtl },
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  // Optional readiness probe (the bucket is reachable). Not called on import — only on demand.
  async ping(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch (error) {
      this.logger.warn({ err: error, bucket: this.bucket }, 'object storage ping failed');
      return false;
    }
  }

  // Drain an SDK Readable to a Buffer.
  static async toBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer));
    }
    return Buffer.concat(chunks);
  }
}
