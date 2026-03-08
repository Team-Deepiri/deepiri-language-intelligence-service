import { Router, Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { chatService } from '../services/chatService';
import { authenticate } from './middleware/auth';
import { handleValidationErrors } from './middleware/validation';
import { logger } from '../utils/logger';

const router = Router();

/**
 * POST /api/v1/chat/sessions
 * Create a new chat session
 */
router.post(
  '/sessions',
  authenticate,
  [
    body('contextId').optional().isUUID().withMessage('Context ID must be a valid UUID'),
    body('contextType')
      .optional()
      .isString()
      .isIn(['CONTRACT', 'LEASE', 'REGULATORY_DOC'])
      .withMessage('Context type must be CONTRACT, LEASE, or REGULATORY_DOC'),
    body('title').optional().isString().trim().isLength({ min: 1, max: 255 }),
  ],
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const { contextId, contextType, title } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const session = await chatService.createChatSession({
        userId,
        contextId,
        contextType,
        title,
      });

      res.status(201).json({
        success: true,
        data: session,
      });
    } catch (error: any) {
      logger.error('Error creating chat session', { error: error.message });
      res.status(500).json({ error: 'Failed to create chat session', message: error.message });
    }
  }
);

/**
 * GET /api/v1/chat/sessions
 * Get all chat sessions for authenticated user
 */
router.get(
  '/sessions',
  authenticate,
  [
    query('contextId').optional().isUUID().withMessage('Context ID must be a valid UUID'),
    query('contextType')
      .optional()
      .isString()
      .isIn(['CONTRACT', 'LEASE', 'REGULATORY_DOC'])
      .withMessage('Context type must be CONTRACT, LEASE, or REGULATORY_DOC'),
  ],
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const { contextId, contextType } = req.query;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const sessions = await chatService.getUserChatSessions(
        userId,
        contextId as string | undefined,
        contextType as string | undefined
      );

      res.status(200).json({
        success: true,
        data: sessions,
      });
    } catch (error: any) {
      logger.error('Error retrieving chat sessions', { error: error.message });
      res.status(500).json({ error: 'Failed to retrieve chat sessions', message: error.message });
    }
  }
);

/**
 * GET /api/v1/chat/:sessionId
 * Get a specific chat session with message history
 */
router.get(
  '/:sessionId',
  authenticate,
  [param('sessionId').isUUID().withMessage('Session ID must be a valid UUID')],
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const session = await chatService.getChatSession(sessionId, userId);

      if (!session) {
        return res.status(404).json({ error: 'Chat session not found' });
      }

      res.status(200).json({
        success: true,
        data: session,
      });
    } catch (error: any) {
      logger.error('Error retrieving chat session', { error: error.message });
      res.status(500).json({ error: 'Failed to retrieve chat session', message: error.message });
    }
  }
);

/**
 * POST /api/v1/chat/:sessionId/messages
 * Add a message to a chat session
 */
router.post(
  '/:sessionId/messages',
  authenticate,
  [
    param('sessionId').isUUID().withMessage('Session ID must be a valid UUID'),
    body('role').isString().isIn(['user', 'assistant']).withMessage('Role must be either "user" or "assistant"'),
    body('content').isString().trim().notEmpty().withMessage('Message content cannot be empty'),
  ],
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const { role, content } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      // Verify user owns this session
      const session = await chatService.getChatSession(sessionId, userId);
      if (!session) {
        return res.status(404).json({ error: 'Chat session not found or unauthorized' });
      }

      const message = await chatService.addMessage({
        chatSessionId: sessionId,
        role,
        content,
      });

      res.status(201).json({
        success: true,
        data: message,
      });
    } catch (error: any) {
      logger.error('Error adding message', { error: error.message });
      res.status(500).json({ error: 'Failed to add message', message: error.message });
    }
  }
);

/**
 * PATCH /api/v1/chat/:sessionId/title
 * Update chat session title
 */
router.patch(
  '/:sessionId/title',
  authenticate,
  [
    param('sessionId').isUUID().withMessage('Session ID must be a valid UUID'),
    body('title').isString().trim().notEmpty().isLength({ min: 1, max: 255 }),
  ],
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const { title } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const session = await chatService.updateChatSessionTitle(sessionId, userId, title);

      if (!session) {
        return res.status(404).json({ error: 'Chat session not found or unauthorized' });
      }

      res.status(200).json({
        success: true,
        data: session,
      });
    } catch (error: any) {
      logger.error('Error updating chat session title', { error: error.message });
      res.status(500).json({ error: 'Failed to update chat session title', message: error.message });
    }
  }
);

/**
 * DELETE /api/v1/chat/:sessionId
 * Delete a chat session and all its messages
 */
router.delete(
  '/:sessionId',
  authenticate,
  [param('sessionId').isUUID().withMessage('Session ID must be a valid UUID')],
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const deleted = await chatService.deleteChatSession(sessionId, userId);

      if (!deleted) {
        return res.status(404).json({ error: 'Chat session not found or unauthorized' });
      }

      res.status(200).json({
        success: true,
        message: 'Chat session deleted successfully',
      });
    } catch (error: any) {
      logger.error('Error deleting chat session', { error: error.message });
      res.status(500).json({ error: 'Failed to delete chat session', message: error.message });
    }
  }
);

export default router;