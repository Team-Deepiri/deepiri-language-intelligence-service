import type {
  DocumentRouteDestination,
  JsonObject,
  MetadataWithRouting,
  RoutingIdempotencyInput,
  RoutingMetadata,
} from './types';
import { createHash } from 'node:crypto';

function encodeKeyPart(value: string | number): string {
  return String(value).trim().replace(/\s+/g, '-');
}

function hashKeyPart(value: string | number): string {
  return createHash('sha256').update(String(value).trim()).digest('hex');
}

export function buildRoutingIdempotencyKey(input: RoutingIdempotencyInput): string {
  const keyParts = [
    'document-route',
    `document:${hashKeyPart(input.documentId)}`,
    encodeKeyPart(input.destination),
    `manifest:${hashKeyPart(input.manifestVersion ?? 'unversioned')}`,
  ];

  if (input.fingerprint) {
    keyParts.push(`fingerprint:${hashKeyPart(input.fingerprint)}`);
  }

  return keyParts.join(':');
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
