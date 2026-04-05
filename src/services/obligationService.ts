import { prisma } from '../db';
import { logger } from '../utils/logger';
import type { Obligation, Prisma } from '@prisma/client';

export interface CreateObligationInput {
  intelligenceDocumentId?: string;
  description: string;
  obligationType: string;
  party?: string;
  deadline?: Date;
  startDate?: Date;
  endDate?: Date;
  frequency?: string;
  amount?: number;
  currency?: string;
  sourceSnippet?: string;
  confidence?: number;
  tags?: string[];
  notes?: string;
}

export interface ObligationFilters {
  intelligenceDocumentId?: string;
  status?: string;
  obligationType?: string;
  overdue?: boolean;
  owner?: string;
}

export class ObligationService {
  async createObligationsFromAbstraction(
    intelligenceDocumentId: string,
    obligations: any[]
  ): Promise<Obligation[]> {
    const createdObligations: Obligation[] = [];

    for (const obl of obligations) {
      try {
        const obligation = await prisma.obligation.create({
          data: {
            intelligenceDocumentId,
            description: obl.description || '',
            obligationType: this._mapObligationType(obl.obligationType || obl.type) as any,
            party: this._mapParty(obl.party),
            deadline: obl.deadline ? new Date(obl.deadline) : null,
            startDate: obl.startDate ? new Date(obl.startDate) : null,
            endDate: obl.endDate ? new Date(obl.endDate) : null,
            frequency: obl.frequency || obl.recurrencePattern || null,
            amount: obl.amount ? parseFloat(obl.amount.toString()) : null,
            currency: obl.currency || 'USD',
            sourceSnippet: obl.sourceSnippet || obl.source || null,
            confidence: obl.confidence || null,
            status: 'PENDING',
            tags: obl.tags || [],
            notes: obl.notes || null,
          },
        });

        createdObligations.push(obligation);
      } catch (error: any) {
        logger.error('Failed to create obligation', {
          intelligenceDocumentId,
          error: error.message,
          obligation: obl,
        });
      }
    }

    logger.info('Obligations created', {
      intelligenceDocumentId,
      count: createdObligations.length,
    });

    return createdObligations;
  }

  async getObligationsByIntelligenceDocumentId(intelligenceDocumentId: string): Promise<Obligation[]> {
    return prisma.obligation.findMany({
      where: { intelligenceDocumentId },
      orderBy: { deadline: 'asc' },
    });
  }

  async createObligation(data: CreateObligationInput): Promise<Obligation> {
    return prisma.obligation.create({
      data: {
        intelligenceDocumentId: data.intelligenceDocumentId || null,
        description: data.description,
        obligationType: this._mapObligationType(data.obligationType) as any,
        party: this._mapParty(data.party || ''),
        deadline: data.deadline || null,
        startDate: data.startDate || null,
        endDate: data.endDate || null,
        frequency: data.frequency || null,
        amount: data.amount || null,
        currency: data.currency || 'USD',
        sourceSnippet: data.sourceSnippet || null,
        confidence: data.confidence || null,
        status: 'PENDING',
        tags: data.tags || [],
        notes: data.notes || null,
      },
    });
  }

  async getObligation(id: string): Promise<Obligation> {
    const obligation = await prisma.obligation.findUnique({
      where: { id },
    });
    if (!obligation) {
      throw new Error('Obligation not found');
    }
    return obligation;
  }

  async updateObligation(
    id: string,
    data: Partial<CreateObligationInput> & {
      status?: string;
      completedAt?: Date;
      owner?: string;
      ownerEmail?: string;
    }
  ): Promise<Obligation> {
    const updateData: any = { ...data };
    if (updateData.obligationType) {
      updateData.obligationType = this._mapObligationType(updateData.obligationType);
    }
    if (updateData.party) {
      updateData.party = this._mapParty(updateData.party);
    }
    return prisma.obligation.update({
      where: { id },
      data: updateData,
    });
  }

  async deleteObligation(id: string): Promise<Obligation> {
    return prisma.obligation.delete({
      where: { id },
    });
  }

