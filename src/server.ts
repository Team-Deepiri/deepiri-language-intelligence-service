import express, { Express, Request, Response, ErrorRequestHandler, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import winston from 'winston';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import routes from './routes';
import { connectDatabase, prisma } from './db';
import { initializeEventPublisher } from './streaming/eventPublisher';
import { logger } from '@team-deepiri/shared-utils';
import { config } from './config/environment';
import { validateBodyIfPresent } from './middleware/inputValidation';
import { bodyParserConfig, requestSizeLimiter } from './middleware/requestLimits';

dotenv.config();

const app: Express = express();
const PORT: number = config.port;

// Logger
const winstonLogger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
}));

// Request size limits (Issue 8)
app.use(requestSizeLimiter);
app.use(express.json(bodyParserConfig.json));
app.use(express.urlencoded(bodyParserConfig.urlencoded));
app.use(validateBodyIfPresent());

// File upload configuration
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// Add multer to request for file uploads
app.use((req: Request, res: Response, next) => {
  (req as any).upload = upload;
  next();
});

// Add request ID middleware for correlation tracking and validation logging
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = req.headers['x-request-id'] as string || uuidv4();
  (req as any).requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
});

// Database connection
connectDatabase()
  .catch((err: Error) => {
    logger.error('Language Intelligence Service: Failed to connect to PostgreSQL', { error: err.message });
    process.exit(1);
  });

// Initialize event publisher
initializeEventPublisher().catch((err) => {
  logger.error('Failed to initialize event publisher:', { error: err.message });
});

// Health check
app.get('/health', async (req: Request, res: Response) => {
  try {
    // Check database connectivity if prisma is initialized
    if (prisma) {
      await prisma.$queryRaw`SELECT 1`;
      res.status(200).json({ 
        status: 'healthy', 
        service: 'language-intelligence-service',
        database: 'connected',
        timestamp: new Date().toISOString() 
      });
    } else {
      res.status(503).json({ 
        status: 'unhealthy', 
        service: 'language-intelligence-service',
        database: 'not_initialized',
        timestamp: new Date().toISOString() 
      });
    }
  } catch (error: any) {
    logger.error('Health check failed:', { error: error.message });
    res.status(503).json({ 
      status: 'unhealthy', 
      service: 'language-intelligence-service',
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString() 
    });
  }
});

// Routes
app.use('/api/v1', routes);

// Error handler
const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  logger.error('Language Intelligence Service error:', { error: err.message });
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
};
app.use(errorHandler);

// Note: Server is started in index.ts, not here
// This file only exports the configured Express app

export default app;

