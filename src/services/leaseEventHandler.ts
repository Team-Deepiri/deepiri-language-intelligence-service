import { StreamEvent } from '@deepiri/shared-utils';
import { prisma } from '../db';
import { logger } from '../utils/logger';

export async function handleLeaseCreated(event: StreamEvent): Promise<void> {
  const { leaseId } = event.data as { leaseId: string; leaseNumber: string };
  logger.info('[LeaseEventHandler] lease-created received', { leaseId });
  await prisma.lease.updateMany({
    where: { id: leaseId, processingStatus: null },
    data: { processingStatus: 'INGESTED_FROM_STREAM' },
  });
}

export async function handleLeaseProcessed(event: StreamEvent): Promise<void> {
  const { leaseId, processingTimeMs, confidence } = event.data as {
    leaseId: string;
    processingTimeMs: number;
    confidence: number;
  };
  logger.info('[LeaseEventHandler] lease-processed received', { leaseId });
  await prisma.lease.updateMany({
    where: { id: leaseId },
    data: {
      processingStatus: 'COMPLETED',
      processingTimeMs,
      extractionConfidence: confidence,
      processedAt: new Date(),
    },
  });
}

export async function handleLeaseProcessingError(event: StreamEvent): Promise<void> {
  const { leaseId, error } = event.data as { leaseId: string; error: string };
  logger.warn('[LeaseEventHandler] lease-processing-error received', { leaseId, error });
  await prisma.lease.updateMany({
    where: { id: leaseId },
    data: { processingStatus: 'ERROR', processingError: error },
  });
}