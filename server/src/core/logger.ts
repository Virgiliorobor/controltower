import pino from 'pino';

// Structured JSON logger. No sensitive data in logs (security baseline): password fields and tokens are redacted.
const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'password',
      'password_hash',
      '*.password',
      '*.password_hash',
      'req.headers.cookie',
      'req.headers.authorization',
      'SESSION_SECRET',
      'ANTHROPIC_API_KEY',
      'S3_SECRET_KEY',
    ],
    censor: '[redacted]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = pino.Logger;

export const logger: Logger = baseLogger;

export function childLogger(bindings: Record<string, unknown>): Logger {
  return baseLogger.child(bindings);
}
