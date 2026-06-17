import { PrismaClient } from '@prisma/client';
import { loadConfig } from './config.js';

// Prisma client singleton. The ONE generated client; every module imports this — none instantiates its own.

let cachedClient: PrismaClient | null = null;

export function getDb(): PrismaClient {
  if (cachedClient) {
    return cachedClient;
  }
  const config = loadConfig();
  cachedClient = new PrismaClient({
    datasources: { db: { url: config.DATABASE_URL } },
    log: config.NODE_ENV === 'production' ? ['warn', 'error'] : ['query', 'warn', 'error'],
  });
  return cachedClient;
}

export async function disconnectDb(): Promise<void> {
  if (cachedClient) {
    await cachedClient.$disconnect();
    cachedClient = null;
  }
}

export type Db = PrismaClient;
