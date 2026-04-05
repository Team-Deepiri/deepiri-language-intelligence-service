import { createHash } from 'crypto';
import { prisma } from '../db';
import { cyrexClient } from './cyrexClient';
import { documentService } from './documentService';
import { obligationService } from './obligationService';
import { eventPublisher } from '../streaming/eventPublisher';
import { logger } from '@deepiri/shared-utils';
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

  async getById(id: string): Promise<IntelligenceDocument | null> {
    return prisma.intelligenceDocument.findUnique({ where: { id } });
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

  async processDocument(documentId: string, correlationId?: string): Promise<IntelligenceDocument> {
    const startTime = Date.now();
    const doc = await prisma.intelligenceDocument.findUnique({ where: { id: documentId } });
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

      await prisma.intelligenceDocumentVersion.create({
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

      const obligationsRaw = data.obligations ?? at.obligations;
      const obligations = Array.isArray(obligationsRaw) ? obligationsRaw : [];
      if (obligations.length > 0) {
        await obligationService.createObligationsFromAbstraction(documentId, obligations);
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

  async processDocumentAsync(documentId: string, correlationId?: string): Promise<void> {
    setImmediate(async () => {
      try {
        await this.processDocument(documentId, correlationId);
      } catch (error: any) {
        logger.error('Intelligence document async processing failed', {
          documentId,
          error: error.message,
        });
      }
    });
  }

  async getVersions(intelligenceDocumentId: string): Promise<IntelligenceDocumentVersion[]> {
    return prisma.intelligenceDocumentVersion.findMany({
      where: { intelligenceDocumentId },
      orderBy: { versionNumber: 'desc' },
    });
  }
}

export const intelligenceDocumentService = new IntelligenceDocumentService();
