import { StreamingClient, StreamTopics, StreamEvent, secureLog } from '@team-deepiri/shared-utils';
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

export async function publishLeaseCreated(leaseId: string, leaseNumber: string): Promise<void> {
  const event: StreamEvent = {
    event: 'lease-created',
    timestamp: new Date().toISOString(),
    source: 'language-intelligence-service',
    service: 'language-intelligence',
    action: 'lease-created',
    data: { leaseId, leaseNumber },
  };

  await publishEvent(event);
  logger.info(`[Language Intelligence] Published lease-created: ${leaseId}`);
}

export async function publishLeaseProcessed(
  leaseId: string,
  metadata: { processingTimeMs: number; confidence: number }
): Promise<void> {
  const event: StreamEvent = {
    event: 'lease-processed',
    timestamp: new Date().toISOString(),
    source: 'language-intelligence-service',
    service: 'language-intelligence',
    action: 'lease-processed',
    data: { leaseId, ...metadata },
  };

  await publishEvent(event);
  logger.info(`[Language Intelligence] Published lease-processed: ${leaseId}`);
}

export async function publishLeaseProcessingError(
  leaseId: string,
  error: string
): Promise<void> {
  const event: StreamEvent = {
    event: 'lease-processing-error',
    timestamp: new Date().toISOString(),
    source: 'language-intelligence-service',
    service: 'language-intelligence',
    action: 'lease-processing-error',
    data: { leaseId, error },
  };

  await publishEvent(event);
  logger.error(`[Language Intelligence] Published lease-processing-error: ${leaseId}`);
}

export async function publishLeaseVersionCreated(
  leaseId: string,
  versionId: string,
  versionNumber: number
): Promise<void> {
  const event: StreamEvent = {
    event: 'lease-version-created',
    timestamp: new Date().toISOString(),
    source: 'language-intelligence-service',
    service: 'language-intelligence',
    action: 'lease-version-created',
    data: { leaseId, versionId, versionNumber },
  };

  await publishEvent(event);
  logger.info(`[Language Intelligence] Published lease-version-created: ${versionId}`);
}

export async function publishContractCreated(contractId: string, contractNumber: string): Promise<void> {
  const event: StreamEvent = {
    event: 'contract-created',
    timestamp: new Date().toISOString(),
    source: 'language-intelligence-service',
    service: 'language-intelligence',
    action: 'contract-created',
    data: { contractId, contractNumber },
  };

  await publishEvent(event);
  logger.info(`[Language Intelligence] Published contract-created: ${contractId}`);
}

export async function publishContractProcessed(
  contractId: string,
  metadata?: { processingTimeMs?: number; confidence?: number }
): Promise<void> {
  const event: StreamEvent = {
    event: 'contract-processed',
    timestamp: new Date().toISOString(),
    source: 'language-intelligence-service',
    service: 'language-intelligence',
    action: 'contract-processed',
    data: { contractId, ...(metadata || {}) },
  };

  await publishEvent(event);
  logger.info(`[Language Intelligence] Published contract-processed: ${contractId}`);
}

export async function publishContractProcessingError(
  contractId: string,
  error: string
): Promise<void> {
  const event: StreamEvent = {
    event: 'contract-processing-error',
    timestamp: new Date().toISOString(),
    source: 'language-intelligence-service',
    service: 'language-intelligence',
    action: 'contract-processing-error',
    data: { contractId, error },
  };

  await publishEvent(event);
  logger.error(`[Language Intelligence] Published contract-processing-error: ${contractId}`);
}

export async function publishContractVersionCreated(
  contractId: string,
  versionId: string,
  versionNumber: number
): Promise<void> {
  const event: StreamEvent = {
    event: 'contract-version-created',
    timestamp: new Date().toISOString(),
    source: 'language-intelligence-service',
    service: 'language-intelligence',
    action: 'contract-version-created',
    data: { contractId, versionId, versionNumber },
  };

  await publishEvent(event);
  logger.info(`[Language Intelligence] Published contract-version-created: ${versionId}`);
}

export async function publishClauseEvolutionTracked(
  contractId: string,
  metadata: { fromVersion: number; toVersion: number; changesCount: number }
): Promise<void> {
  const event: StreamEvent = {
    event: 'clause-evolution-tracked',
    timestamp: new Date().toISOString(),
    source: 'language-intelligence-service',
    service: 'language-intelligence',
    action: 'clause-evolution-tracked',
    data: { contractId, ...metadata },
  };

  await publishEvent(event);
  logger.info(`[Language Intelligence] Published clause-evolution-tracked: ${contractId}`);
}

export async function publishDependencyGraphBuilt(
  contractId: string,
  metadata: { nodeCount: number; edgeCount: number; cascadeRisks: number }
): Promise<void> {
  const event: StreamEvent = {
    event: 'dependency-graph-built',
    timestamp: new Date().toISOString(),
    source: 'language-intelligence-service',
    service: 'language-intelligence',
    action: 'dependency-graph-built',
    data: { contractId, ...metadata },
  };

  await publishEvent(event);
  logger.info(`[Language Intelligence] Published dependency-graph-built: ${contractId}`);
}

export async function publishObligationCreated(
  obligationId: string,
  metadata?: {
    leaseId?: string;
    contractId?: string;
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
    leaseId?: string;
    contractId?: string;
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
  metadata?: { leaseId?: string; contractId?: string }
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
  publishLeaseCreated,
  publishLeaseProcessed,
  publishLeaseProcessingError,
  publishLeaseVersionCreated,
  publishContractCreated,
  publishContractProcessed,
  publishContractProcessingError,
  publishContractVersionCreated,
  publishClauseEvolutionTracked,
  publishDependencyGraphBuilt,
  publishObligationCreated,
  publishObligationUpdated,
  publishObligationDeleted,
  publishDependencyCreated,
  publishDependencyDeleted,
};

