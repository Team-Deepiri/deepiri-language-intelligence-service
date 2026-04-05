import { StreamEvent } from '@deepiri/shared-utils';
import { prisma } from '../db';
import { logger } from '../utils/logger';

export async function handleDocumentCreated(event: StreamEvent): Promise<void> {
  const { documentId } = event.data as { documentId: string };
  logger.info('[DocumentEventHandler] document-created received', { documentId });
  await prisma.intelligenceDocument.updateMany({
    where: { id: documentId, processingStatus: null },
    data: { processingStatus: 'INGESTED_FROM_STREAM' },
  });
}

export async function handleDocumentProcessed(event: StreamEvent): Promise<void> {
  const { documentId, processingTimeMs, confidence } = event.data as {
    documentId: string;
    processingTimeMs?: number;
    confidence?: number;
  };
  logger.info('[DocumentEventHandler] document-processed received', { documentId });
  await prisma.intelligenceDocument.updateMany({
    where: { id: documentId },
    data: {
      processingStatus: 'COMPLETED',
      ...(processingTimeMs !== undefined && { processingTimeMs }),
      ...(confidence !== undefined && { extractionConfidence: confidence }),
      processedAt: new Date(),
    },
  });
}

export async function handleDocumentProcessingError(event: StreamEvent): Promise<void> {
  const { documentId, error } = event.data as { documentId: string; error?: string };
  logger.info('[DocumentEventHandler] document-processing-error received', { documentId });
  await prisma.intelligenceDocument.updateMany({
    where: { id: documentId },
    data: {
      processingStatus: 'ERROR',
      processingError: error || 'Unknown error',
    },
  });
}
