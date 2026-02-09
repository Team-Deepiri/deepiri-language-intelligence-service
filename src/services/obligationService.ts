import { prisma } from '../db';
import { logger } from '../utils/logger';
import type { Obligation, Prisma } from '@prisma/client';
import { eventPublisher } from '../streaming/eventPublisher';

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

export interface UpdateObligationInput {
  leaseId?: string | null;
  contractId?: string | null;
  description?: string;
  obligationType?: string;
  party?: string;
  deadline?: Date | null;
  startDate?: Date | null;
  endDate?: Date | null;
  frequency?: string | null;
  amount?: number | null;
  currency?: string | null;
  sourceClause?: string | null;
  confidence?: number | null;
  tags?: string[];
  notes?: string | null;
  status?: string;
  completedAt?: Date | null;
  owner?: string | null;
  ownerEmail?: string | null;
}

export interface ObligationFilters {
  leaseId?: string;
  contractId?: string;
  status?: string;
  obligationType?: string;
  overdue?: boolean;
  owner?: string;
}

export interface CreateDependencyInput {
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

  /**
   * CREATE obligation
   */
  async createObligation(
    input: CreateObligationInput
  ): Promise<Obligation> {
    if (!input.leaseId && !input.contractId) {
      throw new Error('Either leaseId or contractId is required');
    }

    const obligation = await prisma.obligation.create({
      data: {
        leaseId: input.leaseId || null,
        contractId: input.contractId || null,
        description: input.description,
        obligationType: this._mapObligationType(input.obligationType) as any,
        party: this._mapParty(input.party || ''),
        deadline: input.deadline || null,
        startDate: input.startDate || null,
        endDate: input.endDate || null,
        frequency: input.frequency || null,
        amount: input.amount ?? null,
        currency: input.currency || 'USD',
        sourceClause: input.sourceClause || null,
        confidence: input.confidence ?? null,
        status: 'PENDING',
        tags: input.tags || [],
        notes: input.notes || null,
      },
    });

    logger.info('Obligation created', {
      obligationId: obligation.id,
      leaseId: obligation.leaseId,
      contractId: obligation.contractId,
    });

    await eventPublisher.publishObligationCreated(obligation.id, {
      leaseId: obligation.leaseId || undefined,
      contractId: obligation.contractId || undefined,
      status: obligation.status,
      obligationType: obligation.obligationType,
      owner: obligation.owner || undefined,
    });

    return obligation;
  }

  /**
   * UPDATE existing obligation
   */
  async updateObligation(
    obligationId: string,
    input: UpdateObligationInput
  ): Promise<Obligation> {
    const data: Prisma.ObligationUpdateInput = {};

    if ('leaseId' in input) data.leaseId = input.leaseId ?? null;
    if ('contractId' in input) data.contractId = input.contractId ?? null;
    if ('description' in input && input.description !== undefined) data.description = input.description;
    if ('obligationType' in input && input.obligationType !== undefined) {
      data.obligationType = this._mapObligationType(input.obligationType) as any;
    }
    if ('party' in input && input.party !== undefined) {
      data.party = this._mapParty(input.party || '');
    }
    if ('deadline' in input) data.deadline = input.deadline ?? null;
    if ('startDate' in input) data.startDate = input.startDate ?? null;
    if ('endDate' in input) data.endDate = input.endDate ?? null;
    if ('frequency' in input) data.frequency = input.frequency ?? null;
    if ('amount' in input) data.amount = input.amount ?? null;
    if ('currency' in input) data.currency = input.currency ?? null;
    if ('sourceClause' in input) data.sourceClause = input.sourceClause ?? null;
    if ('confidence' in input) data.confidence = input.confidence ?? null;
    if ('tags' in input && input.tags !== undefined) data.tags = input.tags;
    if ('notes' in input) data.notes = input.notes ?? null;
    if ('owner' in input) data.owner = input.owner ?? null;
    if ('ownerEmail' in input) data.ownerEmail = input.ownerEmail ?? null;

    if ('status' in input && input.status !== undefined) {
      data.status = input.status as any;
      if (!('completedAt' in input) && input.status === 'COMPLETED') {
        data.completedAt = new Date();
      }
    }

    if ('completedAt' in input) data.completedAt = input.completedAt ?? null;

    const obligation = await prisma.obligation.update({
      where: { id: obligationId },
      data,
    });

    logger.info('Obligation updated', { obligationId });

    await eventPublisher.publishObligationUpdated(obligation.id, {
      leaseId: obligation.leaseId || undefined,
      contractId: obligation.contractId || undefined,
      status: obligation.status,
      obligationType: obligation.obligationType,
      owner: obligation.owner || undefined,
    });

    return obligation;
  }

