import { StreamingClient, type StreamEvent } from '@team-deepiri/shared-utils';
import { config } from '../config/environment';
import { logger } from '../utils/logger';

const DOCUMENT_ROUTE_STREAM_MAX_LENGTH = 50000;

let documentRouteClient: StreamingClient | null = null;

export async function initializeDocumentRoutePublisher(): Promise<void> {
  if (documentRouteClient) {
    return;
  }

  try {
    documentRouteClient = new StreamingClient(
      config.redis.host,
      config.redis.port,
      config.redis.password
    );
    await documentRouteClient.connect();
    logger.info('[Language Intelligence] Connected document route publisher to Redis Streams');
  } catch (error: any) {
    documentRouteClient = null;
    logger.error('[Language Intelligence] Failed to initialize document route publisher', {
      error: error.message,
    });
    throw error;
  }
}

export async function publishDocumentRoute(streamName: string, event: unknown): Promise<void> {
  if (!documentRouteClient) {
    await initializeDocumentRoutePublisher();
  }

  await documentRouteClient!.publish(
    streamName,
    event as StreamEvent,
    DOCUMENT_ROUTE_STREAM_MAX_LENGTH
  );
}
