# Language Intelligence Service - Implementation Guide

## Step-by-Step Implementation Guide

This guide walks through implementing the core services for the Language Intelligence Service:
1. Database Layer Implementation
2. Document Service
3. Lease Service
4. Contract Service

---

## Prerequisites

Before starting, ensure you have:

- Node.js 18+ installed
- PostgreSQL database running
- MinIO/S3 configured
- Dependencies installed: `npm install`
- Prisma schema generated: `npm run prisma:generate`

---

## Step 1: Database Layer Implementation

### 1.1 Enhance Prisma Client Setup

**File**: `src/db.ts`

Update the existing database connection to include connection pooling and error handling:

```typescript
import { PrismaClient } from '@prisma/client';
import { logger } from './utils/logger';

let prisma: PrismaClient;

export async function connectDatabase(): Promise<void> {
  try {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' 
        ? ['query', 'error', 'warn'] 
        : ['error'],
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });
    
    // Test connection
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    
    logger.info('Language Intelligence Service: Connected to PostgreSQL');
  } catch (error: any) {
    logger.error('Language Intelligence Service: Failed to connect to PostgreSQL', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma?.$disconnect();
    logger.info('Language Intelligence Service: Disconnected from PostgreSQL');
  } catch (error: any) {
    logger.error('Language Intelligence Service: Error disconnecting from PostgreSQL', error);
  }
}

// Handle graceful shutdown
process.on('beforeExit', async () => {
  await disconnectDatabase();
});

export { prisma };
```

### 1.2 Create Base Repository Pattern

**File**: `src/repositories/BaseRepository.ts`

Create a base repository class for common database operations:

```typescript
import { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../utils/logger';

export abstract class BaseRepository<T, CreateInput, UpdateInput> {
  protected prisma: PrismaClient;
  protected modelName: string;

  constructor(modelName: string) {
    this.prisma = prisma;
    this.modelName = modelName;
  }

  /**
   * Find by ID
   */
  async findById(id: string): Promise<T | null> {
    try {
      const result = await (this.prisma[this.modelName as keyof PrismaClient] as any).findUnique({
        where: { id },
      });
      return result as T | null;
    } catch (error: any) {
      logger.error(`Error finding ${this.modelName} by ID`, { id, error: error.message });
      throw error;
    }
  }

  /**
   * Find many with filters
   */
  async findMany(where?: any, options?: {
    skip?: number;
    take?: number;
    orderBy?: any;
    include?: any;
  }): Promise<T[]> {
    try {
      const result = await (this.prisma[this.modelName as keyof PrismaClient] as any).findMany({
        where,
        ...options,
      });
      return result as T[];
    } catch (error: any) {
      logger.error(`Error finding ${this.modelName}`, { where, error: error.message });
      throw error;
    }
  }

  /**
   * Count records
   */
  async count(where?: any): Promise<number> {
    try {
      const result = await (this.prisma[this.modelName as keyof PrismaClient] as any).count({
        where,
      });
      return result;
    } catch (error: any) {
      logger.error(`Error counting ${this.modelName}`, { where, error: error.message });
      throw error;
    }
  }

  /**
   * Create record
   */
  async create(data: CreateInput): Promise<T> {
    try {
      const result = await (this.prisma[this.modelName as keyof PrismaClient] as any).create({
        data,
      });
      logger.info(`${this.modelName} created`, { id: (result as any).id });
      return result as T;
    } catch (error: any) {
      logger.error(`Error creating ${this.modelName}`, { data, error: error.message });
      throw error;
    }
  }

  /**
   * Update record
   */
  async update(id: string, data: UpdateInput): Promise<T> {
    try {
      const result = await (this.prisma[this.modelName as keyof PrismaClient] as any).update({
        where: { id },
        data,
      });
      logger.info(`${this.modelName} updated`, { id });
      return result as T;
    } catch (error: any) {
      logger.error(`Error updating ${this.modelName}`, { id, data, error: error.message });
      throw error;
    }
  }

  /**
   * Delete record
   */
  async delete(id: string): Promise<T> {
    try {
      const result = await (this.prisma[this.modelName as keyof PrismaClient] as any).delete({
        where: { id },
      });
      logger.info(`${this.modelName} deleted`, { id });
      return result as T;
    } catch (error: any) {
      logger.error(`Error deleting ${this.modelName}`, { id, error: error.message });
      throw error;
    }
  }

  /**
   * Transaction support
   */
  async transaction<R>(
    callback: (tx: Prisma.TransactionClient) => Promise<R>
  ): Promise<R> {
    return await this.prisma.$transaction(callback);
  }
}
```

### 1.3 Create Lease Repository

**File**: `src/repositories/LeaseRepository.ts`

