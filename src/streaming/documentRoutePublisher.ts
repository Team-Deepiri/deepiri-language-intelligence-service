import { StreamingClient, type StreamEvent } from '@team-deepiri/shared-utils';
import { config } from '../config/environment';
import { logger } from '../utils/logger';

const DOCUMENT_ROUTE_STREAM_MAX_LENGTH = 50000;

let documentRouteClient: StreamingClient | null = null;
let sugarGliderHealthy: boolean | null = null;

function eventTypeFromPayload(event: unknown): string {
  if (event && typeof event === 'object') {
    const record = event as Record<string, unknown>;
    if (typeof record.event === 'string' && record.event.trim()) {
      return record.event;
    }
    if (typeof record.action === 'string' && record.action.trim()) {
      return record.action;
    }
  }
  return 'document.route';
}

async function sugarGliderReady(): Promise<boolean> {
  if (!config.synapse.useSidecar) {
    return false;
  }

  if (sugarGliderHealthy === true) {
    return true;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.synapse.timeoutMs);

  try {
    const response = await fetch(`${config.synapse.sugarGliderUrl}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    sugarGliderHealthy = response.ok;
    return sugarGliderHealthy;
  } catch {
    sugarGliderHealthy = false;
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function publishViaSugarGlider(streamName: string, event: unknown): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.synapse.timeoutMs);

  try {
    const response = await fetch(`${config.synapse.sugarGliderUrl}/v1/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        stream: streamName,
        event_type: eventTypeFromPayload(event),
        sender: 'language-intelligence-service',
        priority: 'normal',
        payload: event,
      }),
    });

    if (response.status === 503) {
      // Sidecar queued to WAL — treat as accepted for routing continuity.
      const body = (await response.json().catch(() => ({}))) as { queued?: boolean };
      if (body.queued) {
        return 'queued';
      }
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Sugar Glider publish failed (${response.status}): ${body}`);
    }

    const body = (await response.json()) as { entry_id?: string };
    return body.entry_id ?? null;
  } finally {
    clearTimeout(timer);
  }
}

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

/**
 * Prefer Sugar Glider (SYNAPSE_TRANSPORT=sidecar) so LIS document.* routes
 * share the same bus path as Cyrex / Helox / ModelKit. Fall back to direct
 * Redis XADD when the sidecar is unavailable.
 */
export async function publishDocumentRoute(streamName: string, event: unknown): Promise<void> {
  if (await sugarGliderReady()) {
    try {
      await publishViaSugarGlider(streamName, event);
      return;
    } catch (error: any) {
      sugarGliderHealthy = false;
      logger.warn('[Language Intelligence] Sugar Glider publish failed; falling back to Redis', {
        streamName,
        error: error?.message || String(error),
      });
    }
  }

  if (!documentRouteClient) {
    await initializeDocumentRoutePublisher();
  }

  await documentRouteClient!.publish(
    streamName,
    event as StreamEvent,
    DOCUMENT_ROUTE_STREAM_MAX_LENGTH
  );
}
