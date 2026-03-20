import { StreamEvent } from '@deepiri/shared-utils';
import { prisma } from '../db';
import { logger } from '../utils/logger';

export async function handleContractCreated(event: StreamEvent): Promise<void> {
  const { contractId } = event.data as { contractId: string };
  logger.info('[ContractEventHandler] contract-created received', { contractId });
  await prisma.contract.updateMany({
    where: { id: contractId, processingStatus: null },
    data: { processingStatus: 'INGESTED_FROM_STREAM' },
  });
}

export async function handleContractProcessed(event: StreamEvent): Promise<void> {
  const { contractId, processingTimeMs, confidence } = event.data as {
    contractId: string;
    processingTimeMs?: number;
    confidence?: number;
  };
  logger.info('[ContractEventHandler] contract-processed received', { contractId });
  await prisma.contract.updateMany({
    where: { id: contractId },
    data: {
      processingStatus: 'COMPLETED',
      ...(processingTimeMs !== undefined && { processingTimeMs }),
      ...(confidence !== undefined && { extractionConfidence: confidence }),
      processedAt: new Date(),
    },
  });
}