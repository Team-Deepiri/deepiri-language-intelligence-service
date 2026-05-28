import { prisma } from '../db';
import { logger } from '../utils/logger';
import type { Obligation, Prisma } from '@prisma/client';

export interface CreateObligationInput {
  leaseId?: string;
  contractId?: string;
  description: string;
  obligationType: string;
  party?: string;
  deadline?: Date;
  startDate?: Date;
  endDate?: Date;
  frequency?: string;
  amount?: number;
  currency?: string;
  sourceClause?: string;
  confidence?: number;
  tags?: string[];
  notes?: string;
}

export interface ObligationFilters {
  leaseId?: string;
  contractId?: string;
  status?: string;
  obligationType?: string;
  overdue?: boolean;
  owner?: string;
}

export class ObligationService {
  /**
   * Create obligation from abstraction result
   */
  async createObligationsFromAbstraction(
    leaseId: string | null,
    contractId: string | null,
    obligations: any[],
    sourceType: 'lease' | 'contract' = 'lease'
  ): Promise<Obligation[]> {
    const createdObligations: Obligation[] = [];

    for (const obl of obligations) {
      try {
        const obligation = await prisma.obligation.create({
          data: {
            leaseId: sourceType === 'lease' ? leaseId : null,
            contractId: sourceType === 'contract' ? contractId : null,
            description: obl.description || '',
            obligationType: this._mapObligationType(obl.obligationType || obl.type) as any,
            party: this._mapParty(obl.party),
            deadline: obl.deadline ? new Date(obl.deadline) : null,
            startDate: obl.startDate ? new Date(obl.startDate) : null,
            endDate: obl.endDate ? new Date(obl.endDate) : null,
            frequency: obl.frequency || obl.recurrencePattern || null,
            amount: obl.amount ? parseFloat(obl.amount.toString()) : null,
            currency: obl.currency || 'USD',
            sourceClause: obl.sourceClause || obl.source || null,
            confidence: obl.confidence || null,
            status: 'PENDING',
            tags: obl.tags || [],
            notes: obl.notes || null,
          },
        });

        createdObligations.push(obligation);
      } catch (error: any) {
        logger.error('Failed to create obligation', {
          leaseId,
          contractId,
          error: error.message,
          obligation: obl,
        });
      }
    }

    logger.info('Obligations created', {
      leaseId,
      contractId,
      count: createdObligations.length,
    });

    return createdObligations;
  }

  /**
   * Get obligations by lease ID
   */
  async getObligationsByLeaseId(leaseId: string): Promise<Obligation[]> {
    return prisma.obligation.findMany({
      where: { leaseId },
      orderBy: { deadline: 'asc' },
    });
  }

  /**
   * Get obligations by contract ID
   */
  async getObligationsByContractId(contractId: string): Promise<Obligation[]> {
    return prisma.obligation.findMany({
      where: { contractId },
      orderBy: { deadline: 'asc' },
    });
  }

