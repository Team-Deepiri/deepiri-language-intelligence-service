import type {
  DocumentRouteDestination,
  JsonObject,
  MetadataWithRouting,
  RoutingIdempotencyInput,
  RoutingMetadata,
} from './types';

function encodeKeyPart(value: string | number): string {
  return String(value).trim().replace(/\s+/g, '-');
}

export function buildRoutingIdempotencyKey(input: RoutingIdempotencyInput): string {
  const versionOrFingerprint = input.fingerprint
    ? `fingerprint:${encodeKeyPart(input.fingerprint)}`
    : `manifest:${encodeKeyPart(input.manifestVersion ?? 'unversioned')}`;

  return [
    'document-route',
    encodeKeyPart(input.documentId),
    encodeKeyPart(input.destination),
    versionOrFingerprint,
  ].join(':');
}

export function buildRoutingMetadata(input: {
  documentId: string;
  destination: DocumentRouteDestination;
  manifestVersion?: string | number;
  fingerprint?: string;
  correlationId?: string;
  routedAt?: string;
}): RoutingMetadata {
  return {
    idempotencyKey: buildRoutingIdempotencyKey(input),
    destination: input.destination,
    manifestVersion: input.manifestVersion,
    fingerprint: input.fingerprint,
    routedAt: input.routedAt ?? new Date().toISOString(),
    correlationId: input.correlationId,
  };
}

export function mergeRoutingMetadata(
  metadata: JsonObject | undefined,
  routing: RoutingMetadata
): MetadataWithRouting {
  return {
    ...(metadata ?? {}),
    routing: {
      ...((metadata?.routing as RoutingMetadata | undefined) ?? {}),
      ...routing,
    },
  };
}
