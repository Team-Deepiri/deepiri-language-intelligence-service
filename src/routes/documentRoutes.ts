import { Router, Request, Response } from 'express';
import { param, query } from 'express-validator';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { intelligenceDocumentService } from '../services/intelligenceDocumentService';
import { obligationService } from '../services/obligationService';
import { documentService } from '../services/documentService';
import { authenticate } from './middleware/auth';
import { logger } from '@deepiri/shared-utils';
import { validate, commonValidations } from '../middleware/inputValidation';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const listRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
const uploadRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many upload requests, please try again later.' },
});

function parseOptionalJson<T>(raw: unknown, label: string): T | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'object') return raw as T;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error(`Invalid JSON for ${label}`);
    }
  }
  return undefined;
}

router.post(
  '/upload',
  authenticate,
  uploadRateLimiter,
  upload.single('file'),
  validate([
    commonValidations.string('documentKey', 200),
    commonValidations.string('documentKind', 120),
    commonValidations.string('intelligenceProfile', 120),
    commonValidations.string('notes', 1000).optional(),
    commonValidations.array('tags', 50).optional(),
  ]),
  async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const profileHints = parseOptionalJson<Record<string, unknown>>(req.body.profileHints, 'profileHints');
      const metadata = parseOptionalJson<Record<string, unknown>>(req.body.metadata, 'metadata');

      const uploadResult = await documentService.uploadDocument(file, 'documents');

      const tags =
        req.body.tags !== undefined
          ? typeof req.body.tags === 'string'
            ? JSON.parse(req.body.tags)
            : req.body.tags
          : [];

      const row = await intelligenceDocumentService.create({
        documentKey: req.body.documentKey,
        documentKind: req.body.documentKind,
        intelligenceProfile: req.body.intelligenceProfile,
        profileHints,
        documentUrl: uploadResult.url,
        documentStorageKey: uploadResult.storageKey,
        fileSize: uploadResult.fileSize,
        documentType: uploadResult.mimeType?.includes('pdf')
          ? 'PDF'
          : uploadResult.mimeType?.includes('word')
            ? 'DOCX'
            : 'PDF',
        userId: req.user?.id,
        organizationId: req.user?.organizationId,
        tags,
        notes: req.body.notes,
        metadata,
      });

      const correlationId = (req as any).requestId as string | undefined;
      intelligenceDocumentService.processDocumentAsync(row.id, correlationId).catch((error) => {
        logger.error('Failed to process document asynchronously', {
          documentId: row.id,
          error: error.message,
        });
      });

      res.status(201).json({ success: true, data: row });
    } catch (error: any) {
      logger.error('Error uploading document', { error: error.message });
      res.status(500).json({ error: 'Failed to upload document', message: error.message });
    }
  }
);

router.get(
  '/',
  listRateLimiter,
  authenticate,
  validate([
    query('documentKind').optional().isString(),
    query('status').optional().isString(),
  ]),
  async (req: Request, res: Response) => {
    try {
      const rows = await intelligenceDocumentService.list({
        userId: req.user?.id,
        organizationId: req.user?.organizationId,
        documentKind: req.query.documentKind as string | undefined,
        status: req.query.status as string | undefined,
      });
      res.json({ success: true, data: rows });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to list documents', message: error.message });
    }
  }
);

const getByIdRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many document fetch requests, please try again later.' },
});

const documentRelatedFetchRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many related document fetch requests, please try again later.' },
});

const versionsFetchRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many document versions fetch requests, please try again later.' },
});

const reprocessRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reprocess requests, please try again later.' },
});

router.get(
  '/:id',
  authenticate,
  getByIdRateLimiter,
  validate([param('id').isUUID().withMessage('Invalid document ID format')]),
  async (req: Request, res: Response) => {
    try {
      const row = await intelligenceDocumentService.getById(req.params.id);
      if (!row) {
        return res.status(404).json({ error: 'Document not found' });
      }
      res.json({ success: true, data: row });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to fetch document', message: error.message });
    }
  }
);

router.get(
  '/:id/versions',
  versionsFetchRateLimiter,
  authenticate,
  validate([param('id').isUUID().withMessage('Invalid document ID format')]),
  async (req: Request, res: Response) => {
    try {
      const versions = await intelligenceDocumentService.getVersions(req.params.id);
      res.json({ success: true, data: versions });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to fetch versions', message: error.message });
    }
  }
);

router.get(
  '/:id/obligations',
  authenticate,
  documentRelatedFetchRateLimiter,
  validate([param('id').isUUID().withMessage('Invalid document ID format')]),
  async (req: Request, res: Response) => {
    try {
      const obligations = await obligationService.getObligationsByIntelligenceDocumentId(req.params.id);
      res.json({ success: true, data: obligations });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to fetch obligations', message: error.message });
    }
  }
);

router.post(
  '/:id/reprocess',
  reprocessRateLimiter,
  authenticate,
  validate([param('id').isUUID().withMessage('Invalid document ID format')]),
  async (req: Request, res: Response) => {
    try {
      const correlationId = (req as any).requestId as string | undefined;
      intelligenceDocumentService.processDocumentAsync(req.params.id, correlationId).catch((error) => {
        logger.error('Reprocess failed', { documentId: req.params.id, error: error.message });
      });
      res.status(202).json({ success: true, message: 'Processing started' });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to start reprocess', message: error.message });
    }
  }
);

export default router;
