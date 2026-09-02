import rateLimit from 'express-rate-limit';

// Shared by documentRoutes.ts (as documentReadRateLimiter), contractRoutes.ts and
// leaseRoutes.ts (as downloadUrlRateLimiter) — same window/limit for all document
// read/download-url endpoints across the three route modules.
export const documentReadRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many document read requests, please try again later.' },
});