```typescript
import { BaseRepository } from './BaseRepository';
import { Lease, Prisma } from '@prisma/client';
import { prisma } from '../db';

export interface CreateLeaseData {
  leaseNumber: string;
  tenantName: string;
  landlordName?: string;
  propertyAddress: string;
  propertyType?: string;
  squareFootage?: number;
  startDate: Date;
  endDate: Date;
  documentUrl: string;
  documentStorageKey?: string;
  rawText?: string;
  documentType?: string;
  fileSize?: number;
  userId?: string;
  organizationId?: string;
  tags?: string[];
  notes?: string;
  metadata?: any;
}

export interface UpdateLeaseData {
  tenantName?: string;
  landlordName?: string;
  propertyAddress?: string;
  propertyType?: string;
  squareFootage?: number;
  startDate?: Date;
  endDate?: Date;
  status?: string;
  processingStatus?: string;
  processingError?: string;
  processedAt?: Date;
  processingTimeMs?: number;
  abstractedTerms?: any;
  financialTerms?: any;
  keyDates?: any;
  propertyDetails?: any;
  keyClauses?: any;
  extractionConfidence?: number;
  validationScore?: number;
  tags?: string[];
  notes?: string;
  metadata?: any;
  updatedBy?: string;
}

export class LeaseRepository extends BaseRepository<Lease, CreateLeaseData, UpdateLeaseData> {
  constructor() {
    super('lease');
  }

  /**
   * Find by lease number
   */
  async findByLeaseNumber(leaseNumber: string): Promise<Lease | null> {
    return await prisma.lease.findUnique({
      where: { leaseNumber },
    });
  }

  /**
   * Find by tenant name
   */
  async findByTenantName(tenantName: string, options?: {
    skip?: number;
    take?: number;
  }): Promise<Lease[]> {
    return await prisma.lease.findMany({
      where: {
        tenantName: {
          contains: tenantName,
          mode: 'insensitive',
        },
      },
      ...options,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find by status
   */
  async findByStatus(status: string, options?: {
    skip?: number;
    take?: number;
  }): Promise<Lease[]> {
    return await prisma.lease.findMany({
      where: { status: status as any },
      ...options,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find by user ID
   */
  async findByUserId(userId: string, options?: {
    skip?: number;
    take?: number;
  }): Promise<Lease[]> {
    return await prisma.lease.findMany({
      where: { userId },
      ...options,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find with relations
   */
  async findByIdWithRelations(id: string): Promise<Lease | null> {
    return await prisma.lease.findUnique({
      where: { id },
      include: {
        versions: true,
        obligations: true,
      },
    });
  }
}
```

### 1.4 Create Contract Repository

**File**: `src/repositories/ContractRepository.ts`

```typescript
import { BaseRepository } from './BaseRepository';
import { Contract, Prisma } from '@prisma/client';
import { prisma } from '../db';

export interface CreateContractData {
  contractNumber: string;
  contractName: string;
  partyA: string;
  partyB: string;
  contractType?: string;
  jurisdiction?: string;
  documentUrl: string;
  documentStorageKey?: string;
  rawText?: string;
  documentType?: string;
  fileSize?: number;
  versionNumber?: number;
  userId?: string;
  organizationId?: string;
  tags?: string[];
  notes?: string;
  metadata?: any;
}

export interface UpdateContractData {
  contractName?: string;
  partyA?: string;
  partyB?: string;
  contractType?: string;
  jurisdiction?: string;
  status?: string;
  processingStatus?: string;
  processingError?: string;
  processedAt?: Date;
  processingTimeMs?: number;
  abstractedTerms?: any;
  keyClauses?: any;
  financialTerms?: any;
  extractionConfidence?: number;
  validationScore?: number;
  tags?: string[];
  notes?: string;
  metadata?: any;
  updatedBy?: string;
}

export class ContractRepository extends BaseRepository<Contract, CreateContractData, UpdateContractData> {
  constructor() {
    super('contract');
  }

  /**
   * Find by contract number
   */
  async findByContractNumber(contractNumber: string): Promise<Contract | null> {
    return await prisma.contract.findUnique({
      where: { contractNumber },
    });
  }

  /**
   * Find by party
   */
  async findByParty(partyName: string, options?: {
    skip?: number;
    take?: number;
  }): Promise<Contract[]> {
    return await prisma.contract.findMany({
      where: {
        OR: [
          { partyA: { contains: partyName, mode: 'insensitive' } },
          { partyB: { contains: partyName, mode: 'insensitive' } },
        ],
      },
      ...options,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find by status
   */
  async findByStatus(status: string, options?: {
    skip?: number;
    take?: number;
  }): Promise<Contract[]> {
    return await prisma.contract.findMany({
      where: { status: status as any },
      ...options,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find with relations
   */
  async findByIdWithRelations(id: string): Promise<Contract | null> {
    return await prisma.contract.findUnique({
      where: { id },
      include: {
        versions: true,
        clauses: true,
        obligations: true,
        dependencies: true,
      },
    });
  }
}
```

**Action Items:**
1. Create `src/repositories/` directory
2. Create `BaseRepository.ts`
3. Create `LeaseRepository.ts`
4. Create `ContractRepository.ts`
5. Run `npm run build` to verify TypeScript compilation

---

## Step 2: Document Service Implementation

### 2.1 Enhance Document Service with Local Text Extraction

**File**: `src/services/documentService.ts`

