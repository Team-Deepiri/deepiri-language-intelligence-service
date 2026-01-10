import { PrismaClient } from '@prisma/client';
import { logger } from './utils/logger';

let prisma: PrismaClient;

export async function connectDatabase(): Promise<void> {
  try {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
    
    await prisma.$connect();
    logger.info('Language Intelligence Service: Connected to PostgreSQL');
  } catch (error: any) {
    logger.error('Language Intelligence Service: Failed to connect to PostgreSQL', error);
    throw error;
  }
}

export { prisma };

