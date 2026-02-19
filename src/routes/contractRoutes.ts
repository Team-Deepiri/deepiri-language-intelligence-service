import { Router, Request, Response } from 'express';
import { body, param, query } from 'express-validator';
import multer from 'multer';
import { contractIntelligenceService } from '../services/contractIntelligenceService';
import { obligationService } from '../services/obligationService';
import { documentService } from '../services/documentService';
import { cyrexClient } from '../services/cyrexClient';
import { authenticate } from './middleware/auth';
import { validate, commonValidations } from '../middleware/inputValidation';
import { logger } from '../utils/logger';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

/**
 * POST /api/v1/contracts/upload
 */
router.post(
  '/upload',
  authenticate,
  upload.single('file'),
  validate([
    commonValidations.string('contractNumber', 100),
    commonValidations.string('contractName', 255),
    commonValidations.string('partyA', 255),
    commonValidations.string('partyB', 255),
    body('effectiveDate').isISO8601(),
    commonValidations.string('contractType', 100).optional(),
    commonValidations.string('jurisdiction', 100).optional(),
    commonValidations.string('notes', 1000).optional(),
    commonValidations.array('tags', 50).optional(),
  ]),
  async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      
      const uploadResult = await documentService.uploadDocument(file, 'contracts');
      
      const contract = await contractIntelligenceService.createContract({
        contractNumber: req.body.contractNumber,
        contractName: req.body.contractName,
        partyA: req.body.partyA,
        partyB: req.body.partyB,
        contractType: req.body.contractType,
        jurisdiction: req.body.jurisdiction,
        effectiveDate: new Date(req.body.effectiveDate),
        expirationDate: req.body.expirationDate ? new Date(req.body.expirationDate) : undefined,
        documentUrl: uploadResult.url,
        userId: req.user?.id,
        organizationId: req.user?.organizationId,
        tags: req.body.tags ? JSON.parse(req.body.tags) : [],
        notes: req.body.notes,
      });
      
      // Trigger async processing
      contractIntelligenceService.processContractAsync(contract.id).catch((error) => {
        logger.error('Failed to process contract asynchronously', { contractId: contract.id, error });
      });
      
      res.status(201).json({
        success: true,
        data: contract,
      });
    } catch (error: any) {
      logger.error('Error uploading contract', { error: error.message });
      res.status(500).json({ error: 'Failed to upload contract', message: error.message });
    }
  }
);

/**
 * GET /api/v1/contracts/:id
 */
router.get(
  '/:id',
  authenticate,
  validate([
    param('id').isUUID().withMessage('Invalid contract ID format')
  ]),
  async (req: Request, res: Response) => {
    try {
      const contract = await contractIntelligenceService.getContractById(req.params.id);
      if (!contract) {
        return res.status(404).json({ error: 'Contract not found' });
      }
      
      res.json({ success: true, data: contract });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to fetch contract', message: error.message });
    }
  }
);

/**
 * GET /api/v1/contracts/:id/clauses
 */
router.get(
  '/:id/clauses',
  authenticate,
  validate([
    param('id').isUUID().withMessage('Invalid contract ID format'),
    query('version').optional().isInt({ min: 1 }).withMessage('Version must be a positive integer')
  ]),
  async (req: Request, res: Response) => {
    try {
      const versionNumber = req.query.version 
        ? parseInt(req.query.version as string)
        : undefined;
      
      const clauses = await contractIntelligenceService.getClauses(req.params.id, versionNumber);
      
      res.json({
        success: true,
        data: clauses,
      });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to fetch clauses', message: error.message });
    }
  }
);

/**
 * GET /api/v1/contracts/:id/clauses/evolution
 */
router.get(
  '/:id/clauses/evolution',
  authenticate,
  validate([
    param('id').isUUID().withMessage('Invalid contract ID format'),
    query('fromVersion').optional().isInt({ min: 1 }).withMessage('fromVersion must be a positive integer'),
    query('toVersion').optional().isInt({ min: 1 }).withMessage('toVersion must be a positive integer')
  ]),
  async (req: Request, res: Response) => {
    try {
      const fromVersion = req.query.fromVersion 
        ? parseInt(req.query.fromVersion as string)
        : undefined;
      const toVersion = req.query.toVersion
        ? parseInt(req.query.toVersion as string)
        : undefined;
      
      // Get clauses for both versions and compare
      const fromClauses = await contractIntelligenceService.getClauses(
        req.params.id,
        fromVersion
      );
      const toClauses = await contractIntelligenceService.getClauses(
        req.params.id,
        toVersion
      );
      
      const evolutionResult = await cyrexClient.trackClauseEvolution({
        contractId: req.params.id,
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
        oldVersionNumber: fromVersion || 1,
        newVersionNumber: toVersion || 2,
      });
      
      const evolution = evolutionResult.data || evolutionResult;
      
      res.json({
        success: true,
        data: evolution,
      });
    } catch (error: any) {
      logger.error('Error fetching clause evolution', { error: error.message });
      res.status(500).json({ error: 'Failed to get clause evolution', message: error.message });
    }
  }
);

