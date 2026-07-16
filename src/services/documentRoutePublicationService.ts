import {
  DocumentProducerRouter,
  type DocumentRoutePublish,
} from '../documentRouting/documentProducerRouter';
import type {
  ArtifactRequest,
  ChunkReference,
  DocumentRouteDestination,
  DocumentRoutePlanningInput,
  EmbeddedTrainingPayload,
  JsonObject,
  JsonValue,
  RoutePublicationFailure,
  RouteSkipped,
  RoutingResult,
  StorageReference,
} from '../documentRouting/types';
import { publishDocumentRoute } from '../streaming/documentRoutePublisher';
import { logger } from '../utils/logger';

export const DOCUMENT_ROUTE_TEXT_CHAR_LIMIT = 20000;
export const DOCUMENT_ROUTE_TRAINING_OUTPUT_CHAR_LIMIT = 50000;

const DOCUMENT_ROUTE_DESTINATIONS: DocumentRouteDestination[] = [
  'vectorize',
  'structured',
  'training',
];

export interface RouteableDocument {
  id: string;
  title?: string | null;
  documentUrl: string;
  documentStorageKey?: string | null;
  contentType?: string | null;
  fileSize?: number | null;
  userId?: string | null;
  organizationId?: string | null;
  fingerprint?: string | null;
  metadata?: unknown;
}

export interface PublishDocumentRoutesInput {
  document: RouteableDocument;
  documentType: string;
  schemaId: string;
  schemaVersion: string;
  rawText: string;
  structuredOutput: unknown;
  qualityScore?: number | string | null;
  versionNumber?: number | string | null;
  manifestVersion?: string | number | null;
  processingTimeMs: number;
  destinations?: DocumentRouteDestination[];
  classification?: unknown;
  metadata?: unknown;
  artifactRequests?: unknown;
  provenance?: unknown;
  trainingInstruction?: string;
  trainingCategory?: string;
  trainingOutput?: unknown;
  embeddingModel?: string;
}

interface NormalizedDocumentRouteInput {
  document: RouteableDocument;
  documentType: string;
  schemaId: string;
  schemaVersion: string;
  rawText: string;
  structuredOutput: unknown;
  qualityScore: number;
  manifestVersion: string;
  versionNumber?: number | string | null;
  processingTimeMs: number;
  destinations: DocumentRouteDestination[];
  classification: JsonValue;
  metadata: JsonObject;
  artifactRequests?: ArtifactRequest[];
  provenance: JsonObject;
  trainingInstruction: string;
  trainingCategory: string;
  trainingOutput: unknown;
  embeddingModel?: string;
}

export interface DocumentRoutePublicationSummary {
  destination: DocumentRouteDestination;
  streamName: string;
  routeId: string;
}

export interface DocumentRoutePublicationResult {
  status: 'published' | 'partial' | 'failed' | 'skipped';
  documentId: string;
  manifestVersion: string;
  publishedAt: string;
  planned: DocumentRoutePublicationSummary[];
  failed: RoutePublicationFailure[];
  skipped: RouteSkipped[];
}

interface LimitedText {
  text: string;
  originalLength: number;
  truncated: boolean;
  limit: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && !(value instanceof Map)
    && !(value instanceof Set)
  );
}

