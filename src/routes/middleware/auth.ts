import { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger';

export interface AuthUser {
  id: string;
  email?: string;
  organizationId?: string;
  role?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Extract user context from headers (set by API Gateway after authentication)
 * 
 * Architecture: API Gateway handles authentication and passes user context
 * as headers. This service is a pure processing service and doesn't need
 * to call the auth service directly.
 * 
 * For direct access (bypassing gateway), no authentication is required.
 * Security is handled by network isolation in production.
 * 
 * Headers expected:
 * - X-User-Id: User ID (optional - for multi-tenancy/auditing)
 * - X-User-Email: User email (optional)
 * - X-Organization-Id: Organization ID (optional, for multi-tenancy)
 * - X-User-Role: User role (optional)
 */
export function extractUserContext(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Extract user context from headers (set by API Gateway)
  // If headers are present, use them; otherwise, continue without user context
  const userId = req.headers['x-user-id'] as string;
  const userEmail = req.headers['x-user-email'] as string | undefined;
  const organizationId = req.headers['x-organization-id'] as string | undefined;
  const userRole = req.headers['x-user-role'] as string | undefined;

  if (userId) {
    req.user = {
      id: userId,
      email: userEmail,
      organizationId: organizationId,
      role: userRole,
    };
    logger.debug('User context extracted from headers', { 
      userId, 
      organizationId,
      hasEmail: !!userEmail 
    });
  } else {
    // No user context - service can still process documents
    // This allows internal/background processing without user context
    logger.debug('No user context in headers - processing without user metadata');
  }

  next();
}

/**
 * Authenticate middleware - extracts user context from headers
 * No API key required for direct access - security via network isolation
 */
export const authenticate = extractUserContext;

