import {
  StreamingClient,
  StreamTopics,
  StreamEvent,
  type DocumentIngestionRecordPayload,
} from '@deepiri/shared-utils';
import { config } from '../config/environment';
import { logger } from '../utils/logger';
import { broadcastEvent } from './socketBroadcaster';

let streamingClient: StreamingClient | null = null;

export async function initializeEventPublisher(): Promise<void> {
  try {
    streamingClient = new StreamingClient(
      config.redis.host,
      config.redis.port,
      config.redis.password
    );
    await streamingClient.connect();
    logger.info('[Language Intelligence] Connected to Redis Streams');
  } catch (error: any) {
    logger.error('[Language Intelligence] Failed to initialize event publisher:', { error: error.message });
    throw error;
  }
}

async function publishEvent(event: StreamEvent): Promise<void> {
  if (!streamingClient) await initializeEventPublisher();

  await streamingClient!.publish(StreamTopics.PLATFORM_EVENTS, event);
  broadcastEvent(event.event, event);
}

async function publishIngestionEvent(event: StreamEvent): Promise<void> {
  if (!streamingClient) await initializeEventPublisher();
  await streamingClient!.publish(StreamTopics.INGESTION_EVENTS, event);
}

export async function publishDocumentCreated(
  documentId: string,
  documentKey: string,
  meta?: { documentKind?: string; intelligenceProfile?: string }
): Promise<void> {
  const event: StreamEvent = {
    event: 'document-created',
    timestamp: new Date().toISOString(),
    source: 'language-intelligence-service',
    service: 'language-intelligence',
    action: 'document-created',
    data: { documentId, documentKey, ...meta },
  };
  await publishEvent(event);
  logger.info(`[Language Intelligence] Published document-created: ${documentId}`);
}

export async function publishDocumentProcessed(
  documentId: string,
  metadata: {
    processingTimeMs: number;
    confidence: number;
    documentKind?: string;
    intelligenceProfile?: string;
  }
): Promise<void> {
  const event: StreamEvent = {
    event: 'document-processed',
    timestamp: new Date().toISOString(),
    source: 'language-intelligence-service',
    service: 'language-intelligence',
    action: 'document-processed',
    data: { documentId, ...metadata },
  };
  await publishEvent(event);
  logger.info(`[Language Intelligence] Published document-processed: ${documentId}`);
}

export async function publishDocumentProcessingError(documentId: string, error: string): Promise<void> {
  const event: StreamEvent = {
    event: 'document-processing-error',
    timestamp: new Date().toISOString(),
    source: 'language-intelligence-service',
    service: 'language-intelligence',
    action: 'document-processing-error',
    data: { documentId, error },
  };
  await publishEvent(event);
  logger.error(`[Language Intelligence] Published document-processing-error: ${documentId}`);
}

export async function publishDocumentVersionCreated(
  documentId: string,
  versionId: string,
  versionNumber: number
): Promise<void> {
  const event: StreamEvent = {
    event: 'document-version-created',
    timestamp: new Date().toISOString(),
    source: 'language-intelligence-service',
    service: 'language-intelligence',
    action: 'document-version-created',
    data: { documentId, versionId, versionNumber },
  };
  await publishEvent(event);
  logger.info(`[Language Intelligence] Published document-version-created: ${versionId}`);
}

export async function publishDocumentIngestionRecord(
  payload: DocumentIngestionRecordPayload,
  correlationId?: string
): Promise<void> {
  const event: StreamEvent = {
    event: 'document-ingestion-record',
    timestamp: new Date().toISOString(),
    source: 'language-intelligence-service',
    service: 'language-intelligence',
    action: 'document-ingestion-record',
    correlation_id: correlationId,
    data: payload,
  };
  await publishIngestionEvent(event);
  logger.info(`[Language Intelligence] Published document-ingestion-record: ${payload.documentId}`);
}

export async function publishObligationCreated(
  obligationId: string,
  metadata?: {
    intelligenceDocumentId?: string;
    status?: string;
    obligationType?: string;
    owner?: string;
  }
): Promise<void> {
  const event: StreamEvent = {
    event: 'obligation-created',
    timestamp: new Date().toISOString(),
    source: 'language-intelligence-service',
    service: 'language-intelligence',
    action: 'obligation-created',
    data: { obligationId, ...(metadata || {}) },
  };

  await publishEvent(event);
  logger.info(`[Language Intelligence] Published obligation-created: ${obligationId}`);
}

export async function publishObligationUpdated(
  obligationId: string,
  metadata?: {
    intelligenceDocumentId?: string;
    status?: string;
    obligationType?: string;
    owner?: string;
  }
): Promise<void> {
  const event: StreamEvent = {
    event: 'obligation-updated',
    timestamp: new Date().toISOString(),
    source: 'language-intelligence-service',
    service: 'language-intelligence',
    action: 'obligation-updated',
    data: { obligationId, ...(metadata || {}) },
  };

  await publishEvent(event);
  logger.info(`[Language Intelligence] Published obligation-updated: ${obligationId}`);
}

export async function publishObligationDeleted(
  obligationId: string,
  metadata?: { intelligenceDocumentId?: string }
): Promise<void> {
  const event: StreamEvent = {
    event: 'obligation-deleted',
    timestamp: new Date().toISOString(),
    source: 'language-intelligence-service',
    service: 'language-intelligence',
    action: 'obligation-deleted',
    data: { obligationId, ...(metadata || {}) },
  };

  await publishEvent(event);
  logger.info(`[Language Intelligence] Published obligation-deleted: ${obligationId}`);
}

export async function publishDependencyCreated(
  sourceObligationId: string,
  targetObligationId: string,
  metadata?: { dependencyType?: string; confidence?: number }
): Promise<void> {
  const event: StreamEvent = {
    event: 'obligation-dependency-created',
    timestamp: new Date().toISOString(),
    source: 'language-intelligence-service',
    service: 'language-intelligence',
    action: 'obligation-dependency-created',
    data: { sourceObligationId, targetObligationId, ...(metadata || {}) },
  };

  await publishEvent(event);
  logger.info(
    `[Language Intelligence] Published obligation-dependency-created: ${sourceObligationId} -> ${targetObligationId}`
  );
}

export async function publishDependencyDeleted(
  sourceObligationId: string,
  targetObligationId: string
): Promise<void> {
  const event: StreamEvent = {
    event: 'obligation-dependency-deleted',
    timestamp: new Date().toISOString(),
    source: 'language-intelligence-service',
    service: 'language-intelligence',
    action: 'obligation-dependency-deleted',
    data: { sourceObligationId, targetObligationId },
  };

  await publishEvent(event);
  logger.info(
    `[Language Intelligence] Published obligation-dependency-deleted: ${sourceObligationId} -> ${targetObligationId}`
  );
}

export const eventPublisher = {
  publishDocumentCreated,
  publishDocumentProcessed,
  publishDocumentProcessingError,
  publishDocumentVersionCreated,
  publishDocumentIngestionRecord,
  publishObligationCreated,
  publishObligationUpdated,
  publishObligationDeleted,
  publishDependencyCreated,
  publishDependencyDeleted,
};

