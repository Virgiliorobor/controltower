import { z } from 'zod';

// Zod-validated environment loader. 12-factor: every value comes from the environment Coolify injects.
// No localhost defaults — production endpoints are the live VPS services. Fails fast and loud on a bad/missing var.

const booleanFromString = z
  .string()
  .transform((value) => value.toLowerCase() === 'true' || value === '1')
  .pipe(z.boolean());

// Treat an empty-string env var (common when a docker-compose passes ${VAR} for an unset var) as "not set".
const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

const envSchema = z.object({
  NODE_ENV: z.enum(['production', 'development', 'test']).default('production'),
  PORT: z.coerce.number().int().positive().default(8080),
  PUBLIC_BASE_URL: z.string().url(),
  DEFAULT_LOCALE: z.enum(['es', 'en']).default('es'),
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((value) =>
      (value ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),

  DATABASE_URL: z.string().min(1),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(8),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

  // Document storage driver: fs (default; bytes on a persistent disk volume) | s3 (S3-compatible).
  STORAGE_DRIVER: z.enum(['fs', 's3']).default('fs'),
  // fs driver: absolute path to the mounted persistent volume where document bytes live.
  DOCUMENTS_DIR: z.string().default('/data/documents'),
  DOCUMENT_MAX_BYTES: z.coerce.number().int().positive().default(10_485_760),

  // s3 driver only — required (and validated below) when STORAGE_DRIVER=s3, ignored otherwise.
  S3_ENDPOINT: z.preprocess(emptyToUndefined, z.string().url().optional()),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('cct-documents'),
  S3_ACCESS_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  S3_SECRET_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  S3_FORCE_PATH_STYLE: booleanFromString.default('true'),
  S3_SIGNED_URL_TTL: z.coerce.number().int().positive().default(86400),

  ANTHROPIC_API_KEY: z.string().min(1),
  INTERVIEW_MODEL: z.string().default('claude-opus-4-8'),
  FRESHNESS_MODEL: z.string().default('claude-haiku-4-5'),

  FRESHNESS_CRON_ENABLED: booleanFromString.default('true'),
  FRESHNESS_CRON: z.string().default('0 6 * * *'),

  // Consumed only by the seed script; harmless at runtime.
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().optional(),

  WEB_DIST_DIR: z.string().optional(),
}).superRefine((env, ctx) => {
  // When using the s3 driver, the connection vars become mandatory (the fs driver ignores them).
  if (env.STORAGE_DRIVER === 's3') {
    for (const key of ['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when STORAGE_DRIVER=s3`,
        });
      }
    }
  }
});

export type AppConfig = z.infer<typeof envSchema>;

let cachedConfig: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cachedConfig = parsed.data;
  return cachedConfig;
}

export const isProduction = (): boolean => loadConfig().NODE_ENV === 'production';