Add local PDF and DOCX extraction methods (as fallback or primary option):

```typescript
// Add these imports at the top
import * as pdfParse from 'pdf-parse';
import * as mammoth from 'mammoth';
import { Readable } from 'stream';

// Add these methods to the DocumentService class

/**
 * Extract text from PDF locally (fallback method)
 */
async extractTextFromPDF(buffer: Buffer): Promise<string> {
  try {
    logger.info('Extracting text from PDF locally');
    const data = await pdfParse(buffer);
    return data.text;
  } catch (error: any) {
    logger.error('Failed to extract text from PDF', { error: error.message });
    throw new Error(`PDF text extraction failed: ${error.message}`);
  }
}

/**
 * Extract text from DOCX locally (fallback method)
 */
async extractTextFromDOCX(buffer: Buffer): Promise<string> {
  try {
    logger.info('Extracting text from DOCX locally');
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (error: any) {
    logger.error('Failed to extract text from DOCX', { error: error.message });
    throw new Error(`DOCX text extraction failed: ${error.message}`);
  }
}

/**
 * Extract text from document (enhanced with local fallback)
 * Tries Cyrex first, falls back to local extraction
 */
async extractText(
  documentUrl: string, 
  documentType?: string,
  buffer?: Buffer
): Promise<string> {
  try {
    logger.info('Extracting text from document', { documentUrl, documentType });
    
    // Determine document type from URL if not provided
    if (!documentType) {
      const urlLower = documentUrl.toLowerCase();
      if (urlLower.endsWith('.pdf')) {
        documentType = 'pdf';
      } else if (urlLower.endsWith('.docx') || urlLower.endsWith('.doc')) {
        documentType = 'docx';
      } else if (urlLower.match(/\.(jpg|jpeg|png|gif|bmp)$/)) {
        documentType = 'image';
      } else {
        documentType = 'pdf'; // Default
      }
    }

    // If buffer is provided and document type is PDF/DOCX, try local extraction first
    if (buffer && (documentType === 'pdf' || documentType === 'docx')) {
      try {
        if (documentType === 'pdf') {
          return await this.extractTextFromPDF(buffer);
        } else if (documentType === 'docx') {
          return await this.extractTextFromDOCX(buffer);
        }
      } catch (localError: any) {
        logger.warn('Local extraction failed, trying Cyrex', { error: localError.message });
        // Fall through to Cyrex
      }
    }

    // Try Cyrex extraction (for images, OCR, or as fallback)
    try {
      const response = await axios.post(
        `${config.cyrex.baseUrl}/document-extraction/extract-text`,
        { 
          documentUrl,
          documentType: documentType || 'pdf'
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.cyrex.apiKey,
          },
          timeout: 120000, // 2 minutes for large documents
        }
      );

      if (!response.data.success) {
        throw new Error(response.data.error || 'Text extraction failed');
      }

      return response.data.text || '';
    } catch (cyrexError: any) {
      logger.error('Cyrex extraction failed', {
        documentUrl,
        documentType,
        error: cyrexError.message,
      });
      
      // If we have a buffer and Cyrex failed, try local extraction as last resort
      if (buffer && (documentType === 'pdf' || documentType === 'docx')) {
        logger.info('Attempting local extraction as last resort');
        if (documentType === 'pdf') {
          return await this.extractTextFromPDF(buffer);
        } else if (documentType === 'docx') {
          return await this.extractTextFromDOCX(buffer);
        }
      }
      
      throw new Error(`Text extraction failed: ${cyrexError.message}`);
    }
  } catch (error: any) {
    logger.error('Failed to extract text', {
      documentUrl,
      documentType,
      error: error.message,
    });
    throw new Error(`Text extraction failed: ${error.message}`);
  }
}

/**
 * Download document from storage and extract text
 */
async downloadAndExtractText(storageKey: string, documentType?: string): Promise<string> {
  try {
    logger.info('Downloading document for text extraction', { storageKey });
    
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    });

    const response = await this.s3Client.send(command);
    
    if (!response.Body) {
      throw new Error('Empty response body');
    }

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    const stream = response.Body as Readable;
    
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    
    const buffer = Buffer.concat(chunks);
    
    // Extract text
    return await this.extractText(
      `${config.storage.endpoint}/${this.bucket}/${storageKey}`,
      documentType,
      buffer
    );
  } catch (error: any) {
    logger.error('Failed to download and extract text', {
      storageKey,
      error: error.message,
    });
    throw new Error(`Download and extraction failed: ${error.message}`);
  }
}
```

**Action Items:**
1. Update `documentService.ts` with new methods
2. Ensure `pdf-parse` and `mammoth` are in `package.json` (already there)
3. Test PDF extraction: `npm run dev` and test with a sample PDF
4. Test DOCX extraction: Test with a sample DOCX file

---

## Step 3: Lease Service Implementation

### 3.1 Create Lease Service

**File**: `src/services/leaseService.ts`

Create a comprehensive lease service that integrates with document service and cyrex:

