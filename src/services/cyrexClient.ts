import axios, { AxiosInstance } from 'axios';
import { config } from '../config/environment';
import { logger } from '../utils/logger';

export interface AbstractLeaseRequest {
  leaseId: string;
  documentText: string;
  documentUrl: string;
  leaseNumber?: string;
  tenantName?: string;
  propertyAddress?: string;
}

export interface AbstractContractRequest {
  contractId: string;
  documentText: string;
  documentUrl: string;
  contractNumber?: string;
  partyA?: string;
  partyB?: string;
  versionNumber?: number;
}

export interface TrackClauseEvolutionRequest {
  contractId: string;
  oldVersionClauses: any[];
  newVersionClauses: any[];
  oldVersionNumber: number;
  newVersionNumber: number;
}

export interface BuildDependencyGraphRequest {
  contractId: string;
  obligations: any[];
  contracts?: string[];
  leases?: string[];
}

export interface FindCascadingObligationsRequest {
  obligationId: string;
  maxDepth?: number;
}

export class CyrexClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.cyrex.baseUrl,
      timeout: 120000, // 2 minutes for document processing
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.cyrex.apiKey,
      },
    });
  }

  /**
   * Abstract lease document
   */
  async abstractLease(request: AbstractLeaseRequest): Promise<any> {
    try {
      logger.info('Calling Cyrex lease abstraction', { leaseId: request.leaseId });
      
      const response = await this.client.post('/language-intelligence/lease/abstract', request);
      
      return response.data;
    } catch (error: any) {
      logger.error('Cyrex lease abstraction failed', {
        leaseId: request.leaseId,
        error: error.message,
      });
      throw new Error(`Lease abstraction failed: ${error.message}`);
    }
  }

  /**
   * Abstract contract document
   */
  async abstractContract(request: AbstractContractRequest): Promise<any> {
    try {
      logger.info('Calling Cyrex contract abstraction', { contractId: request.contractId });
      
      const response = await this.client.post('/language-intelligence/contract/abstract', request);
      
      return response.data;
    } catch (error: any) {
      logger.error('Cyrex contract abstraction failed', {
        contractId: request.contractId,
        error: error.message,
      });
      throw new Error(`Contract abstraction failed: ${error.message}`);
    }
  }

  /**
   * Track clause evolution
   */
  async trackClauseEvolution(request: TrackClauseEvolutionRequest): Promise<any> {
    try {
      logger.info('Calling Cyrex clause evolution tracking', { contractId: request.contractId });
      
      const response = await this.client.post('/language-intelligence/contract/track-clause-evolution', request);
      
      return response.data;
    } catch (error: any) {
      logger.error('Cyrex clause evolution tracking failed', {
        contractId: request.contractId,
        error: error.message,
      });
      throw new Error(`Clause evolution tracking failed: ${error.message}`);
    }
  }

  /**
   * Build dependency graph
   */
  async buildDependencyGraph(request: BuildDependencyGraphRequest): Promise<any> {
    try {
      logger.info('Calling Cyrex dependency graph builder', { contractId: request.contractId });
      
      const response = await this.client.post('/language-intelligence/contract/build-dependency-graph', request);
      
      return response.data;
    } catch (error: any) {
      logger.error('Cyrex dependency graph build failed', {
        contractId: request.contractId,
        error: error.message,
      });
      throw new Error(`Dependency graph build failed: ${error.message}`);
    }
  }

  /**
   * Find cascading obligations
   */
  async findCascadingObligations(request: FindCascadingObligationsRequest): Promise<any> {
    try {
      logger.info('Calling Cyrex cascade analysis', { obligationId: request.obligationId });
      
      const response = await this.client.post('/language-intelligence/obligations/find-cascading', request);
      
      return response.data;
    } catch (error: any) {
      logger.error('Cyrex cascade analysis failed', {
        obligationId: request.obligationId,
        error: error.message,
      });
      throw new Error(`Cascade analysis failed: ${error.message}`);
    }
  }

  /**
   * Compare contract versions
   */
  async compareContractVersions(
    oldAbstractedTerms: any,
    newAbstractedTerms: any
  ): Promise<any> {
    try {
      logger.info('Calling Cyrex contract version comparison');
      
      const response = await this.client.post('/language-intelligence/contract/compare-versions', {
        oldAbstractedTerms,
        newAbstractedTerms,
      });
      
      return response.data;
    } catch (error: any) {
      logger.error('Cyrex contract version comparison failed', { error: error.message });
      throw new Error(`Contract version comparison failed: ${error.message}`);
    }
  }

  /**
   * Compare lease versions
   */
  async compareLeaseVersions(
    oldAbstractedTerms: any,
    newAbstractedTerms: any
  ): Promise<any> {
    try {
      logger.info('Calling Cyrex lease version comparison');
      
      const response = await this.client.post('/language-intelligence/lease/compare-versions', {
        oldAbstractedTerms,
        newAbstractedTerms,
      });
      
      return response.data;
    } catch (error: any) {
      logger.error('Cyrex lease version comparison failed', { error: error.message });
      throw new Error(`Lease version comparison failed: ${error.message}`);
    }
  }
}

export const cyrexClient = new CyrexClient();

