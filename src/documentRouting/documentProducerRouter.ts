import { planDocumentRoutePayloads } from './documentRoutePayloads';
import type {
  DocumentRoutePlanningInput,
  DocumentRoutePayload,
  DocumentRouteStreamEvent,
  PlannedDocumentRoute,
  RoutePublicationFailure,
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
    const plannedResult = planDocumentRoutePayloads(input);
    const published: PlannedDocumentRoute[] = [];
    const failed: RoutePublicationFailure[] = [];

    for (const route of plannedResult.planned) {
      try {
        await this.publish(route.streamName, this.buildEvent(route.payload));
        published.push(route);
      } catch (error: any) {
        failed.push({
          destination: route.destination,
          streamName: route.streamName,
          routeId: route.payload.routeId,
          error: error?.message || String(error),
        });
      }
    }

    return {
      ...plannedResult,
      planned: published,
      failed,
    };
  }

  private buildEvent(payload: DocumentRoutePayload): DocumentRouteStreamEvent {
    const action = `document.${payload.destination}.route`;

    const event: DocumentRouteStreamEvent = {
      schemaVersion: 'document.route.v1',
      event: action,
      timestamp: new Date().toISOString(),
      source: this.source,
      service: this.service,
      action,
      data: payload,
    };

    if (payload.correlationId) {
      event.correlation_id = payload.correlationId;
    }

    return event;
  }
}