```typescript
import { LeaseRepository, CreateLeaseData, UpdateLeaseData } from '../repositories/LeaseRepository';
import { documentService } from './documentService';
import { cyrexClient } from './cyrexClient';
import { obligationService } from './obligationService';
import { eventPublisher } from '../streaming/eventPublisher';
import { logger } from '../utils/logger';
import type { Lease, LeaseVersion } from '@prisma/client';

export interface CreateLeaseInput {
  leaseNumber: string;
  tenantName: string;
  landlordName?: string;
  propertyAddress: string;
  propertyType?: string;
  squareFootage?: number;
  startDate: Date | string;
  endDate: Date | string;
  documentUrl?: string;
  documentFile?: Express.Multer.File;
  userId?: string;
  organizationId?: string;
  tags?: string[];
  notes?: string;
}

export interface ProcessLeaseOptions {
  extractText?: boolean;
  abstractLease?: boolean;
  extractObligations?: boolean;
}

export class LeaseService {
  private leaseRepository: LeaseRepository;

  constructor() {
    this.leaseRepository = new LeaseRepository();
  }

  /**
   * Create lease record
   * Handles file upload if provided
   */
  async createLease(input: CreateLeaseInput): Promise<Lease> {
    try {
      let documentUrl = input.documentUrl;
      let documentStorageKey: string | undefined;
      let rawText: string | undefined;
      let fileSize: number | undefined;
      let documentType = 'PDF';

      // If file is provided, upload it
      if (input.documentFile) {
        logger.info('Uploading lease document', {
          fileName: input.documentFile.originalname,
          fileSize: input.documentFile.size,
        });

        const uploadResult = await documentService.uploadDocument(
          input.documentFile,
          'leases'
        );

        documentUrl = uploadResult.url;
        documentStorageKey = uploadResult.storageKey;
        fileSize = uploadResult.fileSize;
        documentType = uploadResult.mimeType.includes('pdf') ? 'PDF' : 'DOCX';

        // Extract text immediately if file is small (< 5MB)
        if (fileSize < 5 * 1024 * 1024) {
          try {
            rawText = await documentService.extractText(
              documentUrl,
              documentType.toLowerCase(),
              input.documentFile.buffer
            );
            logger.info('Text extracted during upload', {
              textLength: rawText.length,
            });
          } catch (error: any) {
            logger.warn('Text extraction failed during upload', {
              error: error.message,
            });
            // Continue without text - will extract later
          }
        }
      }

      // Create lease data
      const leaseData: CreateLeaseData = {
        leaseNumber: input.leaseNumber,
        tenantName: input.tenantName,
        landlordName: input.landlordName,
        propertyAddress: input.propertyAddress,
        propertyType: input.propertyType,
        squareFootage: input.squareFootage,
        startDate: typeof input.startDate === 'string' 
          ? new Date(input.startDate) 
          : input.startDate,
        endDate: typeof input.endDate === 'string' 
          ? new Date(input.endDate) 
          : input.endDate,
        documentUrl: documentUrl!,
        documentStorageKey,
        rawText,
        documentType,
        fileSize,
        userId: input.userId,
        organizationId: input.organizationId,
        tags: input.tags || [],
        notes: input.notes,
        status: 'PENDING',
      };

      const lease = await this.leaseRepository.create(leaseData);

      logger.info('Lease created', {
        leaseId: lease.id,
        leaseNumber: lease.leaseNumber,
      });

      await eventPublisher.publishLeaseCreated(lease.id, lease.leaseNumber);

      return lease;
    } catch (error: any) {
      logger.error('Failed to create lease', {
        input,
        error: error.message,
      });
      throw new Error(`Lease creation failed: ${error.message}`);
    }
  }

  /**
   * Get lease by ID
   */
  async getLease(leaseId: string): Promise<Lease | null> {
    try {
      return await this.leaseRepository.findByIdWithRelations(leaseId);
    } catch (error: any) {
      logger.error('Failed to get lease', {
        leaseId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * List leases with filters
   */
  async listLeases(filters: {
    status?: string;
    tenantName?: string;
    userId?: string;
    organizationId?: string;
    skip?: number;
    take?: number;
  }): Promise<{ leases: Lease[]; total: number }> {
    try {
      const where: any = {};

      if (filters.status) {
        where.status = filters.status;
      }

      if (filters.tenantName) {
        where.tenantName = {
          contains: filters.tenantName,
          mode: 'insensitive',
        };
      }

      if (filters.userId) {
        where.userId = filters.userId;
      }

      if (filters.organizationId) {
        where.organizationId = filters.organizationId;
      }

      const [leases, total] = await Promise.all([
        this.leaseRepository.findMany(where, {
          skip: filters.skip || 0,
          take: filters.take || 50,
          orderBy: { createdAt: 'desc' },
        }),
        this.leaseRepository.count(where),
      ]);

      return { leases, total };
    } catch (error: any) {
      logger.error('Failed to list leases', {
        filters,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Process lease (extract text, abstract, extract obligations)
   * This is the main processing pipeline
   */
  async processLease(
    leaseId: string,
    options: ProcessLeaseOptions = {}
  ): Promise<Lease> {
    const {
      extractText = true,
      abstractLease = true,
      extractObligations = true,
    } = options;

    try {
      // Get lease
      const lease = await this.leaseRepository.findById(leaseId);
      if (!lease) {
        throw new Error('Lease not found');
      }

      // Update status to PROCESSING
      await this.leaseRepository.update(leaseId, {
        status: 'PROCESSING',
        processingStatus: 'EXTRACTING_TEXT',
      });

      let rawText = lease.rawText;

      // Step 1: Extract text if needed
      if (extractText && !rawText && lease.documentStorageKey) {
        try {
          logger.info('Extracting text from lease document', { leaseId });
          rawText = await documentService.downloadAndExtractText(
            lease.documentStorageKey,
            lease.documentType
          );

          await this.leaseRepository.update(leaseId, {
            rawText,
            processingStatus: 'TEXT_EXTRACTED',
          });
        } catch (error: any) {
          logger.error('Text extraction failed', {
            leaseId,
            error: error.message,
          });
          await this.leaseRepository.update(leaseId, {
            status: 'ERROR',
            processingError: `Text extraction failed: ${error.message}`,
            processingStatus: 'ERROR',
          });
          throw error;
        }
      }

      if (!rawText) {
        throw new Error('No text available for processing');
      }

      // Step 2: Abstract lease using Cyrex
      if (abstractLease) {
        try {
          logger.info('Abstracting lease using Cyrex', { leaseId });
          
          await this.leaseRepository.update(leaseId, {
            processingStatus: 'ABSTRACTING',
          });

          const startTime = Date.now();
          const cyrexResult = await cyrexClient.abstractLease({
            leaseId: lease.id,
            documentText: rawText,
            documentUrl: lease.documentUrl,
            leaseNumber: lease.leaseNumber,
            tenantName: lease.tenantName,
            propertyAddress: lease.propertyAddress,
          });

          const processingTimeMs = Date.now() - startTime;
          const abstractedData = cyrexResult.data;

          // Update lease with abstracted terms
          await this.leaseRepository.update(leaseId, {
            status: 'COMPLETED',
            processingStatus: 'COMPLETED',
            abstractedTerms: abstractedData.abstractedTerms,
            financialTerms: abstractedData.financialTerms,
            keyDates: abstractedData.keyDates,
            propertyDetails: abstractedData.propertyDetails,
            keyClauses: abstractedData.keyClauses,
            extractionConfidence: abstractedData.confidence,
            processingTimeMs,
            processedAt: new Date(),
          });

          logger.info('Lease abstraction completed', {
            leaseId,
            processingTimeMs,
            confidence: abstractedData.confidence,
          });

          // Step 3: Extract obligations if needed
          if (extractObligations && abstractedData.obligations) {
            try {
              logger.info('Extracting obligations from lease', { leaseId });
              await obligationService.createObligationsFromAbstraction(
                leaseId,
                abstractedData.obligations,
                'lease'
              );
            } catch (error: any) {
              logger.warn('Obligation extraction failed', {
                leaseId,
                error: error.message,
              });
              // Don't fail the whole process if obligations fail
            }
          }

          await eventPublisher.publishLeaseProcessed(leaseId, {
            processingTimeMs,
            confidence: abstractedData.confidence || 0,
          });

          return (await this.leaseRepository.findById(leaseId))!;
        } catch (error: any) {
          logger.error('Lease abstraction failed', {
            leaseId,
            error: error.message,
          });
          await this.leaseRepository.update(leaseId, {
            status: 'ERROR',
            processingError: `Abstraction failed: ${error.message}`,
            processingStatus: 'ERROR',
          });
          throw error;
        }
      }

      return (await this.leaseRepository.findById(leaseId))!;
    } catch (error: any) {
      logger.error('Lease processing failed', {
        leaseId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Process lease asynchronously (non-blocking)
   */
  async processLeaseAsync(
    leaseId: string,
    options?: ProcessLeaseOptions
  ): Promise<void> {
    setImmediate(async () => {
      try {
        await this.processLease(leaseId, options);
      } catch (error: any) {
        logger.error('Error in async lease processing', {
          leaseId,
          error: error.message,
        });
      }
    });
  }

  /**
   * Update lease
   */
  async updateLease(
    leaseId: string,
    data: UpdateLeaseData
  ): Promise<Lease> {
    try {
      return await this.leaseRepository.update(leaseId, {
        ...data,
        updatedAt: new Date(),
      });
    } catch (error: any) {
      logger.error('Failed to update lease', {
        leaseId,
        data,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Delete lease
   */
  async deleteLease(leaseId: string): Promise<void> {
    try {
      const lease = await this.leaseRepository.findById(leaseId);
      if (!lease) {
        throw new Error('Lease not found');
      }

      // Delete document from storage if exists
      if (lease.documentStorageKey) {
        try {
          await documentService.deleteDocument(lease.documentStorageKey);
        } catch (error: any) {
          logger.warn('Failed to delete document from storage', {
            storageKey: lease.documentStorageKey,
            error: error.message,
          });
        }
      }

      await this.leaseRepository.delete(leaseId);
      logger.info('Lease deleted', { leaseId });
    } catch (error: any) {
      logger.error('Failed to delete lease', {
        leaseId,
        error: error.message,
      });
      throw error;
    }
  }
}

export const leaseService = new LeaseService();
```

