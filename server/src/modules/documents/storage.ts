// S3-compatible object storage (architecture_spec §7). Bytes NEVER go in Postgres — only here.
// Configured purely from env (S3_ENDPOINT/REGION/BUCKET/ACCESS_KEY/SECRET_KEY/FORCE_PATH_STYLE) so it works
// against MinIO-on-VPS or external S3 with no code change. Retrieval is via short-lived presigned URLs.
//
// No localhost (Rule 1): the endpoint is whatever Coolify injects (e.g. http://cct-minio:9000 inside the
// compose network, or an external S3 endpoint). We never hardcode a value. Missing required env is caught by
// the zod config loader at startup with a clear error — not a crash-on-import here (the client is constructed
// lazily from already-validated config).

import { Readable } from 'node:stream';
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

export class ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly signedUrlTtl: number;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {
    this.bucket = config.S3_BUCKET;
    this.signedUrlTtl = config.S3_SIGNED_URL_TTL;
    this.client = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE, // MinIO needs path-style addressing
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY,
        secretAccessKey: config.S3_SECRET_KEY,
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

  // Helper to drain an SDK Readable to a Buffer if a future retrieval path needs the bytes server-side.
  static async toBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer));
    }
    return Buffer.concat(chunks);
  }
}
