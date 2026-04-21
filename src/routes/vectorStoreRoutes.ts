import { Router, Request, Response } from 'express';
import { param, body, query } from 'express-validator';
import axios from 'axios';
import rateLimit from 'express-rate-limit';
import { config } from '../config/environment';
import { secureLog } from '@deepiri/shared-utils';
import { authenticate } from './middleware/auth';
import { validate } from '../middleware/inputValidation';

const router = Router();

const documentSearchRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

// ============================================================================
// Collection Types for Language Intelligence Platform
// ============================================================================

export enum CollectionType {
  REGULATORY_DOCUMENTS = 'regulatory_documents',
  INTELLIGENCE_DOCUMENTS = 'intelligence_documents',
  OBLIGATIONS = 'obligations',
  COMPLIANCE_PATTERNS = 'compliance_patterns',
  VERSION_DRIFT = 'version_drift',
  KNOWLEDGE_BASE = 'knowledge_base',
}

const COLLECTION_NAMES: Record<CollectionType, string> = {
  [CollectionType.REGULATORY_DOCUMENTS]: 'regulatory_documents',
  [CollectionType.INTELLIGENCE_DOCUMENTS]: 'intelligence_documents',
  [CollectionType.OBLIGATIONS]: 'obligations',
  [CollectionType.COMPLIANCE_PATTERNS]: 'compliance_patterns',
  [CollectionType.VERSION_DRIFT]: 'version_drift',
  [CollectionType.KNOWLEDGE_BASE]: 'knowledge_base',
};

// Cyrex client for document operations
const cyrexClient = axios.create({
  baseURL: config.cyrex.baseUrl,
  timeout: 120000,
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': config.cyrex.apiKey,
  },
});

// ============================================================================
// Collection Management Endpoints
// ============================================================================

/**
 * GET /api/v1/vector-store/collections/types
 * Get all available collection types
 */
router.get(
  '/collections/types',
  authenticate,
  validate([]),
  (req: Request, res: Response) => {
    res.json({
      collection_types: Object.values(CollectionType),
      collections: COLLECTION_NAMES,
      description: 'Available vector collections for language intelligence',
    });
  }
);

/**
 * GET /api/v1/vector-store/collections
 * List all collections
 */
router.get(
  '/collections',
  authenticate,
  validate([]),
  async (req: Request, res: Response) => {
    try {
      const response = await cyrexClient.get('/api/v1/documents/collections');
      res.json(response.data);
    } catch (error: any) {
      secureLog('error', 'List collections error:', error);
      res.status(500).json({ error: 'Failed to list collections', details: error.message });
    }
  }
);

/**
 * GET /api/v1/vector-store/collections/:collectionName/stats
 * Get collection statistics
 */
router.get(
  '/collections/:collectionName/stats',
  documentSearchRateLimiter,
  authenticate,
  validate([param('collectionName').notEmpty().isString()]),
  async (req: Request, res: Response) => {
    try {
      const { collectionName } = req.params;
      const response = await cyrexClient.get('/api/v1/documents/stats', {
        params: { collection_name: collectionName },
      });
      res.json(response.data);
    } catch (error: any) {
      secureLog('error', 'Get collection stats error:', error);
      res.status(500).json({ error: 'Failed to get collection statistics', details: error.message });
    }
  }
);

/**
 * POST /api/v1/vector-store/collections/:collectionName
 * Create/verify collection (collections are auto-created when documents are added)
 */
router.post(
  '/collections/:collectionName',
  authenticate,
  validate([param('collectionName').notEmpty().isString()]),
  async (req: Request, res: Response) => {
    try {
      const { collectionName } = req.params;
      // Collections are auto-created by Milvus when documents are added
      // This endpoint can verify collection exists or trigger creation
      res.json({
        message: 'Collection will be created automatically when documents are added',
        collection_name: collectionName,
      });
    } catch (error: any) {
      secureLog('error', 'Create collection error:', error);
      res.status(500).json({ error: 'Failed to create collection', details: error.message });
    }
  }
);

// ============================================================================
// Document Management Endpoints
// ============================================================================

/**
 * POST /api/v1/vector-store/collections/:collectionName/documents
 * Add documents to a collection
 */