  /**
   * List obligations with filters
   */
  async listObligations(filters: ObligationFilters): Promise<Obligation[]> {
    const where: Prisma.ObligationWhereInput = {};

    if (filters.leaseId) where.leaseId = filters.leaseId;
    if (filters.contractId) where.contractId = filters.contractId;
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

  /**
   * Update obligation status
   */
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

  /**
   * Assign obligation to owner
   */
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

  async createObligation(input: CreateObligationInput): Promise<Obligation> {
    return prisma.obligation.create({
      data: {
        leaseId: input.leaseId ?? null,
        contractId: input.contractId ?? null,
        description: input.description,
        obligationType: this._mapObligationType(input.obligationType) as any,
        party: this._mapParty(input.party ?? ''),
        deadline: input.deadline ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        frequency: input.frequency ?? null,
        amount: input.amount ?? null,
        currency: input.currency ?? 'USD',
        sourceClause: input.sourceClause ?? null,
        confidence: input.confidence ?? null,
        tags: input.tags ?? [],
        notes: input.notes ?? null,
      },
    });
  }

  async getObligation(id: string): Promise<Obligation> {
    const obligation = await prisma.obligation.findUnique({ where: { id } });
    if (!obligation) throw new Error('Obligation not found');
    return obligation;
  }

  async updateObligation(id: string, data: Partial<CreateObligationInput & {
    status?: string;
    completedAt?: Date;
    owner?: string;
    ownerEmail?: string;
  }>): Promise<Obligation> {
    return prisma.obligation.update({
      where: { id },
      data: {
        ...(data.leaseId !== undefined && { leaseId: data.leaseId }),
        ...(data.contractId !== undefined && { contractId: data.contractId }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.obligationType !== undefined && { obligationType: this._mapObligationType(data.obligationType) as any }),
        ...(data.party !== undefined && { party: this._mapParty(data.party) }),
        ...(data.deadline !== undefined && { deadline: data.deadline }),
        ...(data.startDate !== undefined && { startDate: data.startDate }),
        ...(data.endDate !== undefined && { endDate: data.endDate }),
        ...(data.frequency !== undefined && { frequency: data.frequency }),
        ...(data.amount !== undefined && { amount: data.amount }),
        ...(data.currency !== undefined && { currency: data.currency }),
        ...(data.sourceClause !== undefined && { sourceClause: data.sourceClause }),
        ...(data.confidence !== undefined && { confidence: data.confidence }),
        ...(data.tags !== undefined && { tags: data.tags }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.status !== undefined && { status: data.status as any }),
        ...(data.completedAt !== undefined && { completedAt: data.completedAt }),
        ...(data.owner !== undefined && { owner: data.owner }),
        ...(data.ownerEmail !== undefined && { ownerEmail: data.ownerEmail }),
      },
    });
  }

  async deleteObligation(id: string): Promise<Obligation> {
    return prisma.obligation.delete({ where: { id } });
  }

  async listDependencies(obligationId: string, direction: 'source' | 'target' | 'both' = 'both') {
    const where: any = {};
    if (direction === 'source') where.sourceObligationId = obligationId;
    else if (direction === 'target') where.targetObligationId = obligationId;
    else where.OR = [{ sourceObligationId: obligationId }, { targetObligationId: obligationId }];
    return prisma.obligationDependency.findMany({ where });
  }

  async createDependency(input: {
    sourceObligationId: string;
    targetObligationId: string;
    dependencyType?: string;
    description?: string;
    confidence?: number;
    sourceClause?: string;
    targetClause?: string;
    triggerCondition?: string;
    sourceContractId?: string;
    targetContractId?: string;
    sourceLeaseId?: string;
    targetLeaseId?: string;
    discoveredBy?: string;
  }) {
    return prisma.obligationDependency.create({
      data: {
        sourceObligationId: input.sourceObligationId,
        targetObligationId: input.targetObligationId,
        dependencyType: (input.dependencyType ?? 'REQUIRES') as any,
        description: input.description ?? null,
        confidence: input.confidence ?? null,
        sourceClause: input.sourceClause ?? null,
        targetClause: input.targetClause ?? null,
        triggerCondition: input.triggerCondition ?? null,
        sourceContractId: input.sourceContractId ?? null,
        targetContractId: input.targetContractId ?? null,
        sourceLeaseId: input.sourceLeaseId ?? null,
        targetLeaseId: input.targetLeaseId ?? null,
        discoveredBy: input.discoveredBy ?? null,
      },
    });
  }

  async deleteDependency(sourceObligationId: string, targetObligationId: string) {
    return prisma.obligationDependency.delete({
      where: { sourceObligationId_targetObligationId: { sourceObligationId, targetObligationId } },
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
      TENANT: 'TENANT',
      LANDLORD: 'LANDLORD',
      BOTH: 'BOTH',
      PARTY_A: 'PARTY_A',
      PARTY_B: 'PARTY_B',
    };

    return mapping[party?.toUpperCase()] || 'TENANT';
  }
}

export const obligationService = new ObligationService();

