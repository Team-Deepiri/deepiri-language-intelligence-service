import { prisma } from '../db';
import { cyrexClient } from './cyrexClient';
import { documentService } from './documentService';
import { obligationService } from './obligationService';
import { eventPublisher } from '../streaming/eventPublisher';
import { secureLog } from '@deepiri/shared-utils';
import type { Lease, LeaseVersion, Prisma } from '@prisma/client';

export interface CreateLeaseInput {
  leaseNumber: string;
  tenantName: string;
  landlordName?: string;
  propertyAddress: string;
  propertyType?: string;
  squareFootage?: number;
  startDate: Date;
  endDate: Date;
  documentUrl: string;
  userId?: string;
  organizationId?: string;
  tags?: string[];
  notes?: string;
}

export class LeaseAbstractionService {
  /**
   * Create lease record
   */
  async createLease(input: CreateLeaseInput): Promise<Lease> {
    const lease = await prisma.lease.create({
      data: {
        leaseNumber: input.leaseNumber,
        tenantName: input.tenantName,
        landlordName: input.landlordName,
        propertyAddress: input.propertyAddress,
        propertyType: input.propertyType,
        squareFootage: input.squareFootage,
        startDate: input.startDate,
        endDate: input.endDate,
        documentUrl: input.documentUrl,
        userId: input.userId,
        organizationId: input.organizationId,
        status: 'PENDING',
        tags: input.tags || [],
        notes: input.notes,
      },
    });

    secureLog('info', 'Lease created', { leaseId: lease.id, leaseNumber: lease.leaseNumber });
    await eventPublisher.publishLeaseCreated(lease.id, lease.leaseNumber);

    return lease;
  }

  /**
   * Process lease document
   */
  async processLease(leaseId: string): Promise<Lease> {
    const startTime = Date.now();

    const lease = await prisma.lease.findUnique({ where: { id: leaseId } });
    if (!lease) throw new Error('Lease not found');

    await prisma.lease.update({
      where: { id: leaseId },
      data: { status: 'PROCESSING', processingStatus: 'PROCESSING' },
    });

    try {
      const extractedText = await documentService.extractText(lease.documentUrl);

      // Call Cyrex for abstraction
      const abstractionResult = await cyrexClient.abstractLease({
        leaseId,
        documentText: extractedText,
        documentUrl: lease.documentUrl,
        leaseNumber: lease.leaseNumber,
        tenantName: lease.tenantName,
        propertyAddress: lease.propertyAddress,
      });

      // Extract data from response (handle both wrapped and unwrapped responses)
      const data = abstractionResult.data || abstractionResult;
      const abstractedTerms = data.abstractedTerms || {};
      
      // Update lease
      const updatedLease = await prisma.lease.update({
        where: { id: leaseId },
        data: {
          status: 'COMPLETED',
          processingStatus: 'COMPLETED',
          rawText: extractedText,
          abstractedTerms,
          financialTerms: data.financialTerms || abstractedTerms.financialTerms,
          keyDates: data.keyDates || abstractedTerms.keyDates,
          propertyDetails: data.propertyDetails || abstractedTerms.propertyDetails,
          keyClauses: data.keyClauses || abstractedTerms.keyClauses,
          extractionConfidence: data.confidence || 0.0,
          processedAt: new Date(),
          processingTimeMs: Date.now() - startTime,
        },
      });

      // Create lease version
      await prisma.leaseVersion.create({
        data: {
          leaseId,
          versionNumber: 1,
          documentUrl: lease.documentUrl,
          rawText: extractedText,
          abstractedTerms,
          processedAt: new Date(),
          processingTimeMs: Date.now() - startTime,
        },
      });

      // Create obligations
      const obligations = data.obligations || abstractedTerms.obligations || [];
      if (obligations.length > 0) {
        await obligationService.createObligationsFromAbstraction(
          leaseId,
          null,
          obligations,
          'lease'
        );
      }

      await eventPublisher.publishLeaseProcessed(leaseId, {
        processingTimeMs: Date.now() - startTime,
        confidence: abstractionResult.data?.confidence || abstractionResult.confidence || 0.0,
      });

      return updatedLease;
    } catch (error: any) {
      await prisma.lease.update({
        where: { id: leaseId },
        data: {
          status: 'ERROR',
          processingStatus: 'ERROR',
          processingError: error.message,
        },
      });

      await eventPublisher.publishLeaseProcessingError(leaseId, error.message);
      throw error;
    }
  }

  /**
   * Process lease asynchronously
   */
  async processLeaseAsync(leaseId: string): Promise<void> {
    setImmediate(async () => {
      try {
        await this.processLease(leaseId);
      } catch (error: any) {
        secureLog('error', 'Error in async lease processing', { leaseId, error: error.message });
      }
    });
  }

