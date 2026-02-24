import { Router, Request, Response } from 'express';
import { body, param, query } from 'express-validator';
import { authenticate, requireRole } from './middleware/auth';
import { handleValidationErrors } from './middleware/validation';
import { obligationService } from '../services/obligationService';
import { dependencyGraphService } from '../services/dependencyGraphService';

const router = Router();

/**
 * GET /api/v1/obligations/
 */

router.get(
    '/',
    authenticate,
    requireRole('admin', 'moderator', 'developer', 'user'),
    [
        query('leaseId').optional().isUUID(),
        query('contractId').optional().isUUID(),
        query('status').optional().isString(),
        query('obligationType').optional().isString(),
        query('overdue').optional().isBoolean().toBoolean(),
        query('owner').optional().isString(),
    ],
    handleValidationErrors,
    async (req: Request, res: Response) => {
        try {
            const obligations = await obligationService.listObligations({
                leaseId: req.query.leaseId as string | undefined,
                contractId: req.query.contractId as string | undefined,
                status: req.query.status as string | undefined,
                obligationType: req.query.obligationType as string | undefined,
                overdue: req.query.overdue as boolean | undefined,
                owner: req.query.owner as string | undefined,
            });

            res.json({ success: true, data: obligations });
        } catch (error: any) {
            res.status(500).json({
                error: 'Failed to list obligations',
                message: error.message,
            });
        }
    }
);

/**
 * POST /api/v1/obligations
 */
router.post(
    '/',
    authenticate,
    requireRole('admin', 'developer'),
    [
        body('leaseId').optional().isUUID(),
        body('contractId').optional().isUUID(),
        body('description').notEmpty().isString(),
        body('obligationType').notEmpty().isString(),
        body('party').optional().isString(),
        body('deadline').optional().isISO8601(),
        body('startDate').optional().isISO8601(),
        body('endDate').optional().isISO8601(),
        body('frequency').optional().isString(),
        body('amount').optional().isNumeric(),
        body('currency').optional().isString(),
        body('sourceClause').optional().isString(),
        body('confidence').optional().isFloat({ min: 0, max: 1 }),
        body('tags').optional().isArray(),
        body('notes').optional().isString(),
    ],
    handleValidationErrors,
    async (req: Request, res: Response) => {
        try {
            if (!req.body.leaseId && !req.body.contractId) {
                return res.status(400).json({
                    error: 'Either leaseId or contractId is required',
                });
            }

            const obligation = await obligationService.createObligation({
                leaseId: req.body.leaseId,
                contractId: req.body.contractId,
                description: req.body.description,
                obligationType: req.body.obligationType,
                party: req.body.party,
                deadline: req.body.deadline ? new Date(req.body.deadline) : undefined,
                startDate: req.body.startDate ? new Date(req.body.startDate) : undefined,
                endDate: req.body.endDate ? new Date(req.body.endDate) : undefined,
                frequency: req.body.frequency,
                amount: req.body.amount !== undefined ? Number(req.body.amount) : undefined,
                currency: req.body.currency,
                sourceClause: req.body.sourceClause,
                confidence: req.body.confidence !== undefined ? Number(req.body.confidence) : undefined,
                tags: req.body.tags,
                notes: req.body.notes,
            });

            res.status(201).json({ success: true, data: obligation });
        } catch (error: any) {
            res.status(500).json({
                error: 'Failed to create obligation',
                message: error.message,
            });
        }
    }
);

/**
 * GET /api/v1/obligations/:id
 */
router.get(
    '/:id',
    authenticate,
    requireRole('admin', 'moderator', 'developer', 'user'),
    [param('id').isUUID()],
    handleValidationErrors,
    async (req: Request, res: Response) => {
        try {
            const obligation = await obligationService.getObligation(req.params.id);
            res.json({ success: true, data: obligation });
        } catch (error: any) {
            const statusCode = error.message === 'Obligation not found' ? 404 : 500;
            res.status(statusCode).json({
                error: 'Failed to fetch obligation',
                message: error.message,
            });
        }
    }
);

/**
 * GET /api/v1/obligations/:id/dependencies
 */

router.get(
    '/:id/dependencies',
    authenticate,
    requireRole('admin', 'moderator', 'developer', 'user'),
    [param('id').isUUID(), query('maxDepth').optional().isInt({ min: 1, max: 25 })],
    handleValidationErrors,
    async (req: Request, res: Response) => {
        try {
            const maxDepth = req.query.maxDepth
                ? parseInt(req.query.maxDepth as string, 10)
                : 5;

            const dependencies = await dependencyGraphService.findCascadingObligations(
                req.params.id,
                maxDepth
            );

            res.json({ success: true, data: dependencies });
        } catch (error: any) {
            res.status(500).json({
                error: 'Failed to fetch obligation dependencies',
                message: error.message,
            });
        }
    }
);

/**
 * GET /api/v1/obligations/:id/dependencies/direct
 */
router.get(
    '/:id/dependencies/direct',
    authenticate,
    requireRole('admin', 'moderator', 'developer', 'user'),
    [
        param('id').isUUID(),
        query('direction').optional().isIn(['source', 'target', 'both']),
    ],
    handleValidationErrors,
    async (req: Request, res: Response) => {
        try {
            const direction = (req.query.direction as 'source' | 'target' | 'both') || 'both';
            const dependencies = await obligationService.listDependencies(
                req.params.id,
                direction
            );

            res.json({ success: true, data: dependencies });
        } catch (error: any) {
            res.status(500).json({
                error: 'Failed to fetch obligation dependencies',
                message: error.message,
            });
        }
    }
);

