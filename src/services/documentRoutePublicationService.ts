import {
  DocumentProducerRouter,
  type DocumentRoutePublish,
} from '../documentRouting/documentProducerRouter';
import type {
  ChunkReference,
  DocumentRouteDestination,
  DocumentRoutePlanningInput,
  EmbeddedTrainingPayload,
  JsonObject,
  JsonValue,
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

type DocumentEntityType = 'lease' | 'contract';

interface RouteableDocument {
  id: string;
  documentUrl: string;
  documentStorageKey?: string | null;
  documentType?: string | null;
  fileSize?: number | null;
  userId?: string | null;
  organizationId?: string | null;
}

export interface LeaseRoutingDocument extends RouteableDocument {
  leaseNumber: string;
  tenantName: string;
  landlordName?: string | null;
  propertyAddress: string;
  propertyType?: string | null;
  extractionConfidence?: number | null;
}

export interface ContractRoutingDocument extends RouteableDocument {
  contractNumber: string;
  contractName: string;
  partyA: string;
  partyB: string;
  contractType?: string | null;
  jurisdiction?: string | null;
  extractionConfidence?: number | null;
}

export interface PublishLeaseRoutesInput {
  lease: LeaseRoutingDocument;
  rawText: string;
  abstractedTerms: unknown;
  qualityScore?: number | null;
  versionNumber: number;
  processingTimeMs: number;
}

export interface PublishContractRoutesInput {
  contract: ContractRoutingDocument;
  rawText: string;
  abstractedTerms: unknown;
  qualityScore?: number | null;
  versionNumber: number;
  processingTimeMs: number;
}

export interface DocumentRoutePublicationSummary {
  destination: DocumentRouteDestination;
  streamName: string;
  routeId: string;
}

export interface DocumentRoutePublicationResult {
  status: 'published' | 'skipped';
  documentId: string;
  manifestVersion: string;
  publishedAt: string;
  planned: DocumentRoutePublicationSummary[];
  skipped: RouteSkipped[];
}

interface LimitedText {
  text: string;
  originalLength: number;
  truncated: boolean;
  limit: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidDocumentId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertLeaseRoutePublicationInput(input: PublishLeaseRoutesInput): void {
  if (!input?.lease || !isValidDocumentId(input.lease.id)) {
    throw new Error('Validation Error: Missing primary document ID for lease.');
  }
}

function assertContractRoutePublicationInput(input: PublishContractRoutesInput): void {
  if (!input?.contract || !isValidDocumentId(input.contract.id)) {
    throw new Error('Validation Error: Missing primary document ID for contract.');
  }
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

function buildManifestVersion(entityType: DocumentEntityType, versionNumber: number): string {
  return `${entityType}:${versionNumber}`;
}

function buildCorrelationId(
  entityType: DocumentEntityType,
  documentId: string,
  manifestVersion: string
): string {
  return `${entityType}:${documentId}:${manifestVersion}`;
}

function buildStorageReference(document: RouteableDocument): StorageReference {
  return {
    provider: 'object-storage',
    key: document.documentStorageKey ?? undefined,
    uri: document.documentUrl,
    contentType: document.documentType ?? undefined,
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
  entityType: DocumentEntityType;
  document: RouteableDocument;
  versionNumber: number;
  processingTimeMs: number;
  rawText: LimitedText;
  trainingOutput: LimitedText;
}): JsonObject {
  return cleanJsonObject({
    source: {
      service: 'language-intelligence-service',
      entityType: input.entityType,
      entityId: input.document.id,
      versionNumber: input.versionNumber,
    },
    document: {
      uri: input.document.documentUrl,
      storageKey: input.document.documentStorageKey,
      documentType: input.document.documentType,
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

function summarizeRoutingResult(result: RoutingResult, publishedAt: string): DocumentRoutePublicationResult {
  return {
    status: result.planned.length > 0 ? 'published' : 'skipped',
    documentId: result.documentId,
    manifestVersion: String(result.manifestVersion),
    publishedAt,
    planned: result.planned.map((route) => ({
      destination: route.destination,
      streamName: route.streamName,
      routeId: route.payload.routeId,
    })),
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

  getLeaseManifestVersion(versionNumber: number): string {
    return buildManifestVersion('lease', versionNumber);
  }

  getContractManifestVersion(versionNumber: number): string {
    return buildManifestVersion('contract', versionNumber);
  }

  buildLeasePlanningInput(input: PublishLeaseRoutesInput): DocumentRoutePlanningInput {
    const qualityScore = normalizeQualityScore(
      input.qualityScore,
      input.lease.extractionConfidence
    );
    const rawText = limitText(input.rawText, DOCUMENT_ROUTE_TEXT_CHAR_LIMIT);
    const trainingOutput = limitText(
      stringifyTrainingOutput(input.abstractedTerms),
      DOCUMENT_ROUTE_TRAINING_OUTPUT_CHAR_LIMIT
    );
    const manifestVersion = this.getLeaseManifestVersion(input.versionNumber);
    const storage = buildStorageReference(input.lease);

    return {
      manifest: {
        documentId: input.lease.id,
        manifestVersion,
        destinations: DOCUMENT_ROUTE_DESTINATIONS,
        qualityScore,
        classification: cleanJsonObject({
          documentKind: 'lease',
          propertyType: input.lease.propertyType,
        }),
        structuredOutput: asJsonValue(input.abstractedTerms),
        trainingPayload: buildTrainingPayload({
          instruction: 'Extract structured lease intelligence from the source document.',
          rawText,
          output: trainingOutput,
          category: 'lease_abstraction',
          qualityScore,
        }),
        correlationId: buildCorrelationId('lease', input.lease.id, manifestVersion),
      },
      document: {
        documentId: input.lease.id,
        title: `Lease ${input.lease.leaseNumber}`,
        sourceType: 'lease',
        mimeType: input.lease.documentType ?? undefined,
        storage,
        metadata: cleanJsonObject({
          leaseNumber: input.lease.leaseNumber,
          tenantName: input.lease.tenantName,
          landlordName: input.lease.landlordName,
          propertyAddress: input.lease.propertyAddress,
          propertyType: input.lease.propertyType,
          userId: input.lease.userId,
          organizationId: input.lease.organizationId,
        }),
      },
      chunks: buildChunks(input.lease.id, rawText),
      storageReferences: [storage],
      metadata: buildBaseMetadata({
        entityType: 'lease',
        document: input.lease,
        versionNumber: input.versionNumber,
        processingTimeMs: input.processingTimeMs,
        rawText,
        trainingOutput,
      }),
    };
  }

  buildContractPlanningInput(input: PublishContractRoutesInput): DocumentRoutePlanningInput {
    const qualityScore = normalizeQualityScore(
      input.qualityScore,
      input.contract.extractionConfidence
    );
    const rawText = limitText(input.rawText, DOCUMENT_ROUTE_TEXT_CHAR_LIMIT);
    const trainingOutput = limitText(
      stringifyTrainingOutput(input.abstractedTerms),
      DOCUMENT_ROUTE_TRAINING_OUTPUT_CHAR_LIMIT
    );
    const manifestVersion = this.getContractManifestVersion(input.versionNumber);
    const storage = buildStorageReference(input.contract);

    return {
      manifest: {
        documentId: input.contract.id,
        manifestVersion,
        destinations: DOCUMENT_ROUTE_DESTINATIONS,
        qualityScore,
        classification: cleanJsonObject({
          documentKind: 'contract',
          contractType: input.contract.contractType,
          jurisdiction: input.contract.jurisdiction,
        }),
        structuredOutput: asJsonValue(input.abstractedTerms),
        trainingPayload: buildTrainingPayload({
          instruction: 'Extract structured contract intelligence from the source document.',
          rawText,
          output: trainingOutput,
          category: 'contract_intelligence',
          qualityScore,
        }),
        correlationId: buildCorrelationId('contract', input.contract.id, manifestVersion),
      },
      document: {
        documentId: input.contract.id,
        title: input.contract.contractName,
        sourceType: 'contract',
        mimeType: input.contract.documentType ?? undefined,
        storage,
        metadata: cleanJsonObject({
          contractNumber: input.contract.contractNumber,
          contractName: input.contract.contractName,
          partyA: input.contract.partyA,
          partyB: input.contract.partyB,
          contractType: input.contract.contractType,
          jurisdiction: input.contract.jurisdiction,
          userId: input.contract.userId,
          organizationId: input.contract.organizationId,
        }),
      },
      chunks: buildChunks(input.contract.id, rawText),
      storageReferences: [storage],
      metadata: buildBaseMetadata({
        entityType: 'contract',
        document: input.contract,
        versionNumber: input.versionNumber,
        processingTimeMs: input.processingTimeMs,
        rawText,
        trainingOutput,
      }),
    };
  }

  async publishLeaseRoutes(input: PublishLeaseRoutesInput): Promise<DocumentRoutePublicationResult> {
    assertLeaseRoutePublicationInput(input);

    const result = await this.router.route(this.buildLeasePlanningInput(input));
    const summary = summarizeRoutingResult(result, new Date().toISOString());

    logger.info('Published lease document routing streams', {
      leaseId: input.lease.id,
      manifestVersion: summary.manifestVersion,
      planned: summary.planned.map((route) => route.streamName),
      skipped: summary.skipped,
    });

    return summary;
  }

  async publishContractRoutes(input: PublishContractRoutesInput): Promise<DocumentRoutePublicationResult> {
    assertContractRoutePublicationInput(input);

    const result = await this.router.route(this.buildContractPlanningInput(input));
    const summary = summarizeRoutingResult(result, new Date().toISOString());

    logger.info('Published contract document routing streams', {
      contractId: input.contract.id,
      manifestVersion: summary.manifestVersion,
      planned: summary.planned.map((route) => route.streamName),
      skipped: summary.skipped,
    });

    return summary;
  }
}

export const documentRoutePublicationService = new DocumentRoutePublicationService();
