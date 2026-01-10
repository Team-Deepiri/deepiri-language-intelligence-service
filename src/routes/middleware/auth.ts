import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { config } from '../../config/environment';
import { logger } from '../../utils/logger';

export interface AuthUser {
  id: string;
  email: string;
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

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      res.status(401).json({ error: 'No authentication token provided' });
      return;
    }

    // Verify token with auth service
    const response = await axios.get(`${config.auth.authServiceUrl}/api/v1/auth/verify`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    req.user = response.data.user;
    next();
  } catch (error: any) {
    logger.error('Authentication failed', { error: error.message });
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

