import { PrismaClient } from '@prisma/client';
import { secureLog } from '@deepiri/shared-utils';

let prisma: PrismaClient;

export async function connectDatabase(): Promise<void> {
  try {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
    
    await prisma.$connect();
    secureLog('info', 'Language Intelligence Service: Connected to PostgreSQL');
  } catch (error: any) {
    secureLog('error', 'Language Intelligence Service: Failed to connect to PostgreSQL', error);
    throw error;
  }
}

export { prisma };

