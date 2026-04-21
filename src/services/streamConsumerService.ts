import { StreamingClient, StreamTopics, StreamEvent } from '@deepiri/shared-utils';
import { config } from '../config/environment';
import { logger } from '../utils/logger';

type EventHandler = (event: StreamEvent) => Promise<void>;

const CONSUMER_GROUP = 'language-intelligence-consumers';
const CONSUMER_NAME = `language-intelligence-${process.pid}`;

export class StreamConsumerService {
  private client: StreamingClient | null = null;
  private handlers: Map<string, EventHandler[]> = new Map();

  async connect(): Promise<void> {
    this.client = new StreamingClient(
      config.redis.host,
      config.redis.port,
      config.redis.password
    );
    await this.client.connect();
    logger.info('[Language Intelligence] StreamConsumerService connected to Redis');
  }

  register(eventType: string, handler: EventHandler): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(handler);
  }

  async start(): Promise<void> {
    if (!this.client) throw new Error('StreamConsumerService not connected — call connect() first');

    logger.info('[Language Intelligence] Stream consumer starting', {
      group: CONSUMER_GROUP,
      consumer: CONSUMER_NAME,
    });

    this.client.subscribe(
      StreamTopics.PLATFORM_EVENTS,
      async (event: StreamEvent) => {
        await this.dispatch(event);
      },
      {
        consumerGroup: CONSUMER_GROUP,
        consumerName: CONSUMER_NAME,
        blockMs: 5000,
      }
    ).catch((err: any) => {
      logger.error('[Language Intelligence] Stream consumer fatal error', { error: err.message });
    });

    logger.info('[Language Intelligence] Stream consumer started');
  }

  private async dispatch(event: StreamEvent): Promise<void> {
    const handlers = this.handlers.get(event.event) ?? [];
    if (handlers.length === 0) return;

    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (err: any) {
        logger.error('[Language Intelligence] Handler error', {
          event: event.event,
          error: err.message,
        });
      }
    }
  }

  async stop(): Promise<void> {
    await this.client?.disconnect();
    logger.info('[Language Intelligence] StreamConsumerService stopped');
  }
}

export const streamConsumer = new StreamConsumerService();