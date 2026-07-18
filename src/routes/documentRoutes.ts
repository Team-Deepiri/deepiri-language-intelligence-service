import { Router, Request, Response } from 'express';
import { body, param, query } from 'express-validator';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { intelligenceDocumentService } from '../services/intelligenceDocumentService';
import { obligationService } from '../services/obligationService';
import { documentService, resolveFileDocumentType } from '../services/documentService';
import { authenticate } from './middleware/auth';
import { logger } from '@team-deepiri/shared-utils';
import { validate } from '../middleware/inputValidation';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const uploadRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many upload requests, please try again later.' },
});
const listRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
const documentReadRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many document read requests, please try again later.' },
});
const reprocessRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many document reprocess requests, please try again later.' },
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

function requestScope(req: Request) {
  return {
    userId: req.user?.id,
    organizationId: req.user?.organizationId,
  };
}

function parseTags(raw: unknown): string[] {
  if (raw === undefined || raw === null || raw === '') return [];
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(value)) {
    throw new Error('Invalid JSON for tags');
  }
  return value.filter((tag): tag is string => typeof tag === 'string');
}

router.post(
  '/upload',
  uploadRateLimiter,
  authenticate,
  upload.single('file'),
  validate([
    body('documentKey')
      .isString()
      .trim()
      .isLength({ min: 1, max: 200 })
      .withMessage('documentKey is required and must be at most 200 characters'),
    body('documentKind')
      .isString()
      .trim()
      .isLength({ min: 1, max: 120 })
      .withMessage('documentKind is required and must be at most 120 characters'),
    body('intelligenceProfile')
      .isString()
      .trim()
      .isLength({ min: 1, max: 120 })
      .withMessage('intelligenceProfile is required and must be at most 120 characters'),
    body('notes').optional().isString().isLength({ max: 1000 }),
    body('tags').optional().custom((value) => {
      const tags = parseTags(value);
      if (tags.length > 50) throw new Error('tags must include at most 50 entries');
      return true;
    }),
    body('profileHints').optional().custom((value) => {
      parseOptionalJson(value, 'profileHints');
      return true;
    }),
    body('metadata').optional().custom((value) => {
      parseOptionalJson(value, 'metadata');
      return true;
    }),
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

      const tags = parseTags(req.body.tags);

      const row = await intelligenceDocumentService.create({
        documentKey: req.body.documentKey,
        documentKind: req.body.documentKind,
        intelligenceProfile: req.body.intelligenceProfile,
        profileHints,
        documentUrl: uploadResult.url,
        documentStorageKey: uploadResult.storageKey,
        fileSize: uploadResult.fileSize,
        documentType: resolveFileDocumentType(
          uploadResult.mimeType,
          file.originalname || uploadResult.storageKey
        ),
        userId: req.user?.id,
        organizationId: req.user?.organizationId,
        tags,
        notes: req.body.notes,
        metadata,
      });

      const correlationId = (req as any).requestId as string | undefined;
      intelligenceDocumentService.processDocumentAsync(row.id, correlationId, requestScope(req)).catch((error) => {
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

router.get(
  '/:id',
  documentReadRateLimiter,
  authenticate,
  validate([param('id').isUUID().withMessage('Invalid document ID format')]),
  async (req: Request, res: Response) => {
    try {
      const row = await intelligenceDocumentService.getById(req.params.id, requestScope(req));
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
  documentReadRateLimiter,
  authenticate,
  validate([param('id').isUUID().withMessage('Invalid document ID format')]),
  async (req: Request, res: Response) => {
    try {
      const versions = await intelligenceDocumentService.getVersions(req.params.id, requestScope(req));
      res.json({ success: true, data: versions });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to fetch versions', message: error.message });
    }
  }
);

router.get(
  '/:id/obligations',
  documentReadRateLimiter,
  authenticate,
  validate([param('id').isUUID().withMessage('Invalid document ID format')]),
  async (req: Request, res: Response) => {
    try {
      const row = await intelligenceDocumentService.getById(req.params.id, requestScope(req));
      if (!row) {
        return res.status(404).json({ error: 'Document not found' });
      }

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
      const row = await intelligenceDocumentService.getById(req.params.id, requestScope(req));
      if (!row) {
        return res.status(404).json({ error: 'Document not found' });
      }

      intelligenceDocumentService.processDocumentAsync(req.params.id, correlationId, requestScope(req)).catch((error) => {
        logger.error('Reprocess failed', { documentId: req.params.id, error: error.message });
      });
      res.status(202).json({ success: true, message: 'Processing started' });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to start reprocess', message: error.message });
    }
  }
);

export default router;
