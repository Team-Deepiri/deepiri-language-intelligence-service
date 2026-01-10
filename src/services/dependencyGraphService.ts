import { prisma } from '../db';
import { cyrexClient } from './cyrexClient';
import { logger } from '../utils/logger';
import type { Obligation, ObligationDependency } from '@prisma/client';

export class DependencyGraphService {
  /**
   * Build dependency graph for contract (and optionally related leases)
   */
  async buildDependencyGraph(
    contractId: string,
    includeLeases: boolean = false
  ): Promise<any> {
    // Get all obligations for this contract
    const contractObligations = await prisma.obligation.findMany({
      where: { contractId },
    });
    
    let allObligations = contractObligations;
    
    // Include lease obligations if requested
    if (includeLeases) {
      const leaseObligations = await prisma.obligation.findMany({
        where: {
          leaseId: { not: null },
        },
      });
      allObligations = [...contractObligations, ...leaseObligations];
    }
    
    // Build graph using Cyrex
    const graphResult = await cyrexClient.buildDependencyGraph({
      contractId,
      obligations: allObligations.map(obl => ({
        id: obl.id,
        description: obl.description,
        obligationType: obl.obligationType,
        leaseId: obl.leaseId,
        contractId: obl.contractId,
      })),
    });
    
    // Store new dependencies in database
    for (const edge of graphResult.data.edges || []) {
      // Check if dependency already exists
      const existing = await prisma.obligationDependency.findFirst({
        where: {
          sourceObligationId: edge.source,
          targetObligationId: edge.target,
        },
      });
      
      if (!existing) {
        await prisma.obligationDependency.create({
          data: {
            sourceObligationId: edge.source,
            targetObligationId: edge.target,
            dependencyType: edge.dependency_type || 'TRIGGERS',
            description: edge.description,
            confidence: edge.confidence,
            sourceContractId: contractId,
            targetContractId: contractId,
            discoveredBy: 'LLM',
          },
        });
      }
    }
    
    return {
      nodes: graphResult.data.nodes,
      edges: graphResult.data.edges,
      analysis: graphResult.data.analysis,
    };
  }
  
  /**
   * Find cascading obligations
   */
  async findCascadingObligations(
    obligationId: string,
    maxDepth: number = 5
  ): Promise<any[]> {
    // Use Cyrex to find cascading obligations
    const cascading = await cyrexClient.findCascadingObligations({
      obligationId,
      maxDepth,
    });
    
    return cascading.data || [];
  }
  
  /**
   * Get dependency graph visualization data
   */
  async getDependencyGraphVisualization(
    contractId: string
  ): Promise<any> {
    const dependencies = await prisma.obligationDependency.findMany({
      where: {
        OR: [
          { sourceContractId: contractId },
          { targetContractId: contractId },
        ],
      },
      include: {
        sourceObligation: true,
        targetObligation: true,
      },
    });
    
    return {
      nodes: this._buildNodes(dependencies),
      edges: this._buildEdges(dependencies),
    };
  }
  
  private _buildNodes(dependencies: any[]): any[] {
    const nodeMap = new Map();
    
    for (const dep of dependencies) {
      if (dep.sourceObligation) {
        nodeMap.set(dep.sourceObligationId, {
          id: dep.sourceObligationId,
          label: dep.sourceObligation.description.substring(0, 50),
          type: dep.sourceObligation.obligationType,
        });
      }
      
      if (dep.targetObligation) {
        nodeMap.set(dep.targetObligationId, {
          id: dep.targetObligationId,
          label: dep.targetObligation.description.substring(0, 50),
          type: dep.targetObligation.obligationType,
        });
      }
    }
    
    return Array.from(nodeMap.values());
  }
  
  private _buildEdges(dependencies: any[]): any[] {
    return dependencies.map(dep => ({
      source: dep.sourceObligationId,
      target: dep.targetObligationId,
      type: dep.dependencyType,
      description: dep.description,
    }));
  }
}

export const dependencyGraphService = new DependencyGraphService();

