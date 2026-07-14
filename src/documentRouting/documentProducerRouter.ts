import { planDocumentRoutePayloads } from './documentRoutePayloads';
import type {
  DocumentRoutePlanningInput,
  DocumentRoutePayload,
  DocumentRouteStreamEvent,
  RoutingResult,
} from './types';

export type DocumentRoutePublish = (streamName: string, event: unknown) => Promise<void>;

export interface DocumentProducerRouterOptions {
  source?: string;
  service?: string;
}

export class DocumentProducerRouter {
  private readonly publish: DocumentRoutePublish;
  private readonly source: string;
  private readonly service: string;

  constructor(publish: DocumentRoutePublish, options: DocumentProducerRouterOptions = {}) {
    this.publish = publish;
    this.source = options.source ?? 'language-intelligence-service';
    this.service = options.service ?? 'language-intelligence';
  }

  async route(input: DocumentRoutePlanningInput): Promise<RoutingResult> {
    const result = planDocumentRoutePayloads(input);

    for (const route of result.planned) {
      await this.publish(route.streamName, this.buildEvent(route.payload));
    }

    return result;
  }

  private buildEvent(payload: DocumentRoutePayload): DocumentRouteStreamEvent {
    const action = `document.${payload.destination}.route`;

    return {
      schemaVersion: '1.0',
      event: action,
      timestamp: new Date().toISOString(),
      source: this.source,
      service: this.service,
      action,
      data: payload,
    };
  }
}