**Action Items:**
1. Create `src/services/leaseService.ts`
2. Update `src/services/leaseAbstractionService.ts` to use new `leaseService` or merge functionality
3. Test lease creation: Create a test lease with a file upload
4. Test lease processing: Process a lease and verify Cyrex integration

---

## Step 4: Contract Service Implementation

### 4.1 Create Contract Service

**File**: `src/services/contractService.ts`

Create a comprehensive contract service similar to lease service:

```typescript
import { ContractRepository, CreateContractData, UpdateContractData } from '../repositories/ContractRepository';
import { documentService } from './documentService';
import { cyrexClient } from './cyrexClient';
import { obligationService } from './obligationService';
import { eventPublisher } from '../streaming/eventPublisher';
import { logger } from '../utils/logger';
import type { Contract, ContractVersion } from '@prisma/client';

export interface CreateContractInput {
  contractNumber: string;
  contractName: string;
  partyA: string;
  partyB: string;
  contractType?: string;
  jurisdiction?: string;
  documentUrl?: string;
  documentFile?: Express.Multer.File;
  versionNumber?: number;
  userId?: string;
  organizationId?: string;
  tags?: string[];
  notes?: string;
}

export interface ProcessContractOptions {
  extractText?: boolean;
  abstractContract?: boolean;
  extractObligations?: boolean;
  extractClauses?: boolean;
}

export class ContractService {
  private contractRepository: ContractRepository;

  constructor() {
    this.contractRepository = new ContractRepository();
  }

  /**
   * Create contract record
   * Handles file upload if provided
   */
  async createContract(input: CreateContractInput): Promise<Contract> {
    try {
      let documentUrl = input.documentUrl;
      let documentStorageKey: string | undefined;
      let rawText: string | undefined;
      let fileSize: number | undefined;
      let documentType = 'PDF';

      // If file is provided, upload it
      if (input.documentFile) {
        logger.info('Uploading contract document', {
          fileName: input.documentFile.originalname,
          fileSize: input.documentFile.size,
        });

        const uploadResult = await documentService.uploadDocument(
          input.documentFile,
          'contracts'
        );

        documentUrl = uploadResult.url;
        documentStorageKey = uploadResult.storageKey;
        fileSize = uploadResult.fileSize;
        documentType = uploadResult.mimeType.includes('pdf') ? 'PDF' : 'DOCX';

        // Extract text immediately if file is small (< 5MB)
        if (fileSize < 5 * 1024 * 1024) {
          try {
            rawText = await documentService.extractText(
              documentUrl,
              documentType.toLowerCase(),
              input.documentFile.buffer
            );
            logger.info('Text extracted during upload', {
              textLength: rawText.length,
            });
          } catch (error: any) {
            logger.warn('Text extraction failed during upload', {
              error: error.message,
            });
          }
        }
      }

      // Create contract data
      const contractData: CreateContractData = {
        contractNumber: input.contractNumber,
        contractName: input.contractName,
        partyA: input.partyA,
        partyB: input.partyB,
        contractType: input.contractType,
        jurisdiction: input.jurisdiction,
        documentUrl: documentUrl!,
        documentStorageKey,
        rawText,
        documentType,
        fileSize,
        versionNumber: input.versionNumber || 1,
        userId: input.userId,
        organizationId: input.organizationId,
        tags: input.tags || [],
        notes: input.notes,
        status: 'PENDING',
      };

      const contract = await this.contractRepository.create(contractData);

      logger.info('Contract created', {
        contractId: contract.id,
        contractNumber: contract.contractNumber,
      });

      await eventPublisher.publishContractCreated(contract.id, contract.contractNumber);

      return contract;
    } catch (error: any) {
      logger.error('Failed to create contract', {
        input,
        error: error.message,
      });
      throw new Error(`Contract creation failed: ${error.message}`);
    }
  }

  /**
   * Get contract by ID
   */
  async getContract(contractId: string): Promise<Contract | null> {
    try {
      return await this.contractRepository.findByIdWithRelations(contractId);
    } catch (error: any) {
      logger.error('Failed to get contract', {
        contractId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * List contracts with filters
   */
  async listContracts(filters: {
    status?: string;
    partyName?: string;
    contractType?: string;
    userId?: string;
    organizationId?: string;
    skip?: number;
    take?: number;
  }): Promise<{ contracts: Contract[]; total: number }> {
    try {
      const where: any = {};

      if (filters.status) {
        where.status = filters.status;
      }

      if (filters.partyName) {
        where.OR = [
          { partyA: { contains: filters.partyName, mode: 'insensitive' } },
          { partyB: { contains: filters.partyName, mode: 'insensitive' } },
        ];
      }

      if (filters.contractType) {
        where.contractType = filters.contractType;
      }

      if (filters.userId) {
        where.userId = filters.userId;
      }

      if (filters.organizationId) {
        where.organizationId = filters.organizationId;
      }

      const [contracts, total] = await Promise.all([
        this.contractRepository.findMany(where, {
          skip: filters.skip || 0,
          take: filters.take || 50,
          orderBy: { createdAt: 'desc' },
        }),
        this.contractRepository.count(where),
      ]);

      return { contracts, total };
    } catch (error: any) {
      logger.error('Failed to list contracts', {
        filters,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Process contract (extract text, abstract, extract clauses and obligations)
   */
  async processContract(
    contractId: string,
    options: ProcessContractOptions = {}
  ): Promise<Contract> {
    const {
      extractText = true,
      abstractContract = true,
      extractObligations = true,
      extractClauses = true,
    } = options;

    try {
      // Get contract
      const contract = await this.contractRepository.findById(contractId);
      if (!contract) {
        throw new Error('Contract not found');
      }

      // Update status to PROCESSING
      await this.contractRepository.update(contractId, {
        status: 'PROCESSING',
        processingStatus: 'EXTRACTING_TEXT',
      });

      let rawText = contract.rawText;

      // Step 1: Extract text if needed
      if (extractText && !rawText && contract.documentStorageKey) {
        try {
          logger.info('Extracting text from contract document', { contractId });
          rawText = await documentService.downloadAndExtractText(
            contract.documentStorageKey,
            contract.documentType
          );

          await this.contractRepository.update(contractId, {
            rawText,
            processingStatus: 'TEXT_EXTRACTED',
          });
        } catch (error: any) {
          logger.error('Text extraction failed', {
            contractId,
            error: error.message,
          });
          await this.contractRepository.update(contractId, {
            status: 'ERROR',
            processingError: `Text extraction failed: ${error.message}`,
            processingStatus: 'ERROR',
          });
          throw error;
        }
      }

      if (!rawText) {
        throw new Error('No text available for processing');
      }

      // Step 2: Abstract contract using Cyrex
      if (abstractContract) {
        try {
          logger.info('Abstracting contract using Cyrex', { contractId });
          
          await this.contractRepository.update(contractId, {
            processingStatus: 'ABSTRACTING',
          });

          const startTime = Date.now();
          const cyrexResult = await cyrexClient.abstractContract({
            contractId: contract.id,
            documentText: rawText,
            documentUrl: contract.documentUrl,
            contractNumber: contract.contractNumber,
            partyA: contract.partyA,
            partyB: contract.partyB,
            versionNumber: contract.versionNumber || 1,
          });

          const processingTimeMs = Date.now() - startTime;
          const abstractedData = cyrexResult.data;

          // Update contract with abstracted terms
          await this.contractRepository.update(contractId, {
            status: 'COMPLETED',
            processingStatus: 'COMPLETED',
            abstractedTerms: abstractedData.abstractedTerms,
            keyClauses: abstractedData.clauses,
            financialTerms: abstractedData.financialTerms,
            extractionConfidence: abstractedData.confidence,
            processingTimeMs,
            processedAt: new Date(),
          });

          logger.info('Contract abstraction completed', {
            contractId,
            processingTimeMs,
            confidence: abstractedData.confidence,
          });

          // Step 3: Extract obligations if needed
          if (extractObligations && abstractedData.obligations) {
            try {
              logger.info('Extracting obligations from contract', { contractId });
              await obligationService.createObligationsFromAbstraction(
                contractId,
                abstractedData.obligations,
                'contract'
              );
            } catch (error: any) {
              logger.warn('Obligation extraction failed', {
                contractId,
                error: error.message,
              });
            }
          }

          await eventPublisher.publishContractProcessed(contractId, {
            processingTimeMs,
            confidence: abstractedData.confidence || 0,
          });

          return (await this.contractRepository.findById(contractId))!;
        } catch (error: any) {
          logger.error('Contract abstraction failed', {
            contractId,
            error: error.message,
          });
          await this.contractRepository.update(contractId, {
            status: 'ERROR',
            processingError: `Abstraction failed: ${error.message}`,
            processingStatus: 'ERROR',
          });
          throw error;
        }
      }

      return (await this.contractRepository.findById(contractId))!;
    } catch (error: any) {
      logger.error('Contract processing failed', {
        contractId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Process contract asynchronously
   */
  async processContractAsync(
    contractId: string,
    options?: ProcessContractOptions
  ): Promise<void> {
    setImmediate(async () => {
      try {
        await this.processContract(contractId, options);
      } catch (error: any) {
        logger.error('Error in async contract processing', {
          contractId,
          error: error.message,
        });
      }
    });
  }

  /**
   * Update contract
   */
  async updateContract(
    contractId: string,
    data: UpdateContractData
  ): Promise<Contract> {
    try {
      return await this.contractRepository.update(contractId, {
        ...data,
        updatedAt: new Date(),
      });
    } catch (error: any) {
      logger.error('Failed to update contract', {
        contractId,
        data,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Delete contract
   */
  async deleteContract(contractId: string): Promise<void> {
    try {
      const contract = await this.contractRepository.findById(contractId);
      if (!contract) {
        throw new Error('Contract not found');
      }

      // Delete document from storage if exists
      if (contract.documentStorageKey) {
        try {
          await documentService.deleteDocument(contract.documentStorageKey);
        } catch (error: any) {
          logger.warn('Failed to delete document from storage', {
            storageKey: contract.documentStorageKey,
            error: error.message,
          });
        }
      }

      await this.contractRepository.delete(contractId);
      logger.info('Contract deleted', { contractId });
    } catch (error: any) {
      logger.error('Failed to delete contract', {
        contractId,
        error: error.message,
      });
      throw error;
    }
  }
}

export const contractService = new ContractService();
```