/**
 * POST /api/v1/obligations/:id/dependencies
 */
router.post(
    '/:id/dependencies',
    authenticate,
    requireRole('admin', 'developer'),
    [
        param('id').isUUID(),
        body('targetObligationId').notEmpty().isUUID(),
        body('dependencyType').optional().isString(),
        body('description').optional().isString(),
        body('confidence').optional().isFloat({ min: 0, max: 1 }),
        body('sourceClause').optional().isString(),
        body('targetClause').optional().isString(),
        body('triggerCondition').optional().isString(),
        body('sourceContractId').optional().isUUID(),
        body('targetContractId').optional().isUUID(),
        body('sourceLeaseId').optional().isUUID(),
        body('targetLeaseId').optional().isUUID(),
        body('discoveredBy').optional().isString(),
    ],
    handleValidationErrors,
    async (req: Request, res: Response) => {
        try {
            const dependency = await obligationService.createDependency({
                sourceObligationId: req.params.id,
                targetObligationId: req.body.targetObligationId,
                dependencyType: req.body.dependencyType,
                description: req.body.description,
                confidence: req.body.confidence !== undefined ? Number(req.body.confidence) : undefined,
                sourceClause: req.body.sourceClause,
                targetClause: req.body.targetClause,
                triggerCondition: req.body.triggerCondition,
                sourceContractId: req.body.sourceContractId,
                targetContractId: req.body.targetContractId,
                sourceLeaseId: req.body.sourceLeaseId,
                targetLeaseId: req.body.targetLeaseId,
                discoveredBy: req.body.discoveredBy,
            });

            res.status(201).json({ success: true, data: dependency });
        } catch (error: any) {
            res.status(500).json({
                error: 'Failed to create obligation dependency',
                message: error.message,
            });
        }
    }
);

/**
 * DELETE /api/v1/obligations/:id/dependencies/:targetId
 */
router.delete(
    '/:id/dependencies/:targetId',
    authenticate,
    requireRole('admin', 'developer'),
    [param('id').isUUID(), param('targetId').isUUID()],
    handleValidationErrors,
    async (req: Request, res: Response) => {
        try {
            const dependency = await obligationService.deleteDependency(
                req.params.id,
                req.params.targetId
            );

            res.json({ success: true, data: dependency });
        } catch (error: any) {
            res.status(500).json({
                error: 'Failed to delete obligation dependency',
                message: error.message,
            });
        }
    }
);

/**
 * PATCH /api/v1/obligations/:id
 */
router.patch(
    '/:id',
    authenticate,
    requireRole('admin', 'developer'),
    [
        param('id').isUUID(),
        body('leaseId').optional().isUUID(),
        body('contractId').optional().isUUID(),
        body('description').optional().isString(),
        body('obligationType').optional().isString(),
        body('party').optional().isString(),
        body('deadline').optional().isISO8601(),
        body('startDate').optional().isISO8601(),
        body('endDate').optional().isISO8601(),
        body('frequency').optional().isString(),
        body('amount').optional().isNumeric(),
        body('currency').optional().isString(),
        body('sourceClause').optional().isString(),
        body('confidence').optional().isFloat({ min: 0, max: 1 }),
        body('tags').optional().isArray(),
        body('notes').optional().isString(),
        body('status').optional().isString(),
        body('completedAt').optional().isISO8601(),
        body('owner').optional().isString(),
        body('ownerEmail').optional().isEmail(),
    ],
    handleValidationErrors,
    async (req: Request, res: Response) => {
        try {
            const obligation = await obligationService.updateObligation(req.params.id, {
                leaseId: req.body.leaseId,
                contractId: req.body.contractId,
                description: req.body.description,
                obligationType: req.body.obligationType,
                party: req.body.party,
                deadline: req.body.deadline ? new Date(req.body.deadline) : undefined,
                startDate: req.body.startDate ? new Date(req.body.startDate) : undefined,
                endDate: req.body.endDate ? new Date(req.body.endDate) : undefined,
                frequency: req.body.frequency,
                amount: req.body.amount !== undefined ? Number(req.body.amount) : undefined,
                currency: req.body.currency,
                sourceClause: req.body.sourceClause,
                confidence: req.body.confidence !== undefined ? Number(req.body.confidence) : undefined,
                tags: req.body.tags,
                notes: req.body.notes,
                status: req.body.status,
                completedAt: req.body.completedAt ? new Date(req.body.completedAt) : undefined,
                owner: req.body.owner,
                ownerEmail: req.body.ownerEmail,
            });

            res.json({ success: true, data: obligation });
        } catch (error: any) {
            res.status(500).json({
                error: 'Failed to update obligation',
                message: error.message,
            });
        }
    }
);

/**
 * DELETE /api/v1/obligations/:id
 */
router.delete(
    '/:id',
    authenticate,
    requireRole('admin', 'developer'),
    [param('id').isUUID()],
    handleValidationErrors,
    async (req: Request, res: Response) => {
        try {
            const obligation = await obligationService.deleteObligation(req.params.id);
            res.json({ success: true, data: obligation });
        } catch (error: any) {
            res.status(500).json({
                error: 'Failed to delete obligation',
                message: error.message,
            });
        }
    }
);

export default router;