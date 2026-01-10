import { prisma } from '../db';
import { cyrexClient } from './cyrexClient';
import { logger } from '../utils/logger';
import type { Clause } from '@prisma/client';

export class ClauseEvolutionService {
  /**
   * Get clause evolution between versions
   */
  async getClauseEvolution(
    contractId: string,
    fromVersion?: number,
    toVersion?: number
  ): Promise<any> {
    // Get versions to compare
    const versions = await prisma.contractVersion.findMany({
      where: { contractId },
      orderBy: { versionNumber: 'asc' },
    });
    
    if (versions.length < 2) {
      return {
        message: 'Not enough versions to compare',
        evolution: [],
      };
    }
    
    const from = fromVersion || versions[0].versionNumber;
    const to = toVersion || versions[versions.length - 1].versionNumber;
    
    // Get clauses for both versions
    const fromClauses = await prisma.clause.findMany({
      where: {
        contractId,
        versionNumber: from,
      },
    });
    
    const toClauses = await prisma.clause.findMany({
      where: {
        contractId,
        versionNumber: to,
      },
    });
    
    // Use Cyrex to compare
    const evolution = await cyrexClient.trackClauseEvolution({
      contractId,
      oldVersionClauses: fromClauses.map(c => ({
        clauseType: c.clauseType,
        clauseTitle: c.clauseTitle,
        clauseText: c.clauseText,
      })),
      newVersionClauses: toClauses.map(c => ({
        clauseType: c.clauseType,
        clauseTitle: c.clauseTitle,
        clauseText: c.clauseText,
      })),
      oldVersionNumber: from,
      newVersionNumber: to,
    });
    
    return {
      fromVersion: from,
      toVersion: to,
      evolution: evolution.data,
    };
  }
  
  /**
   * Compare clauses (internal helper)
   */
  async compareClauses(
    oldClauses: any[],
    newClauses: any[]
  ): Promise<any> {
    return cyrexClient.trackClauseEvolution({
      contractId: 'temp',
      oldVersionClauses: oldClauses,
      newVersionClauses: newClauses,
      oldVersionNumber: 1,
      newVersionNumber: 2,
    });
  }
  
  /**
   * Track clause evolution when new version is created
   */
  async trackClauseEvolution(
    contractId: string,
    fromVersionNumber: number,
    toVersionNumber: number
  ): Promise<void> {
    const fromClauses = await prisma.clause.findMany({
      where: {
        contractId,
        versionNumber: fromVersionNumber,
      },
    });
    
    const toClauses = await prisma.clause.findMany({
      where: {
        contractId,
        versionNumber: toVersionNumber,
      },
    });
    
    const evolution = await cyrexClient.trackClauseEvolution({
      contractId,
      oldVersionClauses: fromClauses.map(c => ({
        clauseType: c.clauseType,
        clauseTitle: c.clauseTitle,
        clauseText: c.clauseText,
      })),
      newVersionClauses: toClauses.map(c => ({
        clauseType: c.clauseType,
        clauseTitle: c.clauseTitle,
        clauseText: c.clauseText,
      })),
      oldVersionNumber: fromVersionNumber,
      newVersionNumber: toVersionNumber,
    });
    
    // Update clauses with evolution data
    for (const modifiedClause of evolution.data.modified_clauses || []) {
      const clause = toClauses.find(
        c => c.clauseType === modifiedClause.clause?.clauseType
      );
      
      if (clause) {
        await prisma.clause.update({
          where: { id: clause.id },
          data: {
            changes: modifiedClause,
            changeType: 'MODIFIED',
            changeSummary: modifiedClause.impact,
            significantChange: modifiedClause.significance === 'HIGH',
          },
        });
      }
    }
  }
}

export const clauseEvolutionService = new ClauseEvolutionService();