function isValidDocumentId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeRequiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Validation Error: Missing ${label}.`);
  }

  return value.trim();
}

function assertDocumentRoutePublicationInput(input: PublishDocumentRoutesInput): void {
  if (!input?.document || !isValidDocumentId(input.document.id)) {
    throw new Error('Validation Error: Missing primary document ID.');
  }

  normalizeRequiredString(input.documentType, 'dynamic document type');
  normalizeRequiredString(input.schemaId, 'document schema ID');
  normalizeRequiredString(input.schemaVersion, 'document schema version');
}

function toJsonValue(value: unknown, seen: WeakSet<object> = new WeakSet<object>()): JsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Map) {
    if (seen.has(value)) {
      return undefined;
    }

    seen.add(value);

    try {
      const output: JsonObject = {};
      for (const [key, item] of value.entries()) {
        const jsonValue = toJsonValue(item, seen);
        if (jsonValue !== undefined) {
          output[String(key)] = jsonValue;
        }
      }
      return output;
    } finally {
      seen.delete(value);
    }
  }

  if (value instanceof Set) {
    if (seen.has(value)) {
      return undefined;
    }

    seen.add(value);

    try {
      return Array.from(value)
        .map((item) => toJsonValue(item, seen))
        .filter((item): item is JsonValue => item !== undefined);
    } finally {
      seen.delete(value);
    }
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return undefined;
    }

    seen.add(value);

    try {
      return value
        .map((item) => toJsonValue(item, seen))
        .filter((item): item is JsonValue => item !== undefined);
    } finally {
      seen.delete(value);
    }
  }

  if (isRecord(value)) {
    if (seen.has(value)) {
      return undefined;
    }

    return cleanJsonObject(value, seen);
  }

  return String(value);
}

function cleanJsonObject(
  input: Record<string, unknown>,
  seen: WeakSet<object> = new WeakSet<object>()
): JsonObject {
  if (seen.has(input)) {
    return {};
  }

  seen.add(input);

  const output: JsonObject = {};

  try {
    for (const [key, value] of Object.entries(input)) {
      const jsonValue = toJsonValue(value, seen);
      if (jsonValue !== undefined) {
        output[key] = jsonValue;
      }
    }

    return output;
  } finally {
    seen.delete(input);
  }
}

function asJsonValue(value: unknown): JsonValue {
  return toJsonValue(value) ?? null;
}

function normalizeMimeType(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const mediaType = value.split(';', 1)[0].trim().toLowerCase();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mediaType) ? mediaType : undefined;
}

function normalizeArtifactRequests(value: unknown): ArtifactRequest[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const requests = Array.isArray(value) ? value : [value];
  const normalized = requests
    .map((request) => {
      if (!isRecord(request)) {
        return undefined;
      }

      const cleaned = cleanJsonObject(request) as ArtifactRequest;
      return Object.keys(cleaned).length > 0 ? cleaned : undefined;
    })
    .filter((request): request is ArtifactRequest => request !== undefined);

  return normalized.length > 0 ? normalized : undefined;
}

function limitText(value: unknown, limit: number): LimitedText {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);

  return {
    text: text.length > limit ? text.slice(0, limit) : text,
    originalLength: text.length,
    truncated: text.length > limit,
    limit,
  };
}

function stringifyTrainingOutput(value: unknown): string {
  try {
    return JSON.stringify(toJsonValue(value) ?? {});
  } catch {
    return String(value ?? '');
  }
}

function normalizeQualityScore(...values: Array<number | string | null | undefined>): number {
  for (const value of values) {
    const score = typeof value === 'string' ? Number(value) : value;
    if (typeof score === 'number' && Number.isFinite(score)) {
      return Math.max(0, Math.min(1, score));
    }
  }

  return 0;
}

function buildDocumentManifestVersion(versionNumber?: number | string | null): string {
  const version = versionNumber == null || String(versionNumber).trim().length === 0
    ? 'unversioned'
    : String(versionNumber).trim();

  return `document:${version}`;
}

function buildCorrelationId(documentId: string, manifestVersion: string): string {
  return `document:${documentId}:${manifestVersion}`;
}

function buildStorageReference(document: RouteableDocument): StorageReference {
  return {
    provider: 'object-storage',
    key: document.documentStorageKey ?? undefined,
    uri: document.documentUrl,
    contentType: document.contentType ?? undefined,
    sizeBytes: document.fileSize ?? undefined,
  };
}

function buildChunks(documentId: string, limitedText: LimitedText): ChunkReference[] {
  if (limitedText.text.trim().length === 0) {
    return [];
  }

  return [
    {
      chunkId: `${documentId}:text-preview:0`,
      documentId,
      index: 0,
      text: limitedText.text,
      metadata: cleanJsonObject({
        source: 'extracted_text',
        originalCharacterCount: limitedText.originalLength,
        truncated: limitedText.truncated,
        limit: limitedText.limit,
      }),
    },
  ];
}

function buildTrainingPayload(input: {
  instruction: string;
  rawText: LimitedText;
  output: LimitedText;
  category: string;
  qualityScore: number;
}): EmbeddedTrainingPayload {
  return cleanJsonObject({
    instruction: input.instruction,
    input: input.rawText.text,
    output: input.output.text,
    category: input.category,
    quality_score: input.qualityScore,
    input_truncated: input.rawText.truncated,
    output_truncated: input.output.truncated,
  }) as EmbeddedTrainingPayload;
}

function buildBaseMetadata(input: {
  documentType: string;
  schemaId: string;
  schemaVersion: string;
  document: RouteableDocument;
  versionNumber?: number | string | null;
  processingTimeMs: number;
  rawText: LimitedText;
  trainingOutput: LimitedText;
  metadata: JsonObject;
}): JsonObject {
  return cleanJsonObject({
    ...input.metadata,
    source: {
      service: 'language-intelligence-service',
      entityType: 'document',
      documentId: input.document.id,
      versionNumber: input.versionNumber,
    },
    schema: {
      documentType: input.documentType,
      schemaId: input.schemaId,
      schemaVersion: input.schemaVersion,
    },
    document: {
      uri: input.document.documentUrl,
      storageKey: input.document.documentStorageKey,
      contentType: input.document.contentType,
      fileSize: input.document.fileSize,
    },
    processing: {
      processingTimeMs: input.processingTimeMs,
      rawTextCharacterCount: input.rawText.originalLength,
      rawTextTruncated: input.rawText.truncated,
      rawTextCharacterLimit: input.rawText.limit,
      trainingOutputCharacterCount: input.trainingOutput.originalLength,
      trainingOutputTruncated: input.trainingOutput.truncated,
      trainingOutputCharacterLimit: input.trainingOutput.limit,
    },
    user: {
      userId: input.document.userId,
      organizationId: input.document.organizationId,
    },
  });
}

function buildClassification(input: {
  documentType: string;
  schemaId: string;
  schemaVersion: string;
  classification: unknown;
}): JsonValue {
  const base = {
    documentType: input.documentType,
    schemaId: input.schemaId,
    schemaVersion: input.schemaVersion,
  };

  if (input.classification === undefined) {
    return cleanJsonObject(base);
  }

  if (isRecord(input.classification)) {
    return cleanJsonObject({
      ...base,
      ...input.classification,
    });
  }

  return cleanJsonObject({
    ...base,
    value: input.classification,
  });
}

function buildProvenance(input: {
  documentType: string;
  schemaId: string;
  schemaVersion: string;
  manifestVersion: string;
  document: RouteableDocument;
  provenance: unknown;
}): JsonObject {
  const callerProvenance = isRecord(input.provenance)
    ? cleanJsonObject(input.provenance)
    : {};

  return cleanJsonObject({
    ...callerProvenance,
    sourceService: 'language-intelligence-service',
    sourceEntityType: 'document',
    sourceDocumentId: input.document.id,
    sourceDocumentFingerprint: input.document.fingerprint,
    manifestVersion: input.manifestVersion,
    documentType: input.documentType,
    schemaId: input.schemaId,
    schemaVersion: input.schemaVersion,
  });
}

function normalizeDocumentRouteInput(
  input: PublishDocumentRoutesInput
): NormalizedDocumentRouteInput {
  assertDocumentRoutePublicationInput(input);

  const documentType = normalizeRequiredString(input.documentType, 'dynamic document type');
  const schemaId = normalizeRequiredString(input.schemaId, 'document schema ID');
  const schemaVersion = normalizeRequiredString(input.schemaVersion, 'document schema version');
  const manifestVersion = input.manifestVersion == null || String(input.manifestVersion).trim().length === 0
    ? buildDocumentManifestVersion(input.versionNumber)
    : String(input.manifestVersion).trim();

  return {
    document: input.document,
    documentType,
    schemaId,
    schemaVersion,
    rawText: input.rawText,
    structuredOutput: input.structuredOutput,
    qualityScore: normalizeQualityScore(input.qualityScore),
    manifestVersion,
    versionNumber: input.versionNumber,
    processingTimeMs: input.processingTimeMs,
    destinations: input.destinations ?? DOCUMENT_ROUTE_DESTINATIONS,
    classification: buildClassification({
      documentType,
      schemaId,
      schemaVersion,
      classification: input.classification,
    }),
    metadata: isRecord(input.metadata) ? cleanJsonObject(input.metadata) : {},
    artifactRequests: normalizeArtifactRequests(input.artifactRequests),
    provenance: buildProvenance({
      documentType,
      schemaId,
      schemaVersion,
      manifestVersion,
      document: input.document,
      provenance: input.provenance,
    }),
    trainingInstruction:
      input.trainingInstruction
      ?? 'Extract structured document intelligence from the source document according to the attached schema.',
    trainingCategory: input.trainingCategory ?? 'document_extraction',
    trainingOutput: input.trainingOutput ?? input.structuredOutput,
    embeddingModel: input.embeddingModel,
  };
}

function summarizeRoutingResult(result: RoutingResult, publishedAt: string): DocumentRoutePublicationResult {
  const status = result.planned.length > 0
    ? (result.failed.length > 0 ? 'partial' : 'published')
    : (result.failed.length > 0 ? 'failed' : 'skipped');

  return {
    status,
    documentId: result.documentId,
    manifestVersion: String(result.manifestVersion),
    publishedAt,
    planned: result.planned.map((route) => ({
      destination: route.destination,
      streamName: route.streamName,
      routeId: route.payload.routeId,
    })),
    failed: result.failed,
    skipped: result.skipped,
  };
}

export function buildDocumentRoutingMetadata(
  existingMetadata: unknown,
  result: DocumentRoutePublicationResult
): JsonObject {
  const baseMetadata = isRecord(existingMetadata) ? cleanJsonObject(existingMetadata) : {};

  return {
    ...baseMetadata,
    documentRouting: cleanJsonObject({
      status: result.status,
      documentId: result.documentId,
      manifestVersion: result.manifestVersion,
      publishedAt: result.publishedAt,
      planned: result.planned,
      failed: result.failed,
      skipped: result.skipped,
    }),
  };
}

export function buildDocumentRoutingFailureMetadata(input: {
  existingMetadata: unknown;
  documentId: string;
  manifestVersion: string;
  error: string;
}): JsonObject {
  const baseMetadata = isRecord(input.existingMetadata)
    ? cleanJsonObject(input.existingMetadata)
    : {};

  return {
    ...baseMetadata,
    documentRouting: cleanJsonObject({
      status: 'failed',
      documentId: input.documentId,
      manifestVersion: input.manifestVersion,
      attemptedAt: new Date().toISOString(),
      error: input.error,
    }),
  };
}

export class DocumentRoutePublicationService {
  private readonly router: DocumentProducerRouter;

  constructor(publish: DocumentRoutePublish = publishDocumentRoute) {
    this.router = new DocumentProducerRouter(publish);
  }

  getDocumentManifestVersion(versionNumber?: number | string | null): string {
    return buildDocumentManifestVersion(versionNumber);
  }

  buildDocumentPlanningInput(input: PublishDocumentRoutesInput): DocumentRoutePlanningInput {
    const normalized = normalizeDocumentRouteInput(input);
    const rawText = limitText(normalized.rawText, DOCUMENT_ROUTE_TEXT_CHAR_LIMIT);
    const trainingOutput = limitText(
      stringifyTrainingOutput(normalized.trainingOutput),
      DOCUMENT_ROUTE_TRAINING_OUTPUT_CHAR_LIMIT
    );
    const storage = buildStorageReference(normalized.document);

    return {
      manifest: {
        documentId: normalized.document.id,
        manifestVersion: normalized.manifestVersion,
        destinations: normalized.destinations,
        qualityScore: normalized.qualityScore,
        documentType: normalized.documentType,
        schemaId: normalized.schemaId,
        schemaVersion: normalized.schemaVersion,
        classification: normalized.classification,
        structuredOutput: normalized.structuredOutput === undefined
          ? undefined
          : asJsonValue(normalized.structuredOutput),
        trainingPayload: buildTrainingPayload({
          instruction: normalized.trainingInstruction,
          rawText,
          output: trainingOutput,
          category: normalized.trainingCategory,
          qualityScore: normalized.qualityScore,
        }),
        artifactRequests: normalized.artifactRequests,
        embeddingModel: normalized.embeddingModel,
        correlationId: buildCorrelationId(
          normalized.document.id,
          normalized.manifestVersion
        ),
        fingerprint: normalized.document.fingerprint ?? undefined,
        provenance: normalized.provenance,
      },
      document: {
        documentId: normalized.document.id,
        title: normalized.document.title ?? undefined,
        sourceType: normalized.documentType,
        documentType: normalized.documentType,
        schemaId: normalized.schemaId,
        schemaVersion: normalized.schemaVersion,
        mimeType: normalizeMimeType(normalized.document.contentType),
        fingerprint: normalized.document.fingerprint ?? undefined,
        storage,
        metadata: cleanJsonObject({
          ...(isRecord(normalized.document.metadata)
            ? cleanJsonObject(normalized.document.metadata)
            : {}),
          documentType: normalized.documentType,
          schemaId: normalized.schemaId,
          schemaVersion: normalized.schemaVersion,
          userId: normalized.document.userId,
          organizationId: normalized.document.organizationId,
        }),
      },
      chunks: buildChunks(normalized.document.id, rawText),
      storageReferences: [storage],
      metadata: buildBaseMetadata({
        documentType: normalized.documentType,
        schemaId: normalized.schemaId,
        schemaVersion: normalized.schemaVersion,
        document: normalized.document,
        versionNumber: normalized.versionNumber,
        processingTimeMs: normalized.processingTimeMs,
        rawText,
        trainingOutput,
        metadata: normalized.metadata,
      }),
    };
  }

  async publishDocumentRoutes(input: PublishDocumentRoutesInput): Promise<DocumentRoutePublicationResult> {
    const result = await this.router.route(this.buildDocumentPlanningInput(input));
    const summary = summarizeRoutingResult(result, new Date().toISOString());

    logger.info('Published document routing streams', {
      documentId: input.document.id,
      documentType: input.documentType,
      schemaId: input.schemaId,
      schemaVersion: input.schemaVersion,
      manifestVersion: summary.manifestVersion,
      planned: summary.planned.map((route) => route.streamName),
      failed: summary.failed,
      skipped: summary.skipped,
    });

    return summary;
  }
}

export const documentRoutePublicationService = new DocumentRoutePublicationService();