**Action Items:**
1. Create `src/services/contractService.ts`
2. Update `src/services/contractIntelligenceService.ts` to use new `contractService` or merge functionality
3. Test contract creation: Create a test contract with file upload
4. Test contract processing: Process a contract and verify Cyrex integration

---

## Step 5: Integration and Testing

### 5.1 Update Routes to Use New Services

**File**: `src/routes/leaseRoutes.ts`

Update to use the new `leaseService`:

```typescript
import { Router, Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { leaseService } from '../services/leaseService';
import { authenticate } from './middleware/auth';
import { handleValidationErrors } from './middleware/validation';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * POST /api/v1/leases/upload
 * Upload lease document and create lease record
 */
router.post(
  '/upload',
  authenticate,
  upload.single('document'),
  [
    body('leaseNumber').notEmpty().trim(),
    body('tenantName').notEmpty().trim(),
    body('propertyAddress').notEmpty().trim(),
    body('startDate').isISO8601(),
    body('endDate').isISO8601(),
  ],
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      if (!req.file && !req.body.documentUrl) {
        return res.status(400).json({ 
          error: 'Either document file or documentUrl is required' 
        });
      }

      const lease = await leaseService.createLease({
        leaseNumber: req.body.leaseNumber,
        tenantName: req.body.tenantName,
        landlordName: req.body.landlordName,
        propertyAddress: req.body.propertyAddress,
        propertyType: req.body.propertyType,
        squareFootage: req.body.squareFootage ? parseInt(req.body.squareFootage) : undefined,
        startDate: req.body.startDate,
        endDate: req.body.endDate,
        documentFile: req.file,
        documentUrl: req.body.documentUrl,
        userId: req.user?.id,
        organizationId: req.user?.organizationId,
        tags: req.body.tags ? JSON.parse(req.body.tags) : undefined,
        notes: req.body.notes,
      });

      // Trigger async processing
      leaseService.processLeaseAsync(lease.id).catch((error) => {
        console.error('Failed to process lease', error);
      });

      res.status(201).json({
        success: true,
        data: lease,
      });
    } catch (error: any) {
      res.status(500).json({ 
        error: 'Failed to upload lease', 
        message: error.message 
      });
    }
  }
);

// Add other routes...
```

