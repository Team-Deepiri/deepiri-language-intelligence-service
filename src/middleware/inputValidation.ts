/*About: This file addresses the following security risks:
missing validation on some endpoints
inconsistent validation patterns
no length limits on inputs
*/


//import the types for Express requests and middleware
//import tools to validate input
//import the logger to log errors, warnings, or debug info
import { Request, Response, NextFunction } from 'express';
import { body, validationResult, ValidationChain } from 'express-validator';
import { logger } from '../utils/logger';

// Common validation rules
export const commonValidations = {
  //Email validation: lsit common rules to reuse for validating email addresses
  email: body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Invalid email format')
    .isLength({ max: 255 })
    .withMessage('Email must be less than 255 characters'),

  //Password validation: enforce secure password length,
  //use regex to check for required characters
  password: body('password')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be between 8 and 128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain uppercase, lowercase, number, and special character'),

  //User ID validation: validates MongoDB ObjectId format, makes field
  //optional for partial updates
  userId: body('userId')
    .isMongoId()
    .withMessage('Invalid user ID format')
    .optional(),

//String validation: rule for any text field- trims extra spaces,
//checks length of the string, sets up error message
  string: (field: string, maxLength: number = 1000) =>
    body(field)
      .trim()
      .isLength({ max: maxLength })
      .withMessage(`${field} must be less than ${maxLength} characters`)
      .escape(),

//URL Validation: only allows HTTP/HTTPS protocols,
//length limits prevent DoS attacks
  url: (field: string) =>
    body(field)
      .isURL({ protocols: ['http', 'https'] })
      .withMessage('Invalid URL format')
      .isLength({ max: 2048 })
      .withMessage('URL must be less than 2048 characters'),

//Check if input is an integer, within the specified range,
// shows error message otherwise
  integer: (field: string, min: number = 0, max: number = Number.MAX_SAFE_INTEGER) =>
    body(field)
      .isInt({ min, max })
      .withMessage(`${field} must be an integer between ${min} and ${max}`),

//Validation rule for array fields- check for input type, 
// length of array, shows error message
//if invalid
  array: (field: string, maxItems: number = 100) =>
    body(field)
      .isArray({ max: maxItems })
      .withMessage(`${field} must be an array with at most ${maxItems} items`),
};

// Validation middleware
export const validate = (validations: ValidationChain[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Run all validations
    await Promise.all(validations.map(validation => validation.run(req)));

    //collect any errors found
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const requestId = (req as any).requestId || 'unknown';

      //log the failure
      logger.warn('Validation failed', {
        requestId,
        path: req.path,
        method: req.method,
        errors: errors.array(),
      });

      //send error message
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        requestId,
        timestamp: new Date().toISOString(),
        errors: errors.array().map(err => ({
          field: (err as any).path || (err as any).param || (err as any).type || 'unknown',
          message: err.msg,
          value: (err as any).value,
        })),
      });
    }

    next();
  };
};

const MAX_BODY_KEYS = 50;
const MAX_STRING_VALUE_LENGTH = 10000;

export const generateBodyValidations = () => [
  body()
    .isObject()
    .withMessage('Body must be a JSON object')
    .custom((val: Record<string, unknown>) => {
      const keys = Object.keys(val || {});
      if (keys.length > MAX_BODY_KEYS) {
        throw new Error(`Body must have at most ${MAX_BODY_KEYS} keys`);
      }
      for (const k of keys) {
        if (k.length > 500) throw new Error('Body key names must be at most 500 characters');
        const v = (val as Record<string, unknown>)[k];
        if (typeof v === 'string' && v.length > MAX_STRING_VALUE_LENGTH) {
          throw new Error(`Body string values must be at most ${MAX_STRING_VALUE_LENGTH} characters`);
        }
      }
      return true;
    }),
];

/** Run body validation only when request has a JSON body. */
export const validateBodyIfPresent = () => {
  const validations = generateBodyValidations();
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
      return validate(validations)(req, res, next);
    }
    next();
  };
};