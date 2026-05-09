import type { DocumentRouteTopic } from './documentRouteTopics';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: unknown;
}

export type DocumentRouteDestination = 'vectorize' | 'structured' | 'training';

export interface StorageReference {
  provider?: string;
  bucket?: string;
  key?: string;
  uri?: string;
  versionId?: string;
  contentType?: string;
  checksum?: string;
  sizeBytes?: number;
  metadata?: JsonObject;
}

export interface DocumentReference {
  documentId: string;
  title?: string;
  sourceType?: string;
  mimeType?: string;
  fingerprint?: string;
  storage?: StorageReference;
  metadata?: JsonObject;
}

export interface ChunkReference {
  chunkId: string;
  documentId?: string;
  index: number;
  text?: string;
  tokenCount?: number;
  storage?: StorageReference;
  metadata?: JsonObject;
}

export interface EmbeddedTrainingPayload {
  instruction?: string;
  input?: string;
  output?: string;
  category?: string;
  quality_score?: number;
  [key: string]: JsonValue | undefined;
}

export type TrainingIngestionPayload = EmbeddedTrainingPayload & {
  instruction: string;
  input: string;
  output: string;
  category: string;
  quality_score: number;
};

export interface RoutingManifest {
  documentId: string;
  manifestVersion: string | number;
  destinations: DocumentRouteDestination[];
  qualityScore: number;
  classification?: JsonValue;
  structuredOutput?: JsonValue;
  trainingPayload?: EmbeddedTrainingPayload;
  embeddingModel?: string;
  correlationId?: string;
  fingerprint?: string;
}

export interface DocumentRoutePlanningInput {
  manifest: RoutingManifest;
  document: DocumentReference;
  chunks?: ChunkReference[];
  storageReferences?: StorageReference[];
  metadata?: JsonObject;
}

export interface DocumentRoutePayloadBase {
  routeId: string;
  documentId: string;
  manifestVersion: string | number;
  destination: DocumentRouteDestination;
  qualityScore: number;
  correlationId?: string;
  metadata?: JsonObject;
}

export interface VectorizeRoutePayload extends DocumentRoutePayloadBase {
  destination: 'vectorize';
  document: DocumentReference;
  chunks: ChunkReference[];
  storageReferences: StorageReference[];
  embeddingModel?: string;
  classification?: JsonValue;
}

export interface StructuredRoutePayload extends DocumentRoutePayloadBase {
  destination: 'structured';
  document: DocumentReference;
  structuredOutput: JsonValue;
  classification?: JsonValue;
}

export interface TrainingRoutePayload extends DocumentRoutePayloadBase {
  destination: 'training';
  document: DocumentReference;
  trainingPayload: TrainingIngestionPayload;
  classification?: JsonValue;
}

export type DocumentRoutePayload =
  | VectorizeRoutePayload
  | StructuredRoutePayload
  | TrainingRoutePayload;

export type RouteSkippedReason =
  | 'destination_not_requested'
  | 'missing_structured_output'
  | 'training_quality_below_threshold'
  | 'training_payload_missing'
  | 'training_payload_incomplete';

export interface RouteSkipped {
  destination: DocumentRouteDestination;
  reason: RouteSkippedReason;
  message?: string;
}

export interface PlannedDocumentRoute {
  destination: DocumentRouteDestination;
  streamName: DocumentRouteTopic;
  payload: DocumentRoutePayload;
}

export interface RoutingResult {
  documentId: string;
  manifestVersion: string | number;
  planned: PlannedDocumentRoute[];
  skipped: RouteSkipped[];
}

export interface RoutingIdempotencyInput {
  documentId: string;
  destination: DocumentRouteDestination;
  manifestVersion?: string | number;
  fingerprint?: string;
}

export interface RoutingMetadata {
  idempotencyKey: string;
  destination: DocumentRouteDestination;
  manifestVersion?: string | number;
  fingerprint?: string;
  routedAt: string;
  correlationId?: string;
}

export type MetadataWithRouting = JsonObject & {
  routing?: RoutingMetadata;
};

export interface DocumentRouteStreamEvent<TPayload extends DocumentRoutePayload = DocumentRoutePayload> {
  event: string;
  timestamp: string;
  source: string;
  service: string;
  action: string;
  data: TPayload;
}
