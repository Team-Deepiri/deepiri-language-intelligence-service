import { createHash } from 'crypto';
import { prisma } from '../db';
import { cyrexClient } from './cyrexClient';
import { documentService } from './documentService';
import { obligationService } from './obligationService';
import { eventPublisher } from '../streaming/eventPublisher';
import {
  documentRoutePublicationService,
  buildDocumentRoutingMetadata,
  buildDocumentRoutingFailureMetadata,
} from './documentRoutePublicationService';
import { logger } from '@team-deepiri/shared-utils';
import { resolveAbstractPipeline } from './intelligenceProfileResolver';
import type { IntelligenceDocument, IntelligenceDocumentVersion, Prisma } from '@prisma/client';

export interface CreateIntelligenceDocumentInput {
  documentKey: string;
  documentKind: string;
  intelligenceProfile: string;
  profileHints?: Record<string, unknown> | null;
  documentUrl: string;
  documentStorageKey?: string;
  fileSize?: number;
  documentType?: string;
  userId?: string;
  organizationId?: string;
  tags?: string[];
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface IntelligenceDocumentScope {
  userId?: string;
  organizationId?: string;
}

export class IntelligenceDocumentService {
  async create(input: CreateIntelligenceDocumentInput): Promise<IntelligenceDocument> {
    const row = await prisma.intelligenceDocument.create({
      data: {
        documentKey: input.documentKey,
        documentKind: input.documentKind,
        intelligenceProfile: input.intelligenceProfile,
        profileHints: input.profileHints === undefined ? undefined : (input.profileHints as Prisma.InputJsonValue),
        documentUrl: input.documentUrl,
        documentStorageKey: input.documentStorageKey,
        fileSize: input.fileSize,
        documentType: input.documentType || 'PDF',
        userId: input.userId,
        organizationId: input.organizationId,
        tags: input.tags || [],
        notes: input.notes,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });

    logger.info('Intelligence document created', { id: row.id, documentKey: row.documentKey });
    await eventPublisher.publishDocumentCreated(row.id, row.documentKey, {
      documentKind: row.documentKind,
      intelligenceProfile: row.intelligenceProfile,
    });

    return row;
  }

  private scopedWhere(id: string, scope?: IntelligenceDocumentScope): Prisma.IntelligenceDocumentWhereInput {
    return {
      id,
      ...(scope?.userId ? { userId: scope.userId } : {}),
      ...(scope?.organizationId ? { organizationId: scope.organizationId } : {}),
    };
  }

  async getById(id: string, scope?: IntelligenceDocumentScope): Promise<IntelligenceDocument | null> {
    return prisma.intelligenceDocument.findFirst({ where: this.scopedWhere(id, scope) });
  }

  async list(filters: {
    userId?: string;
    organizationId?: string;
    documentKind?: string;
    status?: string;
  }): Promise<IntelligenceDocument[]> {
    const where: Prisma.IntelligenceDocumentWhereInput = {};
    if (filters.userId) where.userId = filters.userId;
    if (filters.organizationId) where.organizationId = filters.organizationId;
    if (filters.documentKind) where.documentKind = filters.documentKind;
    if (filters.status) where.status = filters.status as any;
    return prisma.intelligenceDocument.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  async processDocument(
    documentId: string,
    correlationId?: string,
    scope?: IntelligenceDocumentScope
  ): Promise<IntelligenceDocument> {
    const startTime = Date.now();
    const doc = await prisma.intelligenceDocument.findFirst({
      where: this.scopedWhere(documentId, scope),
    });
    if (!doc) throw new Error('Document not found');

    const pipeline = resolveAbstractPipeline(
      doc.intelligenceProfile,
      (doc.profileHints as Record<string, unknown> | null) ?? null,
      doc.documentKind
    );

    await prisma.intelligenceDocument.update({
      where: { id: documentId },
      data: { status: 'PROCESSING', processingStatus: 'PROCESSING' },
    });

    try {
      const extractedText = await documentService.extractText(doc.documentUrl);
      if (!extractedText.trim()) {
        throw new Error('Text extraction returned empty content');
      }

      const textFingerprint = `sha256:${createHash('sha256').update(extractedText).digest('hex')}`;

      const existingVersions = await prisma.intelligenceDocumentVersion.findMany({
        where: { intelligenceDocumentId: documentId },
        orderBy: { versionNumber: 'desc' },
        take: 1,
      });
      const versionNumber =
        existingVersions.length > 0 ? existingVersions[0].versionNumber + 1 : 1;

      const abstractionResult = await cyrexClient.runAbstractPipeline(pipeline, {
        documentId,
        documentText: extractedText,
        documentUrl: doc.documentUrl,
        documentKey: doc.documentKey,
        versionNumber,
      });

      const data = abstractionResult.data || abstractionResult;
      const extractedTerms = (data.abstractedTerms && typeof data.abstractedTerms === 'object'
        ? data.abstractedTerms
        : {}) as Record<string, unknown>;
      const confidence = data.confidence ?? 0;
      const at = extractedTerms;

      const financialTerms = data.financialTerms ?? at.financialTerms;
      const keyDates = data.keyDates ?? at.keyDates;
      const extractedSupplement =
        data.extractedSupplement ?? at.supplement ?? at.details;
      const structuredSegments =
        data.structuredSegments ?? at.segments ?? at.highlights;
      const terminationDetails =
        data.terminationDetails ?? at.termination ?? data.termination;
      const renewalDetails = data.renewalDetails ?? at.renewal ?? data.renewal;

      const updated = await prisma.intelligenceDocument.update({
        where: { id: documentId },
        data: {
          status: 'COMPLETED',
          processingStatus: 'COMPLETED',
          rawText: extractedText,
          abstractedTerms: extractedTerms as Prisma.InputJsonValue,
          financialTerms: financialTerms ?? at.financialTerms,
          keyDates: keyDates ?? at.keyDates,
          extractedSupplement: extractedSupplement ?? undefined,
          structuredSegments: structuredSegments ?? undefined,
          terminationDetails: terminationDetails ?? undefined,
          renewalDetails: renewalDetails ?? undefined,
          extractionConfidence: confidence,
          processedAt: new Date(),
          processingTimeMs: Date.now() - startTime,
        },
      });

      const version = await prisma.intelligenceDocumentVersion.create({
        data: {
          intelligenceDocumentId: documentId,
          versionNumber,
          documentUrl: doc.documentUrl,
          rawText: extractedText,
          abstractedTerms: extractedTerms as Prisma.InputJsonValue,
          processedAt: new Date(),
          processingTimeMs: Date.now() - startTime,
        },
      });

      await eventPublisher.publishDocumentVersionCreated(
        documentId,
        version.id,
        version.versionNumber
      );

      const obligationsRaw = data.obligations ?? at.obligations;
      const obligations = Array.isArray(obligationsRaw) ? obligationsRaw : [];
      if (obligations.length > 0) {
        await obligationService.createObligationsFromIntelligenceDocument(documentId, obligations);
      }

      await eventPublisher.publishDocumentProcessed(documentId, {
        processingTimeMs: Date.now() - startTime,
        confidence,
        documentKind: updated.documentKind,
        intelligenceProfile: updated.intelligenceProfile,
      });

      await eventPublisher.publishDocumentIngestionRecord(
        {
          schemaVersion: 1,
          documentId,
          organizationId: updated.organizationId,
          documentKind: updated.documentKind,
          intelligenceProfile: updated.intelligenceProfile,
          processingStatus: updated.processingStatus || 'COMPLETED',
          textFingerprint,
          chunkCount: 0,
          labels: { tags: updated.tags },
          artifactsRef: {
            storageKey: updated.documentStorageKey,
            documentUrl: updated.documentUrl,
          },
          correlationId,
          occurredAt: new Date().toISOString(),
        },
        correlationId
      );

      // Document bus cohesion: publish document.* routes via Sugar Glider (ModelKit topics).
      // Platform lifecycle events above stay on platform-events; this fans out the LIS docs bus.
      const schemaId = `intelligence.${updated.intelligenceProfile || updated.documentKind || 'document'}`;
      const schemaVersion = '1';
      const manifestVersion = documentRoutePublicationService.getDocumentManifestVersion(
        version.versionNumber
      );
      try {
        const routing = await documentRoutePublicationService.publishDocumentRoutes({
          document: {
            id: updated.id,
            title: updated.documentKey,
            documentUrl: updated.documentUrl,
            documentStorageKey: updated.documentStorageKey,
            contentType: updated.documentType,
            fileSize: updated.fileSize,
            userId: updated.userId,
            organizationId: updated.organizationId,
            fingerprint: textFingerprint,
            metadata: (updated.metadata as Record<string, unknown>) ?? {},
          },
          documentType: updated.documentKind || 'document',
          schemaId,
          schemaVersion,
          rawText: extractedText,
          structuredOutput: {
            abstractedTerms: extractedTerms,
            financialTerms,
            keyDates,
            structuredSegments,
            intelligenceProfile: updated.intelligenceProfile,
          },
          qualityScore: typeof confidence === 'number' ? confidence : Number(confidence) || 0,
          versionNumber: version.versionNumber,
          manifestVersion,
          processingTimeMs: Date.now() - startTime,
          destinations: ['vectorize', 'structured', 'training', 'artifacts'],
          metadata: {
            intelligenceProfile: updated.intelligenceProfile,
            documentKind: updated.documentKind,
            correlationId,
          },
        });

        await prisma.intelligenceDocument.update({
          where: { id: documentId },
          data: {
            metadata: buildDocumentRoutingMetadata(updated.metadata, routing) as Prisma.InputJsonValue,
          },
        });
      } catch (routeErr: any) {
        logger.warn('Document.* route publication failed (ingestion still completed)', {
          documentId,
          error: routeErr?.message || String(routeErr),
        });
        await prisma.intelligenceDocument.update({
          where: { id: documentId },
          data: {
            metadata: buildDocumentRoutingFailureMetadata({
              existingMetadata: updated.metadata,
              documentId,
              manifestVersion,
              error: routeErr?.message || String(routeErr),
            }) as Prisma.InputJsonValue,
          },
        }).catch(() => undefined);
      }

      return updated;
    } catch (error: any) {
      await prisma.intelligenceDocument.update({
        where: { id: documentId },
        data: {
          status: 'ERROR',
          processingStatus: 'ERROR',
          processingError: error.message,
        },
      });
      await eventPublisher.publishDocumentProcessingError(documentId, error.message);
      throw error;
    }
  }

  async processDocumentAsync(
    documentId: string,
    correlationId?: string,
    scope?: IntelligenceDocumentScope
  ): Promise<void> {
    setImmediate(async () => {
      try {
        await this.processDocument(documentId, correlationId, scope);
      } catch (error: any) {
        logger.error('Intelligence document async processing failed', {
          documentId,
          error: error.message,
        });
      }
    });
  }

  async getVersions(
    intelligenceDocumentId: string,
    scope?: IntelligenceDocumentScope
  ): Promise<IntelligenceDocumentVersion[]> {
    const document = await this.getById(intelligenceDocumentId, scope);
    if (!document) return [];

    return prisma.intelligenceDocumentVersion.findMany({
      where: { intelligenceDocumentId },
      orderBy: { versionNumber: 'desc' },
    });
  }
}

export const intelligenceDocumentService = new IntelligenceDocumentService();
