import { prisma } from '../db';
import { cyrexClient } from './cyrexClient';
import { documentService } from './documentService';
import { obligationService } from './obligationService';
import { clauseEvolutionService } from './clauseEvolutionService';
import { eventPublisher } from '../streaming/eventPublisher';
import { secureLog } from '@deepiri/shared-utils';
import type { Contract, Clause, ContractVersion, Prisma } from '@prisma/client';

export interface CreateContractInput {
  contractNumber: string;
  contractName: string;
  partyA: string;
  partyB: string;
  contractType?: string;
  jurisdiction?: string;
  effectiveDate: Date;
  expirationDate?: Date;
  documentUrl: string;
  userId?: string;
  organizationId?: string;
  tags?: string[];
  notes?: string;
}

export class ContractIntelligenceService {
  /**
   * Create contract record
   */
  async createContract(input: CreateContractInput): Promise<Contract> {
    const contract = await prisma.contract.create({
      data: {
        contractNumber: input.contractNumber,
        contractName: input.contractName,
        partyA: input.partyA,
        partyB: input.partyB,
        contractType: input.contractType,
        jurisdiction: input.jurisdiction,
        effectiveDate: input.effectiveDate,
        expirationDate: input.expirationDate,
        documentUrl: input.documentUrl,
        userId: input.userId,
        organizationId: input.organizationId,
        status: 'PENDING',
        tags: input.tags || [],
        notes: input.notes,
      },
    });
    
    secureLog('info', 'Contract created', { contractId: contract.id, contractNumber: contract.contractNumber });
    await eventPublisher.publishContractCreated(contract.id, contract.contractNumber);
    
    return contract;
  }
  
  /**
   * Process contract document
   */
  async processContract(contractId: string): Promise<Contract> {
    const startTime = Date.now();
    
    const contract = await prisma.contract.findUnique({ where: { id: contractId } });
    if (!contract) throw new Error('Contract not found');
    
    await prisma.contract.update({
      where: { id: contractId },
      data: { status: 'PROCESSING', processingStatus: 'PROCESSING' },
    });
    
    try {
      const extractedText = await documentService.extractText(contract.documentUrl);
      
      // Get current version number
      const currentVersions = await prisma.contractVersion.findMany({
        where: { contractId },
        orderBy: { versionNumber: 'desc' },
        take: 1,
      });
      const versionNumber = currentVersions.length > 0 
        ? currentVersions[0].versionNumber + 1 
        : 1;
      
      // Call Cyrex API
      const abstractionResult = await cyrexClient.abstractContract({
        contractId,
        documentText: extractedText,
        documentUrl: contract.documentUrl,
        contractNumber: contract.contractNumber,
        versionNumber,
      });
      
      // Extract data from response (handle both wrapped and unwrapped responses)
      const data = abstractionResult.data || abstractionResult;
      const abstractedTerms = data.abstractedTerms || {};
      
      // Update contract
      const updatedContract = await prisma.contract.update({
        where: { id: contractId },
        data: {
          status: 'COMPLETED',
          processingStatus: 'COMPLETED',
          rawText: extractedText,
          abstractedTerms,
          keyClauses: data.keyClauses || abstractedTerms.keyClauses,
          financialTerms: data.financialTerms || abstractedTerms.financialTerms,
          terminationTerms: data.terminationTerms || abstractedTerms.terminationTerms,
          renewalTerms: data.renewalTerms || abstractedTerms.renewalTerms,
          extractionConfidence: data.confidence || 0.0,
          processedAt: new Date(),
          processingTimeMs: Date.now() - startTime,
        },
      });
      
      // Create contract version
      await prisma.contractVersion.create({
        data: {
          contractId,
          versionNumber,
          documentUrl: contract.documentUrl,
          rawText: extractedText,
          abstractedTerms,
          processedAt: new Date(),
          processingTimeMs: Date.now() - startTime,
        },
      });
      
      // Extract and create clauses
      const keyClauses = data.keyClauses || abstractedTerms.keyClauses || [];
      if (keyClauses.length > 0) {
        await this._createClauses(contractId, keyClauses, versionNumber);
      }
      
      // Extract and create obligations
      const obligations = data.obligations || abstractedTerms.obligations || [];
      if (obligations.length > 0) {
        await obligationService.createObligationsFromAbstraction(
          null,
          contractId,
          obligations,
          'contract'
        );
      }
      
      // Build dependency graph
      if (obligations.length > 0) {
        const graphResult = await this._buildDependencyGraph(contractId, obligations);
        
        await eventPublisher.publishDependencyGraphBuilt(contractId, {
          nodeCount: graphResult?.graph?.nodes || obligations.length,
          edgeCount: graphResult?.graph?.edges || graphResult?.dependencies?.length || 0,
          cascadeRisks: graphResult?.cascade_risks?.length || 0,
        });
      }
      
      await eventPublisher.publishContractProcessed(contractId, {
        processingTimeMs: Date.now() - startTime,
        confidence: data.confidence || 0.0,
      });
      
      return updatedContract;
    } catch (error: any) {
      await prisma.contract.update({
        where: { id: contractId },
        data: {
          status: 'ERROR',
          processingStatus: 'ERROR',
          processingError: error.message,
        },
      });
      await eventPublisher.publishContractProcessingError(contractId, error.message);
      throw error;
    }
  }
  
