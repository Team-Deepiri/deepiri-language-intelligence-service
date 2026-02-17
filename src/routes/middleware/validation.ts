import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';

/**
 * DEPRECATED: Use the standardized validate() middleware from ../../../middleware/inputValidation.ts instead.
 * 
 * This middleware is kept as a fallback for legacy code, but all new routes should use:
 * - import { validate, commonValidations } from '../middleware/inputValidation';
 * - router.post('/path', authenticate, validate([...]), handler)
 * 
 * This ensures consistent validation patterns and error responses across the service.
 */
export function handleValidationErrors(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    res.status(400).json({
      error: 'Validation failed',
      errors: errors.array(),
    });
    return;
  }
  
  next();
}

