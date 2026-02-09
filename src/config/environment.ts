import dotenv from 'dotenv';
import { validateDatabaseUrl } from '@deepiri/shared-utils';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '5003', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  database: {
    url: validateDatabaseUrl(process.env.DATABASE_URL) || 'postgresql://user:password@localhost:5432/deepiri_language_intelligence',
  },
  
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || '',
  },
  
  storage: {
    provider: process.env.STORAGE_PROVIDER || 'minio',
    bucket: process.env.STORAGE_BUCKET || 'language-intelligence-documents',
    region: process.env.STORAGE_REGION || 'us-east-1',
    endpoint: process.env.STORAGE_ENDPOINT || 'http://localhost:9000',
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID || 'minioadmin',
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY || 'minioadmin',
  },
  
  cyrex: {
    baseUrl: process.env.CYREX_BASE_URL || 'http://localhost:8000',
    apiKey: process.env.CYREX_API_KEY || '',
  },
  
  // Auth is handled by API Gateway - this service just reads user context from headers
  // No need for AUTH_SERVICE_URL - gateway validates and passes context
  auth: {
    // Legacy - kept for backwards compatibility but not used
    authServiceUrl: '',
    enabled: false,
  },
};