  /**
   * Get lease by ID
   */
  async getLeaseById(leaseId: string): Promise<Lease | null> {
    return prisma.lease.findUnique({ where: { id: leaseId } });
  }

  /**
   * List leases
   */
  async listLeases(filters: {
    userId?: string;
    organizationId?: string;
    status?: string;
    tenantName?: string;
  }): Promise<Lease[]> {
    const where: Prisma.LeaseWhereInput = {};

    if (filters.userId) where.userId = filters.userId;
    if (filters.organizationId) where.organizationId = filters.organizationId;
    if (filters.status) where.status = filters.status as any;
    if (filters.tenantName) where.tenantName = { contains: filters.tenantName, mode: 'insensitive' };

    return prisma.lease.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Create lease version
   */
  async createLeaseVersion(
    leaseId: string,
    file: Express.Multer.File,
    versionNumber?: number
  ): Promise<LeaseVersion> {
    const lease = await prisma.lease.findUnique({ where: { id: leaseId } });
    if (!lease) throw new Error('Lease not found');

    // Get current version number
    const currentVersions = await prisma.leaseVersion.findMany({
      where: { leaseId },
      orderBy: { versionNumber: 'desc' },
      take: 1,
    });

    const nextVersionNumber = versionNumber || 
      (currentVersions.length > 0 ? currentVersions[0].versionNumber + 1 : 1);

    // Upload document
    const uploadResult = await documentService.uploadDocument(file, 'lease-versions');
    const extractedText = await documentService.extractText(uploadResult.url);

    // Abstract new version
    const abstractionResult = await cyrexClient.abstractLease({
      leaseId,
      documentText: extractedText,
      documentUrl: uploadResult.url,
      leaseNumber: lease.leaseNumber,
      tenantName: lease.tenantName,
      propertyAddress: lease.propertyAddress,
    });

    const abstractedTerms = abstractionResult.data?.abstractedTerms || abstractionResult.abstractedTerms;

    // Compare with previous version if exists
    let changes = null;
    let changeSummary = null;
    let significantChanges = false;
    
    if (currentVersions.length > 0) {
      const previousVersion = currentVersions[0];
      const comparison = await cyrexClient.compareLeaseVersions(
        previousVersion.abstractedTerms as any,
        abstractedTerms
      );
      changes = comparison.data?.changes || comparison.changes;
      changeSummary = comparison.data?.summary || comparison.summary;
      significantChanges = comparison.data?.significant || false;
    }

    const version = await prisma.leaseVersion.create({
      data: {
        leaseId,
        versionNumber: nextVersionNumber,
        documentUrl: uploadResult.url,
        rawText: extractedText,
        abstractedTerms,
        changes,
        changeSummary,
        significantChanges,
        processedAt: new Date(),
      },
    });

    return version;
  }

  /**
   * Compare lease versions
   */
  async compareVersions(
    leaseId: string,
    versionId: string,
    compareToVersionNumber?: number
  ): Promise<any> {
    const targetVersion = await prisma.leaseVersion.findUnique({
      where: { id: versionId },
    });

    if (!targetVersion) throw new Error('Version not found');

    let compareToVersion: LeaseVersion | null = null;

    if (compareToVersionNumber) {
      compareToVersion = await prisma.leaseVersion.findUnique({
        where: {
          leaseId_versionNumber: {
            leaseId,
            versionNumber: compareToVersionNumber,
          },
        },
      });
    } else {
      const previousVersions = await prisma.leaseVersion.findMany({
        where: {
          leaseId,
          versionNumber: { lt: targetVersion.versionNumber },
        },
        orderBy: { versionNumber: 'desc' },
        take: 1,
      });

      if (previousVersions.length > 0) {
        compareToVersion = previousVersions[0];
      }
    }

    if (!compareToVersion) {
      throw new Error('No version to compare with');
    }

    // Use Cyrex to compare versions
    const comparison = await cyrexClient.compareLeaseVersions(
      compareToVersion.abstractedTerms as any,
      targetVersion.abstractedTerms as any
    );
    
    return {
      fromVersion: {
        id: compareToVersion.id,
        versionNumber: compareToVersion.versionNumber,
        processedAt: compareToVersion.processedAt,
      },
      toVersion: {
        id: targetVersion.id,
        versionNumber: targetVersion.versionNumber,
        processedAt: targetVersion.processedAt,
      },
      changes: comparison.data?.changes || comparison.changes || targetVersion.changes,
      summary: comparison.data?.summary || comparison.summary || targetVersion.changeSummary,
      significant: comparison.data?.significant || false,
    };
  }
}

export const leaseAbstractionService = new LeaseAbstractionService();

