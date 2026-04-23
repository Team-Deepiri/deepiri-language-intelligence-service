import { Router, Request, Response } from 'express';
import { body, param, query } from 'express-validator';
import multer from 'multer';
import { leaseAbstractionService } from '../services/leaseAbstractionService';
import { obligationService } from '../services/obligationService';
import { documentService } from '../services/documentService';
import { authenticate } from './middleware/auth';
import { handleValidationErrors } from './middleware/validation';
import { logger } from '@team-deepiri/shared-utils';
import { validate, commonValidations } from '../middleware/inputValidation';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

/**
 * POST /api/v1/leases/upload
 */
router.post(
  '/upload',
  authenticate,
  upload.single('file'),
  validate([
    commonValidations.string('leaseNumber', 100),
    commonValidations.string('tenantName', 255),
    commonValidations.string('landlordName', 255).optional(),
    commonValidations.string('propertyAddress', 500),
    commonValidations.string('propertyType', 100).optional(),
    body('squareFootage').optional().isInt({ min: 1, max: 1000000 }).withMessage('squareFootage must be between 1 and 1,000,000'),
    body('startDate').isISO8601(),
    body('endDate').isISO8601(),
    commonValidations.string('notes', 1000).optional(),
    commonValidations.array('tags', 50).optional(),
  ]),
  async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      
      const uploadResult = await documentService.uploadDocument(file, 'leases');
      
      const lease = await leaseAbstractionService.createLease({
        leaseNumber: req.body.leaseNumber,
        tenantName: req.body.tenantName,
        landlordName: req.body.landlordName,
        propertyAddress: req.body.propertyAddress,
        propertyType: req.body.propertyType,
        squareFootage: req.body.squareFootage ? parseInt(req.body.squareFootage) : undefined,
        startDate: new Date(req.body.startDate),
        endDate: new Date(req.body.endDate),
        documentUrl: uploadResult.url,
        userId: req.user?.id,
        organizationId: req.user?.organizationId,
        tags: req.body.tags ? JSON.parse(req.body.tags) : [],
        notes: req.body.notes,
      });
      
      // Trigger async processing
      leaseAbstractionService.processLeaseAsync(lease.id).catch((error) => {
        logger.error('Failed to process lease asynchronously', { leaseId: lease.id, error });
      });
      
      res.status(201).json({
        success: true,
        data: lease,
      });
    } catch (error: any) {
      logger.error('Error uploading lease', { error: error.message });
      res.status(500).json({ error: 'Failed to upload lease', message: error.message });
    }
  }
);

/**
 * GET /api/v1/leases/:id
 */
router.get(
  '/:id',
  authenticate,
  validate([
    param('id').isUUID().withMessage('Invalid lease ID format')
  ]),
  async (req: Request, res: Response) => {
    try {
      const lease = await leaseAbstractionService.getLeaseById(req.params.id);
      if (!lease) {
        return res.status(404).json({ error: 'Lease not found' });
      }
      
      res.json({ success: true, data: lease });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to fetch lease', message: error.message });
    }
  }
);

/**
 * GET /api/v1/leases/:id/obligations
 */
router.get(
  '/:id/obligations',
  authenticate,
  validate([
    param('id').isUUID().withMessage('Invalid lease ID format')
  ]),
  async (req: Request, res: Response) => {
    try {
      const obligations = await obligationService.getObligationsByLeaseId(req.params.id);
      res.json({ success: true, data: obligations });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to fetch obligations', message: error.message });
    }
  }
);

/**
 * POST /api/v1/leases/:id/versions
 */
router.post(
  '/:id/versions',
  authenticate,
  upload.single('file'),
  validate([
    param('id').isUUID().withMessage('Invalid lease ID format'),
    body('versionNumber').optional().isInt({ min: 1 }).withMessage('versionNumber must be a positive integer')
  ]),
  async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      
      const version = await leaseAbstractionService.createLeaseVersion(
        req.params.id,
        file,
        req.body.versionNumber ? parseInt(req.body.versionNumber) : undefined
      );
      
      res.status(201).json({
        success: true,
        data: version,
      });
    } catch (error: any) {
      logger.error('Error uploading lease version', { leaseId: req.params.id, error: error.message });
      res.status(500).json({ error: 'Failed to upload lease version', message: error.message });
    }
  }
);

/**
 * GET /api/v1/leases/:id/versions/:versionId/diff
 */
router.get(
  '/:id/versions/:versionId/diff',
  authenticate,
  validate([
    param('id').isUUID().withMessage('Invalid lease ID format'),
    param('versionId').isUUID().withMessage('Invalid version ID format'),
    query('compareTo').optional().isInt({ min: 1 }).withMessage('compareTo must be a positive integer')
  ]),
  async (req: Request, res: Response) => {
    try {
      const diff = await leaseAbstractionService.compareVersions(
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
 * GET /api/v1/leases
 */
router.get(
  '/',
  authenticate,
  validate([
    query('status').optional().isIn(['active', 'inactive', 'draft', 'expired', 'terminated']).withMessage('Invalid status'),
    query('tenantName').optional().isLength({ max: 255 }).withMessage('tenantName must be less than 255 characters')
  ]),
  async (req: Request, res: Response) => {
    try {
      const leases = await leaseAbstractionService.listLeases({
        userId: req.user?.id,
        organizationId: req.user?.organizationId,
        status: req.query.status as string,
        tenantName: req.query.tenantName as string,
      });
      
      res.json({ success: true, data: leases });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to list leases', message: error.message });
    }
  }
);

export default router;

