import { DOCUMENT_ROUTE_TOPICS } from './documentRouteTopics';
import { buildRoutingMetadata, mergeRoutingMetadata } from './routingMetadata';
import type {
  DocumentRouteDestination,
  DocumentRoutePlanningInput,
  DocumentRoutePayloadBase,
  PlannedDocumentRoute,
  RouteSkipped,
  RoutingManifest,
  RoutingResult,
  StructuredRoutePayload,
  TrainingIngestionPayload,
  TrainingRoutePayload,
  VectorizeRoutePayload,
} from './types';

export const TRAINING_ROUTE_QUALITY_THRESHOLD = 0.4;

function destinationRequested(
  manifest: RoutingManifest,
  destination: DocumentRouteDestination
): boolean {
  return manifest.destinations.includes(destination);
}

function buildBasePayload(
  input: DocumentRoutePlanningInput,
  destination: DocumentRouteDestination
): DocumentRoutePayloadBase {
  const { manifest } = input;
  const routingMetadata = buildRoutingMetadata({
    documentId: manifest.documentId,
    destination,
    manifestVersion: manifest.manifestVersion,
    fingerprint: manifest.fingerprint ?? input.document.fingerprint,
    correlationId: manifest.correlationId,
  });

  return {
    routeId: routingMetadata.idempotencyKey,
    documentId: manifest.documentId,
    manifestVersion: manifest.manifestVersion,
    destination,
    qualityScore: manifest.qualityScore,
    correlationId: manifest.correlationId,
    metadata: mergeRoutingMetadata(
      input.metadata,
      routingMetadata
    ),
  };
}

export function buildVectorizeRoutePayload(
  input: DocumentRoutePlanningInput
): VectorizeRoutePayload {
  const { manifest } = input;

  return {
    ...buildBasePayload(input, 'vectorize'),
    destination: 'vectorize',
    document: input.document,
    chunks: input.chunks ?? [],
    storageReferences: input.storageReferences ?? [],
    embeddingModel: manifest.embeddingModel,
    classification: manifest.classification,
  };
}

export function buildStructuredRoutePayload(
  input: DocumentRoutePlanningInput
): StructuredRoutePayload | undefined {
  const { manifest } = input;

  if (manifest.structuredOutput === undefined) {
    return undefined;
  }

  return {
    ...buildBasePayload(input, 'structured'),
    destination: 'structured',
    document: input.document,
    structuredOutput: manifest.structuredOutput,
    classification: manifest.classification,
  };
}

function hasTextValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isCompleteTrainingPayload(value: unknown): value is TrainingIngestionPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const payload = value as Partial<TrainingIngestionPayload>;

  return (
    hasTextValue(payload.instruction) &&
    hasTextValue(payload.input) &&
    hasTextValue(payload.output) &&
    hasTextValue(payload.category) &&
    typeof payload.quality_score === 'number'
  );
}

function getTrainingSkip(input: DocumentRoutePlanningInput): RouteSkipped | undefined {
  const { manifest } = input;

  if (manifest.qualityScore < TRAINING_ROUTE_QUALITY_THRESHOLD) {
    return {
      destination: 'training',
      reason: 'training_quality_below_threshold',
      message: `Training route requires qualityScore >= ${TRAINING_ROUTE_QUALITY_THRESHOLD}.`,
    };
  }

  if (!manifest.trainingPayload) {
    return {
      destination: 'training',
      reason: 'training_payload_missing',
      message: 'Training route requires embedded training content.',
    };
  }

  if (!isCompleteTrainingPayload(manifest.trainingPayload)) {
    return {
      destination: 'training',
      reason: 'training_payload_incomplete',
      message: 'Training route requires instruction, input, output, category, and quality_score.',
    };
  }

  return undefined;
}

export function buildTrainingRoutePayload(
  input: DocumentRoutePlanningInput
): TrainingRoutePayload | undefined {
  const trainingSkip = getTrainingSkip(input);

  if (trainingSkip) {
    return undefined;
  }

  return {
    ...buildBasePayload(input, 'training'),
    destination: 'training',
    document: input.document,
    trainingPayload: input.manifest.trainingPayload as TrainingIngestionPayload,
    classification: input.manifest.classification,
  };
}

function skipped(destination: DocumentRouteDestination, reason: RouteSkipped['reason']): RouteSkipped {
  return {
    destination,
    reason,
  };
}

export function planDocumentRoutePayloads(input: DocumentRoutePlanningInput): RoutingResult {
  const planned: PlannedDocumentRoute[] = [];
  const skippedRoutes: RouteSkipped[] = [];
  const { manifest } = input;

  if (destinationRequested(manifest, 'vectorize')) {
    planned.push({
      destination: 'vectorize',
      streamName: DOCUMENT_ROUTE_TOPICS.VECTORIZE,
      payload: buildVectorizeRoutePayload(input),
    });
  } else {
    skippedRoutes.push(skipped('vectorize', 'destination_not_requested'));
  }

  if (destinationRequested(manifest, 'structured')) {
    const structuredPayload = buildStructuredRoutePayload(input);

    if (structuredPayload) {
      planned.push({
        destination: 'structured',
        streamName: DOCUMENT_ROUTE_TOPICS.STRUCTURED,
        payload: structuredPayload,
      });
    } else {
      skippedRoutes.push({
        destination: 'structured',
        reason: 'missing_structured_output',
        message: 'Structured route requires structuredOutput.',
      });
    }
  } else {
    skippedRoutes.push(skipped('structured', 'destination_not_requested'));
  }

  if (destinationRequested(manifest, 'training')) {
    const trainingPayload = buildTrainingRoutePayload(input);

    if (trainingPayload) {
      planned.push({
        destination: 'training',
        streamName: DOCUMENT_ROUTE_TOPICS.TRAINING,
        payload: trainingPayload,
      });
    } else {
      skippedRoutes.push(getTrainingSkip(input) ?? skipped('training', 'training_payload_missing'));
    }
  } else {
    skippedRoutes.push(skipped('training', 'destination_not_requested'));
  }

  return {
    documentId: manifest.documentId,
    manifestVersion: manifest.manifestVersion,
    planned,
    skipped: skippedRoutes,
  };
}

export function isTrainingRouteEligible(input: DocumentRoutePlanningInput): boolean {
  return getTrainingSkip(input) === undefined;
}

export function getTrainingRouteSkipReason(
  input: DocumentRoutePlanningInput
): RouteSkipped | undefined {
  return getTrainingSkip(input);
}