  /**
   * GET obligation by id
  */
  async getObligation(
    obligationId: string
  ): Promise<Obligation> {
    const obligation = await prisma.obligation.findUnique({
      where: { id: obligationId },
    });

    if (!obligation) {
      logger.info('Obligation not found', { obligationId });
      throw new Error('Obligation not found');
    }

    return obligation;
  }

  /**
   * DELETE obligation 
   */
  async deleteObligation(
    obligationId: string
  ): Promise<Obligation> {
    const obligation = await prisma.obligation.delete({
      where: { id: obligationId },
    });

    logger.info('Obligation deleted', { obligationId });

    await eventPublisher.publishObligationDeleted(obligation.id, {
      leaseId: obligation.leaseId || undefined,
      contractId: obligation.contractId || undefined,
    });

    return obligation;
  }

  /**
   * List DIRECT dependencies for an obligation
   */
  async listDependencies(
    obligationId: string,
    direction: 'source' | 'target' | 'both' = 'both'
  ): Promise<Prisma.ObligationDependencyGetPayload<{ include: { sourceObligation: true; targetObligation: true } }>[]> {
    const where: Prisma.ObligationDependencyWhereInput =
      direction === 'source'
        ? { sourceObligationId: obligationId }
        : direction === 'target'
          ? { targetObligationId: obligationId }
          : {
            OR: [
              { sourceObligationId: obligationId },
              { targetObligationId: obligationId },
            ],
          };

    return prisma.obligationDependency.findMany({
      where,
      include: {
        sourceObligation: true,
        targetObligation: true,
      },
    });
  }

  /**
   * CREATE dependency link
   */
  async createDependency(input: CreateDependencyInput): Promise<Prisma.ObligationDependencyGetPayload<{}>> {
    const dependency = await prisma.obligationDependency.create({
      data: {
        sourceObligationId: input.sourceObligationId,
        targetObligationId: input.targetObligationId,
        dependencyType: (input.dependencyType || 'TRIGGERS') as any,
        description: input.description,
        confidence: input.confidence ?? null,
        sourceClause: input.sourceClause,
        targetClause: input.targetClause,
        triggerCondition: input.triggerCondition,
        sourceContractId: input.sourceContractId,
        targetContractId: input.targetContractId,
        sourceLeaseId: input.sourceLeaseId,
        targetLeaseId: input.targetLeaseId,
        discoveredBy: input.discoveredBy || 'MANUAL',
      },
    });

    logger.info('Obligation dependency created', {
      sourceObligationId: input.sourceObligationId,
      targetObligationId: input.targetObligationId,
    });

    await eventPublisher.publishDependencyCreated(
      input.sourceObligationId,
      input.targetObligationId,
      {
        dependencyType: (input.dependencyType || 'TRIGGERS'),
        confidence: input.confidence,
      }
    );

    return dependency;
  }

  /**
   * DELETE dependency link
   */
  async deleteDependency(
    sourceObligationId: string,
    targetObligationId: string
  ): Promise<Prisma.ObligationDependencyGetPayload<{}>> {
    const dependency = await prisma.obligationDependency.delete({
      where: {
        sourceObligationId_targetObligationId: {
          sourceObligationId,
          targetObligationId,
        },
      },
    });

    logger.info('Obligation dependency deleted', {
      sourceObligationId,
      targetObligationId,
    });

    await eventPublisher.publishDependencyDeleted(
      sourceObligationId,
      targetObligationId
    );

    return dependency;
  }
}

export const obligationService = new ObligationService();