/**
 * GET /api/v1/contracts/:id/obligations/dependencies
 */
router.get(
  '/:id/obligations/dependencies',
  authenticate,
  validate([
  param('id').isUUID().withMessage('Invalid contract ID format')
]),
  async (req: Request, res: Response) => {
    try {
      const contractId = req.params.id;
      const includeLeases = req.query.includeLeases === 'true';
      
      // Get obligations
      const obligations = await obligationService.getObligationsByContractId(contractId);
      
      // Build dependency graph
      const graphResult = await cyrexClient.buildDependencyGraph({
        contractId,
        obligations: obligations.map(obl => ({
          id: obl.id,
          description: obl.description,
          obligationType: obl.obligationType,
        })),
      });
      
      res.json({
        success: true,
        data: graphResult.data,
      });
    } catch (error: any) {
      logger.error('Error building dependency graph', { error: error.message });
      res.status(500).json({ error: 'Failed to build dependency graph', message: error.message });
    }
  }
);

/**
 * GET /api/v1/obligations/:id/cascade
 */
router.get(
  '/obligations/:id/cascade',
  authenticate,
  validate([
    param('id').isUUID().withMessage('Invalid obligation ID format'),
    query('maxDepth').optional().isInt({ min: 1, max: 10 }).withMessage('maxDepth must be between 1 and 10')
  ]),
  async (req: Request, res: Response) => {
    try {
      const obligationId = req.params.id;
      const maxDepth = req.query.maxDepth 
        ? parseInt(req.query.maxDepth as string)
        : 5;
      
      const cascading = await cyrexClient.findCascadingObligations({
        obligationId,
        maxDepth,
      });
      
      res.json({
        success: true,
        data: cascading.data,
      });
    } catch (error: any) {
      logger.error('Error finding cascading obligations', { error: error.message });
      res.status(500).json({ error: 'Failed to find cascading obligations', message: error.message });
    }
  }
);

/**
 * POST /api/v1/contracts/:id/versions
 */
router.post(
  '/:id/versions',
  authenticate,
  upload.single('file'),
  validate([
    param('id').isUUID().withMessage('Invalid contract ID format'),
    body('versionNumber').optional().isInt({ min: 1 }).withMessage('versionNumber must be a positive integer')
  ]),
  async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      
      const version = await contractIntelligenceService.createContractVersion(
        req.params.id,
        file,
        req.body.versionNumber ? parseInt(req.body.versionNumber) : undefined
      );
      
      res.status(201).json({
        success: true,
        data: version,
      });
    } catch (error: any) {
      logger.error('Error uploading contract version', { contractId: req.params.id, error: error.message });
      res.status(500).json({ error: 'Failed to upload contract version', message: error.message });
    }
  }
);

/**
 * GET /api/v1/contracts/:id/versions/:versionId/diff
 */
router.get(
  '/:id/versions/:versionId/diff',
  authenticate,
  validate([
    param('id').isUUID().withMessage('Invalid contract ID format'),
    param('versionId').isUUID().withMessage('Invalid version ID format'),
    query('compareTo').optional().isInt({ min: 1 }).withMessage('compareTo must be a positive integer')
  ]),
  async (req: Request, res: Response) => {
    try {
      const diff = await contractIntelligenceService.compareVersions(
        req.params.id,
        req.params.versionId,
        req.query.compareTo ? parseInt(req.query.compareTo as string) : undefined
      );
      
      res.json({ success: true, data: diff });
    } catch (error: any) {
      logger.error('Error comparing versions', { error: error.message });
      res.status(500).json({ error: 'Failed to compare versions', message: error.message });
    }
  }
);

/**
 * GET /api/v1/contracts
 */
router.get(
  '/',
  authenticate,
  validate([
  query('status').optional().isIn(['active', 'inactive', 'draft', 'archived']).withMessage('Invalid status'),
  query('contractType').optional().isLength({ max: 100 }).withMessage('contractType must be less than 100 characters')
]),

  async (req: Request, res: Response) => {
    try {
      const contracts = await contractIntelligenceService.listContracts({
        userId: req.user?.id,
        organizationId: req.user?.organizationId,
        status: req.query.status as string,
        contractType: req.query.contractType as string,
      });
      
      res.json({ success: true, data: contracts });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to list contracts', message: error.message });
    }
  }
);

export default router;

