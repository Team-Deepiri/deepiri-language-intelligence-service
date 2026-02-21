import { PrismaClient } from '@prisma/client';
import { secureLog } from '@deepiri/shared-utils';

// Create a single PrismaClient instance and export it. connectDatabase() will call $connect().
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

export async function connectDatabase(): Promise<void> {
  try {
    await prisma.$connect();
    secureLog('info', 'Language Intelligence Service: Connected to PostgreSQL');
  } catch (error: any) {
    secureLog('error', 'Language Intelligence Service: Failed to connect to PostgreSQL', error);
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect();
    logger.info('Language Intelligence Service: Disconnected from PostgreSQL');
  } catch (error: any) {
    logger.warn('Error disconnecting Prisma client', error);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('SIGINT received - disconnecting from database');
  await disconnectDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received - disconnecting from database');
  await disconnectDatabase();
  process.exit(0);
});