  /**
   * Create clauses from abstraction result
   */
  private async _createClauses(
    contractId: string,
    clauses: any[],
    versionNumber: number
  ): Promise<void> {
    for (const clause of clauses) {
      await prisma.clause.create({
        data: {
          contractId,
          clauseType: clause.clauseType || 'OTHER',
          clauseTitle: clause.clauseTitle,
          clauseText: clause.clauseText || '',
          clauseSummary: clause.clauseSummary,
          sectionNumber: clause.sectionNumber || clause.section,
          pageNumber: clause.pageNumber,
          versionNumber,
          changeType: 'ADDED', // First version
          significantChange: false,
        },
      });
    }
  }
  
  /**
   * Build dependency graph for obligations (internal method)
   */
  private async _buildDependencyGraph(
    contractId: string,
    obligations: any[]
  ): Promise<any> {
    // Build graph using Cyrex
    const graphResult = await cyrexClient.buildDependencyGraph({
      contractId,
      obligations: obligations.map(obl => ({
        id: obl.id || obl.obligation_id,
        description: obl.description,
        obligationType: obl.obligationType || obl.type,
        contractId: obl.contractId || contractId,
      })),
    });
    
    const data = graphResult.data || graphResult;
    
    // Store dependencies in database
    for (const dep of data.dependencies || []) {
      try {
        await prisma.obligationDependency.create({
          data: {
            sourceObligationId: dep.source_obligation_id || dep.sourceObligationId,
            targetObligationId: dep.target_obligation_id || dep.targetObligationId,
            dependencyType: dep.dependency_type || dep.dependencyType || 'TRIGGERS',
            description: dep.description,
            confidence: dep.confidence,
            sourceContractId: contractId,
            targetContractId: contractId,
          },
        });
      } catch (error: any) {
        // Dependency might already exist, skip
        secureLog('warn', 'Failed to create dependency (may already exist)', {
          error: error.message,
          source: dep.source_obligation_id,
          target: dep.target_obligation_id,
        });
      }
    }
    
    return data;
  }
  
  /**
   * Build dependency graph (public method)
   */
  async buildDependencyGraph(contractId: string, obligations?: any[]): Promise<any> {
    if (!obligations) {
      // Get obligations from database
      obligations = await prisma.obligation.findMany({
        where: { contractId },
      });
    }
    
    return await this._buildDependencyGraph(contractId, obligations);
  }
  
  /**
   * Get clauses for contract
   */
  async getClauses(contractId: string, versionNumber?: number): Promise<Clause[]> {
    const where: Prisma.ClauseWhereInput = { contractId };
    if (versionNumber) {
      where.versionNumber = versionNumber;
    }
    
    return prisma.clause.findMany({
      where,
      orderBy: { sectionNumber: 'asc' },
    });
  }
  
  /**
   * Process contract asynchronously
   */
  async processContractAsync(contractId: string): Promise<void> {
    setImmediate(async () => {
      try {
        await this.processContract(contractId);
      } catch (error: any) {
        secureLog('error', 'Error in async contract processing', { contractId, error: error.message });
      }
    });
  }
  
  /**
   * Get contract by ID
   */
  async getContractById(contractId: string): Promise<Contract | null> {
    return prisma.contract.findUnique({ where: { id: contractId } });
  }
  
  /**
   * List contracts
   */
  async listContracts(filters: {
    userId?: string;
    organizationId?: string;
    status?: string;
    contractType?: string;
  }): Promise<Contract[]> {
    const where: Prisma.ContractWhereInput = {};

    if (filters.userId) where.userId = filters.userId;
    if (filters.organizationId) where.organizationId = filters.organizationId;
    if (filters.status) where.status = filters.status as any;
    if (filters.contractType) where.contractType = filters.contractType;

    return prisma.contract.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }
  
