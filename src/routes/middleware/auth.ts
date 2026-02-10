import { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { logger } from '../../utils/logger';
import { config } from '../../config/environment';

export interface AuthUser {
  id: string;
  email?: string;
  organizationId?: string;
  role?: string;
}

interface TokenClaims extends JwtPayload {
  sub?: string;
  userId?: string;
  id?: string;
  email?: string;
  organizationId?: string;
  orgId?: string;
  role?: string;
  roles?: string[];
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
export function extractUserContext(req: Request): boolean {
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
    return true;
  }

  // No user context - service can still process documents
  // This allows internal/background processing without user context
  logger.debug('No user context in headers - processing without user metadata');

  return false;
}

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || typeof authHeader !== 'string') return null;

  const [scheme, token] = authHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;

  return token;
}

function getJwtKey(): string {
  if (config.auth.jwtPublicKey) {
    return config.auth.jwtPublicKey.replace(/\\n/g, '\n');
  }

  if (config.auth.jwtSecret) {
    return config.auth.jwtSecret;
  }

  throw new Error('JWT verification key is not configured');
}

function setUserFromClaims(req: Request, claims: TokenClaims): void {
  const id = claims.sub || claims.userId || claims.id;
  if (!id) {
    throw new Error('JWT missing subject');
  }

  const role = claims.role || (Array.isArray(claims.roles) ? claims.roles[0] : undefined);

  req.user = {
    id,
    email: claims.email,
    organizationId: claims.organizationId || claims.orgId,
    role,
  };
}

function verifyJwt(token: string): TokenClaims {
  const key = getJwtKey();

  const options: jwt.VerifyOptions = {};
  if (config.auth.jwtIssuer) options.issuer = config.auth.jwtIssuer;
  if (config.auth.jwtAudience) options.audience = config.auth.jwtAudience;

  return jwt.verify(token, key, options) as TokenClaims;
}

/**
 * Authenticate middleware - validates JWT and sets req.user
 * Falls back to gateway headers only when explicitly allowed
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  if (!config.auth.enabled) {
    extractUserContext(req);
    next();
    return;
  }

  const token = getBearerToken(req);
  if (!token) {
    if (config.auth.allowGatewayHeaders && extractUserContext(req)) {
      next();
      return;
    }

    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }

  try {
    const claims = verifyJwt(token);
    setUserFromClaims(req, claims);
    next();
  } catch (error: any) {
    logger.warn('JWT validation failed', { error: error.message });
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Role-based access control middleware
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.user?.role;

    if (!role) {
      res.status(401).json({ error: 'Missing authenticated role' });
      return;
    }

    if (!allowedRoles.includes(role)) {
      logger.warn('Insufficient role for request', {
        role,
        allowedRoles,
      });
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}

