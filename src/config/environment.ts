import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '5003', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    url: process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/deepiri_language_intelligence',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || '',
  },

  /**
   * Sugar Glider / Synapse bus — LIS owns document.* business routing;
   * transport prefers sidecar (same path as Cyrex / Helox / ModelKit).
   */
  synapse: {
    transport: (process.env.SYNAPSE_TRANSPORT || 'sidecar').trim().toLowerCase(),
    sugarGliderUrl: (
      process.env.SYNAPSE_SUGAR_GLIDER_URL ||
      process.env.SYNAPSE_SIDECAR_URL ||
      'http://synapse-sidecar:8081'
    ).replace(/\/$/, ''),
    timeoutMs: parseInt(process.env.SYNAPSE_TIMEOUT_MS || '5000', 10),
    get useSidecar(): boolean {
      return this.transport === 'sidecar';
    },
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
    pipelinePathA: process.env.CYREX_PIPELINE_A_PATH || '',
    pipelinePathB: process.env.CYREX_PIPELINE_B_PATH || '',
  },

  /**
   * Bedd — optional skill filter on LIS document.* publish only.
   * Not a platform data-plane hop. Set BEDD_ENABLED=false to force off;
   * unset = auto (on when /usr/local/bin/bedd is present).
   */
  bedd: {
    bin: process.env.BEDD_BIN || '/usr/local/bin/bedd',
    skillsDir: process.env.BEDD_SKILLS_DIR || '/opt/bedd/skills',
    skill: process.env.BEDD_SKILL || 'drop_fields',
    dropFields:
      process.env.BEDD_DROP_FIELDS ||
      'ssn,socialSecurityNumber,email,phone,phoneNumber,password,secret,apiKey,creditCard',
    get enabled(): boolean | null {
      const raw = (process.env.BEDD_ENABLED || '').trim().toLowerCase();
      if (raw === '1' || raw === 'true' || raw === 'yes') return true;
      if (raw === '0' || raw === 'false' || raw === 'no') return false;
      return null;
    },
  },

  // Auth is handled by API Gateway - this service just reads user context from headers
  auth: {
    authServiceUrl: '',
    enabled: process.env.AUTH_ENABLED === 'true',
    allowGatewayHeaders: process.env.AUTH_ALLOW_GATEWAY_HEADERS !== 'false',
    jwtSecret: process.env.JWT_SECRET || '',
    jwtPublicKey: process.env.JWT_PUBLIC_KEY || '',
    jwtIssuer: process.env.JWT_ISSUER || '',
    jwtAudience: process.env.JWT_AUDIENCE || '',
  },
};