### 5.2 Testing Checklist

**Database Layer:**
- [ ] Test Prisma connection
- [ ] Test repository CRUD operations
- [ ] Test repository queries with filters
- [ ] Test transactions

**Document Service:**
- [ ] Test S3/MinIO upload
- [ ] Test PDF text extraction
- [ ] Test DOCX text extraction
- [ ] Test document download
- [ ] Test document deletion

**Lease Service:**
- [ ] Test lease creation with file upload
- [ ] Test lease creation with documentUrl
- [ ] Test lease processing pipeline
- [ ] Test lease listing with filters
- [ ] Test lease update
- [ ] Test lease deletion

**Contract Service:**
- [ ] Test contract creation with file upload
- [ ] Test contract creation with documentUrl
- [ ] Test contract processing pipeline
- [ ] Test contract listing with filters
- [ ] Test contract update
- [ ] Test contract deletion

### 5.3 Run Tests

```bash
# Build the project
npm run build

# Start the service
npm run dev

# Test endpoints using curl or Postman
# Example: Upload a lease
curl -X POST http://localhost:5003/api/v1/leases/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "document=@sample-lease.pdf" \
  -F "leaseNumber=LEASE-001" \
  -F "tenantName=Acme Corp" \
  -F "propertyAddress=123 Main St" \
  -F "startDate=2024-01-01" \
  -F "endDate=2026-12-31"
```

---

## Summary

This guide provides a complete implementation for:

1. **Database Layer**: Repository pattern with Prisma
2. **Document Service**: S3/MinIO upload with local PDF/DOCX extraction
3. **Lease Service**: Complete business logic with Cyrex integration
4. **Contract Service**: Complete business logic with Cyrex integration

All services follow the same pattern:
- Use repository pattern for data access
- Integrate with document service for file handling
- Call Cyrex for AI processing
- Publish events for real-time updates
- Handle errors gracefully

Next steps:
- Implement routes (already started)
- Add comprehensive error handling
- Add validation
- Add unit tests
- Add integration tests