router.post(
  '/collections/:collectionName/documents',
  authenticate,
  validate([
    param('collectionName').notEmpty().isString(),
    body('documents').isArray().notEmpty(),
    body('documents.*.content').optional().isString(),
    body('documents.*.text').optional().isString(),
    body('metadata').optional().isObject(),
  ]),
  async (req: Request, res: Response) => {
    try {
      const { collectionName } = req.params;
      const { documents, metadata } = req.body;

      // Combine document content
      const combinedText = documents
        .map((d: any) => d.content || d.text)
        .filter(Boolean)
        .join('\n\n');

      if (!combinedText) {
        return res.status(400).json({ error: 'No document content provided' });
      }

      // Route to Cyrex document indexing endpoint
      const response = await cyrexClient.post('/api/v1/documents/index/text', {
        text: combinedText,
        document_id: metadata?.document_id,
        title: metadata?.title || 'Document',
        doc_type: collectionName,
        industry: 'language_intelligence',
        metadata: {
          ...metadata,
          collection_type: collectionName,
          added_at: new Date().toISOString(),
          added_by: req.user?.id,
          organization_id: req.user?.organizationId,
        },
      });

      res.json({
        success: true,
        collection_name: collectionName,
        document_ids: response.data.document_ids || [],
        message: 'Documents added successfully',
      });
    } catch (error: any) {
      secureLog('error', 'Add documents error:', error);
      res.status(500).json({ error: 'Failed to add documents', details: error.message });
    }
  }
);

/**
 * DELETE /api/v1/vector-store/collections/:collectionName/documents
 * Remove documents from a collection
 */
router.delete(
  '/collections/:collectionName/documents',
  authenticate,
  validate([
    param('collectionName').notEmpty().isString(),
    body('document_ids').isArray().notEmpty(),
    body('document_ids.*').isString(),
  ]),
  async (req: Request, res: Response) => {
    try {
      const { collectionName } = req.params;
      const { document_ids } = req.body;

      // Use Cyrex batch document deletion endpoint
      await cyrexClient.post('/api/v1/documents/delete/batch', { document_ids });

      res.json({
        success: true,
        collection_name: collectionName,
        deleted_count: document_ids.length,
        message: 'Documents deleted successfully',
      });
    } catch (error: any) {
      secureLog('error', 'Delete documents error:', error);
      res.status(500).json({ error: 'Failed to delete documents', details: error.message });
    }
  }
);

/**
 * GET /api/v1/vector-store/collections/:collectionName/documents
 * View/search documents in a collection
 */
router.get(
  '/collections/:collectionName/documents',
  authenticate,
  documentSearchRateLimiter,
  validate([
    param('collectionName').notEmpty().isString(),
    query('query').optional().isString(),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('offset').optional().isInt({ min: 0 }),
  ]),
  async (req: Request, res: Response) => {
    try {
      const { collectionName } = req.params;
      const { query: searchQuery, limit = 10 } = req.query;

      if (searchQuery) {
        // Search documents
        const response = await cyrexClient.post('/api/v1/documents/search', {
          query: searchQuery as string,
          doc_types: [collectionName],
          top_k: parseInt(limit as string, 10),
          metadata_filters: { collection_type: collectionName },
        });

        res.json({
          collection_name: collectionName,
          query: searchQuery,
          results: response.data.results || response.data,
          count: response.data.results?.length || 0,
        });
      } else {
        // List documents info
        res.json({
          collection_name: collectionName,
          message: 'Use search endpoint with query parameter to retrieve documents',
          suggestion: 'POST /api/v1/vector-store/collections/:collectionName/documents/search',
        });
      }
    } catch (error: any) {
      secureLog('error', 'View documents error:', error);
      res.status(500).json({ error: 'Failed to retrieve documents', details: error.message });
    }
  }
);

/**
 * POST /api/v1/vector-store/collections/:collectionName/documents/search
 * Search documents in a collection
 */
router.post(
  '/collections/:collectionName/documents/search',
  authenticate,
  documentSearchRateLimiter,
  validate([
    param('collectionName').notEmpty().isString(),
    body('query').notEmpty().isString(),
    body('top_k').optional().isInt({ min: 1, max: 100 }),
    body('metadata_filters').optional().isObject(),
  ]),
  async (req: Request, res: Response) => {
    try {
      const { collectionName } = req.params;
      const { query, top_k = 10, metadata_filters } = req.body;

      const response = await cyrexClient.post('/api/v1/documents/search', {
        query,
        doc_types: [collectionName],
        top_k,
        metadata_filters: {
          ...metadata_filters,
          collection_type: collectionName,
        },
      });

      res.json({
        collection_name: collectionName,
        query,
        results: response.data.results || response.data,
        count: response.data.results?.length || 0,
      });
    } catch (error: any) {
      secureLog('error', 'Search documents error:', error);
      res.status(500).json({ error: 'Failed to search documents', details: error.message });
    }
  }
);

export default router;