  /**
   * Create contract version
   */
  async createContractVersion(
    contractId: string,
    file: Express.Multer.File,
    versionNumber?: number
  ): Promise<ContractVersion> {
    const contract = await prisma.contract.findUnique({ where: { id: contractId } });
    if (!contract) throw new Error('Contract not found');

    // Get current version number
    const currentVersions = await prisma.contractVersion.findMany({
      where: { contractId },
      orderBy: { versionNumber: 'desc' },
      take: 1,
    });

    const nextVersionNumber = versionNumber || 
      (currentVersions.length > 0 ? currentVersions[0].versionNumber + 1 : 1);

    // Upload document
    const uploadResult = await documentService.uploadDocument(file, 'contract-versions');
    const extractedText = await documentService.extractText(uploadResult.url);

    // Abstract new version
    const abstractionResult = await cyrexClient.abstractContract({
      contractId,
      documentText: extractedText,
      documentUrl: uploadResult.url,
      contractNumber: contract.contractNumber,
      versionNumber: nextVersionNumber,
    });

    const abstractedTerms = abstractionResult.data?.abstractedTerms || abstractionResult.abstractedTerms;
    const keyClauses = abstractionResult.data?.keyClauses || abstractionResult.keyClauses || [];

    // Compare with previous version if exists
    let changes = null;
    let changeSummary = null;
    let significantChanges = false;
    
    if (currentVersions.length > 0) {
      const previousVersion = currentVersions[0];
      const comparison = await cyrexClient.compareContractVersions(
        previousVersion.abstractedTerms as any,
        abstractedTerms
      );
      changes = comparison.data?.changes || comparison.changes;
      changeSummary = comparison.data?.summary || comparison.summary;
      significantChanges = comparison.data?.significant || false;
      
      // Track clause evolution
      const fromClauses = await this.getClauses(contractId, previousVersion.versionNumber);
      
      if (fromClauses.length > 0 && keyClauses.length > 0) {
        await cyrexClient.trackClauseEvolution({
          contractId,
          oldVersionClauses: fromClauses.map(c => ({
            clauseType: c.clauseType,
            clauseTitle: c.clauseTitle,
            clauseText: c.clauseText,
          })),
          newVersionClauses: keyClauses,
          oldVersionNumber: previousVersion.versionNumber,
          newVersionNumber: nextVersionNumber,
        });
      }
    }

    const version = await prisma.contractVersion.create({
      data: {
        contractId,
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

    // Update clauses with evolution tracking
    if (keyClauses.length > 0 && currentVersions.length > 0) {
      await this._updateClausesWithEvolution(
        contractId,
        keyClauses,
        nextVersionNumber
      );
      
      // Track clause evolution
      await clauseEvolutionService.trackClauseEvolution(
        contractId,
        currentVersions[0].versionNumber,
        nextVersionNumber
      );
      
      await eventPublisher.publishClauseEvolutionTracked(contractId, {
        fromVersion: currentVersions[0].versionNumber,
        toVersion: nextVersionNumber,
        changesCount: keyClauses.length,
      });
    }
    
    await eventPublisher.publishContractVersionCreated(contractId, version.id, nextVersionNumber);

    return version;
  }
  
  /**
   * Update clauses with evolution tracking
   */
  private async _updateClausesWithEvolution(
    contractId: string,
    newClauses: any[],
    versionNumber: number
  ): Promise<void> {
    // Get previous version clauses
    const previousClauses = await prisma.clause.findMany({
      where: {
        contractId,
        versionNumber: versionNumber - 1,
      },
    });
    
    // Create/update clauses with evolution data
    for (const newClause of newClauses) {
      // Find matching previous clause
      const previousClause = previousClauses.find(
        pc => pc.clauseType === newClause.clauseType && 
              (pc.clauseTitle === newClause.clauseTitle || 
               pc.clauseText.substring(0, 100) === newClause.clauseText?.substring(0, 100))
      );
      
      await prisma.clause.create({
        data: {
          contractId,
          clauseType: newClause.clauseType || 'OTHER',
          clauseTitle: newClause.clauseTitle,
          clauseText: newClause.clauseText || '',
          clauseSummary: newClause.clauseSummary,
          sectionNumber: newClause.sectionNumber || newClause.section,
          pageNumber: newClause.pageNumber,
          versionNumber,
          previousVersionId: previousClause?.id,
          changeType: previousClause ? 'MODIFIED' : 'ADDED',
          significantChange: false,
        },
      });
    }
  }
  
  /**
   * Compare contract versions
   */
  async compareVersions(
    contractId: string,
    versionId: string,
    compareToVersionNumber?: number
  ): Promise<any> {
    const targetVersion = await prisma.contractVersion.findUnique({
      where: { id: versionId },
    });
    
    if (!targetVersion) throw new Error('Version not found');
    
    let compareToVersion: ContractVersion | null = null;
    
    if (compareToVersionNumber) {
      compareToVersion = await prisma.contractVersion.findUnique({
        where: {
          contractId_versionNumber: {
            contractId,
            versionNumber: compareToVersionNumber,
          },
        },
      });
    } else {
      const previousVersions = await prisma.contractVersion.findMany({
        where: {
          contractId,
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
    
    const comparison = await cyrexClient.compareContractVersions(
      compareToVersion.abstractedTerms as any,
      targetVersion.abstractedTerms as any
    );
    
    // Get clause evolution
    const fromClauses = await this.getClauses(contractId, compareToVersion.versionNumber);
    const toClauses = await this.getClauses(contractId, targetVersion.versionNumber);
    
    let clauseEvolution = null;
    if (fromClauses.length > 0 && toClauses.length > 0) {
      const evolutionResult = await cyrexClient.trackClauseEvolution({
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
        oldVersionNumber: compareToVersion.versionNumber,
        newVersionNumber: targetVersion.versionNumber,
      });
      clauseEvolution = evolutionResult.data || evolutionResult;
    }
    
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
      changes: comparison.data?.changes || comparison.changes,
      summary: comparison.data?.summary || comparison.summary,
      clauseEvolution,
    };
  }
}

export const contractIntelligenceService = new ContractIntelligenceService();

