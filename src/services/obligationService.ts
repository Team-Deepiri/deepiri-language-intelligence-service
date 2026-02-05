import { prisma } from '../db';
import { secureLog } from '@deepiri/shared-utils';
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
        secureLog('error', 'Failed to create obligation', {
          leaseId,
          contractId,
          error: error.message,
          obligation: obl,
        });
      }
    }

    secureLog('info', 'Obligations created', {
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
}

export const obligationService = new ObligationService();