  async listDependencies(id: string, direction: 'source' | 'target' | 'both'): Promise<any[]> {
    const where: any = {};
    if (direction === 'source') {
      where.targetObligationId = id;
    } else if (direction === 'target') {
      where.sourceObligationId = id;
    } else {
      where.OR = [{ sourceObligationId: id }, { targetObligationId: id }];
    }
    return prisma.obligationDependency.findMany({
      where,
    });
  }

  async createDependency(data: {
    sourceObligationId: string;
    targetObligationId: string;
    dependencyType?: string;
    description?: string;
    confidence?: number;
    sourceSnippet?: string;
    targetSnippet?: string;
    triggerCondition?: string;
    discoveredBy?: string;
  }): Promise<any> {
    return prisma.obligationDependency.create({
      data: {
        sourceObligationId: data.sourceObligationId,
        targetObligationId: data.targetObligationId,
        dependencyType: (data.dependencyType as any) || 'TRIGGERS',
        description: data.description,
        confidence: data.confidence,
        sourceSnippet: data.sourceSnippet,
        targetSnippet: data.targetSnippet,
        triggerCondition: data.triggerCondition,
        discoveredBy: data.discoveredBy,
      },
    });
  }

  async deleteDependency(sourceId: string, targetId: string): Promise<any> {
    return prisma.obligationDependency.deleteMany({
      where: {
        sourceObligationId: sourceId,
        targetObligationId: targetId,
      },
    });
  }

  async listObligations(filters: ObligationFilters): Promise<Obligation[]> {
    const where: Prisma.ObligationWhereInput = {};

    if (filters.intelligenceDocumentId) where.intelligenceDocumentId = filters.intelligenceDocumentId;
    if (filters.status) where.status = filters.status as any;
    if (filters.obligationType) where.obligationType = filters.obligationType as any;
    if (filters.owner) where.owner = { contains: filters.owner, mode: 'insensitive' };

    if (filters.overdue) {
      where.deadline = { lt: new Date() };
      where.status = { not: 'COMPLETED' };
    }

    return prisma.obligation.findMany({
      where,
      orderBy: { deadline: 'asc' },
    });
  }

  async updateObligationStatus(
    obligationId: string,
    status: string,
    completedAt?: Date
  ): Promise<Obligation> {
    return prisma.obligation.update({
      where: { id: obligationId },
      data: {
        status: status as any,
        completedAt: completedAt || (status === 'COMPLETED' ? new Date() : null),
      },
    });
  }

  async assignObligation(
    obligationId: string,
    owner: string,
    ownerEmail?: string
  ): Promise<Obligation> {
    return prisma.obligation.update({
      where: { id: obligationId },
      data: {
        owner,
        ownerEmail,
        status: 'IN_PROGRESS',
      },
    });
  }

  private _mapObligationType(type: string): string {
    const mapping: Record<string, string> = {
      PAYMENT: 'PAYMENT',
      MAINTENANCE: 'MAINTENANCE',
      NOTIFICATION: 'NOTIFICATION',
      COMPLIANCE: 'COMPLIANCE',
      RENEWAL: 'RENEWAL',
      TERMINATION: 'TERMINATION',
      INSURANCE: 'INSURANCE',
      TAX: 'TAX',
      UTILITY: 'UTILITY',
      REPAIR: 'REPAIR',
      INSPECTION: 'INSPECTION',
      DELIVERY: 'DELIVERY',
      PERFORMANCE: 'PERFORMANCE',
      CONFIDENTIALITY: 'CONFIDENTIALITY',
    };

    return mapping[type?.toUpperCase()] || 'OTHER';
  }

  private _mapParty(party: string): string {
    const mapping: Record<string, string> = {
      PRIMARY: 'PRIMARY',
      SECONDARY: 'SECONDARY',
      BOTH: 'BOTH',
      OWNER: 'OWNER',
      ASSIGNEE: 'ASSIGNEE',
    };

    return mapping[party?.toUpperCase()] || 'PRIMARY';
  }
}

export const obligationService = new ObligationService();
