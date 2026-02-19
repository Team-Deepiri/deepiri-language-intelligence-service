# QUICK REFERENCE: Commands to Run

## Pre-Flight Check

```bash
# Confirm DATABASE_URL is set
echo $DATABASE_URL
# Expected: postgresql://user:pass@host:port/dbname
```

If not set, add to `.env`:
```
DATABASE_URL="postgresql://user:password@localhost:5432/deepiri_intelligence"
```

---

## Step-by-Step (Local Development)

### 1. Validate the Schema

```bash
npx prisma validate
```

**Expected output:**
```
Prisma schema loaded from prisma/schema.prisma
The schema at prisma/schema.prisma is valid 🚀
```

### 2. Generate Prisma Client

```bash
npx prisma generate
```

**Expected output:**
```
Prisma schema loaded from prisma/schema.prisma
✔ Generated Prisma Client (v5.22.0) to ./node_modules/@prisma/client in 68ms
```

### 3. Create Migration (First Time Only)

```bash
npx prisma migrate dev --name "add_language_intelligence_models"
```

**Expected output:**
```
Environment variables loaded from .env
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "deepiri_intelligence" at "localhost:5432"

✔ Created new migration: 20260209120000_add_language_intelligence_models

✔ Generated Prisma Client (v5.22.0) in 45ms

Running migrations to update your database schema in development.

Prisma Migrate applied the following migration(s):

migrations/
  └─ 20260209120000_add_language_intelligence_models/
     └─ migration.sql

Your database is now in sync with your schema.

✓ Generated Prisma Client (v5.22.0) to ./node_modules/@prisma/client in 45ms
```

This creates the following **6 new tables:**
- `documents`
- `document_chunks`
- `analysis_jobs`
- `analysis_results`
- `embeddings`
- `prompt_templates`

Plus **2 new enums:**
- `JobStatus`
- `AnalysisType`

### 4. Run Smoke Test

```bash
npm run smoke:test
```

Or manually:
```bash
node scripts/smoke-test.js
```

**Expected output:**
```
[Smoke Test] userId: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
[Step 1] Creating Document...
✓ Created Document: ...
[Step 2] Creating DocumentChunks...
✓ Created 2 chunks: ... & ...
[Step 3] Creating AnalysisJob...
✓ Created job: ...
[Step 4] Creating AnalysisResult...
✓ Created result: ...
[Step 5] Creating Embedding with fallback vector...
✓ Created embedding: ...
[Step 6] Counting records before delete...
  Documents: 1, Chunks: 2, Jobs: 1, Results: 1, Embeddings: 1
[Step 7] Deleting Document (should cascade)...
✓ Document deleted
[Step 8] Counting records after delete...
  Documents: 0, Chunks: 0, Jobs: 0, Results: 0, Embeddings: 0
[Result] Cascade delete verification:
✅ PASS: All cascade deletes worked as expected.
```

**Exit code:** `0` = SUCCESS ✅

### 5. Start Development Server

```bash
npm run dev
```

**Expected output:**
```
Language Intelligence Service started on port 3000
Language Intelligence Service: Connected to PostgreSQL
...
```

### 6. Test Health Endpoint

```bash
curl http://localhost:3000/health
```

**Expected output:**
```json
{
  "status": "healthy",
  "service": "language-intelligence-service",
  "database": "connected",
  "timestamp": "2026-02-09T12:00:00.000Z"
}
```

---

## Optional: pgVector Setup (For Vector Search)

If you plan to use vector embeddings with pgvector (for fast similarity search):

### 1. Enable pgVector Extension

```bash
# Connect to your PostgreSQL database
psql -U user -d deepiri_intelligence

# Run once:
CREATE EXTENSION IF NOT EXISTS vector;

# Verify:
SELECT * FROM pg_extension WHERE extname = 'vector';
```

### 2. Create Vector Index (Manual SQL)

After migrations have run, create an index for efficient similarity search:

```sql
-- Cosine similarity (recommended for embeddings)
CREATE INDEX idx_embeddings_vector_cosine
ON embeddings USING ivfflat (vector vector_cosine_ops)
WHERE vector IS NOT NULL;
```

Or for L2 distance (Euclidean):
```sql
CREATE INDEX idx_embeddings_vector_l2
ON embeddings USING ivfflat (vector vector_l2_ops)
WHERE vector IS NOT NULL;
```

### 3. Use in Code

```typescript
import { prisma } from './db';

// If pgvector is enabled, you can store real vectors:
const embedding = await prisma.embedding.create({
  data: {
    userId,
    chunkId,
    model: 'sentence-transformers/all-MiniLM-L6-v2',
    dims: 384,
    vector: [0.1, 0.2, 0.3, ...], // pgvector column
    metadata: { source: 'test' },
  },
});

// If pgvector NOT enabled, use fallback:
const embedding = await prisma.embedding.create({
  data: {
    userId,
    chunkId,
    model: 'my-model',
    dims: 3,
    vector_fallback: [0.1, 0.2, 0.3], // JSON array
    metadata: { source: 'test' },
  },
});
```

---

## Production Deployment Steps

### 1. Set Environment

```bash
# In your production environment (CI/CD, deployment platform, etc.)
export DATABASE_URL="postgresql://prod-user:prod-pass@prod-host:5432/deepiri-prod"
export NODE_ENV="production"
```

### 2. Run Migrations

```bash
# Option A: Manual (if deploying to existing server)
npx prisma migrate deploy

# Option B: Automatic (add to Dockerfile or startup script)
# ARG DATABASE_URL
# RUN npx prisma migrate deploy
```

### 3. Start Application

```bash
npm start
```

### 4. Verify Health

```bash
curl https://api.example.com/health
# Should return:
# { "status": "healthy", "service": "language-intelligence-service", ... }
```

### 5. (Optional) Enable pgVector

```bash
# If using pgvector for production, run once:
psql -U prod-user -d deepiri-prod -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Then create index:
psql -U prod-user -d deepiri-prod -c "CREATE INDEX idx_embeddings_vector_cosine ON embeddings USING ivfflat (vector vector_cosine_ops) WHERE vector IS NOT NULL;"
```

---

## Docker Deployment

If containerized, add to `Dockerfile`:

```dockerfile
# ... existing Dockerfile content ...

# Install dependencies
RUN npm install

# Generate Prisma client
RUN npx prisma generate

# Run migrations on startup
RUN echo "npx prisma migrate deploy" > /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Start app
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["npm", "start"]
```

Or simpler:

```dockerfile
# ... existing setup ...

# Migrations + Start
CMD npx prisma migrate deploy && npm start
```

---

## Troubleshooting

### ❌ "schema does not exist"

**Cause:** Migrations didn't run  
**Fix:**
```bash
npx prisma migrate deploy
```

### ❌ "PrismaClientInitializationError"

**Cause:** DATABASE_URL not set or DB unreachable  
**Fix:**
```bash
# Verify env
echo $DATABASE_URL

# Test connection
psql $DATABASE_URL -c "SELECT 1"

# If using local dev:
docker run -d --name postgres -e POSTGRES_PASSWORD=pass -p 5432:5432 postgres:13
export DATABASE_URL="postgresql://postgres:pass@localhost:5432/deepiri_intelligence"
```

### ❌ Smoke test fails

**Cause:** Database schema not synced  
**Fix:**
```bash
npx prisma migrate dev --name "add_language_intelligence_models"
npm run smoke:test
```

### ❌ pgvector "type vector does not exist"

**Cause:** Extension not enabled  
**Options:**
1. Enable it: `CREATE EXTENSION IF NOT EXISTS vector;`
2. Or use fallback: `vector_fallback` JSON array (already supported)

---

## Monitoring & Verification

### Check Pending Migrations

```bash
npx prisma migrate status
```

Expected:
```
5 migrations found in prisma/migrations

Following migration have not yet been applied:
  migrations/20260209120000_add_language_intelligence_models

1 migration waiting to be applied.
```

After running: `Following migration have not yet been applied: (none)` ✅

### View Database

```bash
# GUI browser (dev only)
npx prisma studio

# Then visit: http://localhost:5555
```

### Check Connection

```bash
# Raw SQL query via Prisma
node -e "
const { prisma } = require('./src/db');
(async () => {
  const result = await prisma.\$queryRaw\`SELECT 1 as test\`;
  console.log(result);
  await prisma.\$disconnect();
})();
"

# Expected: [{ test: 1 }]
```

### Monitor Slow Queries (Dev)

Set in `src/db.ts`:
```typescript
export const prisma = new PrismaClient({
  log: ['query', 'error', 'warn'],  // verbose logging
});
```

Then watch logs in terminal as you use the app.

---

## Summary: What to Run

| Step | Command | What It Does |
|------|---------|-------------|
| 1 | `npx prisma validate` | Checks schema syntax |
| 2 | `npx prisma generate` | Generates Prisma client |
| 3 | `npx prisma migrate dev --name "add_language_intelligence_models"` | Creates & applies migration |
| 4 | `npm run smoke:test` | Validates cascade deletes |
| 5 | `npm run dev` | Starts dev server |
| 6 | `curl http://localhost:3000/health` | Checks health endpoint |

**All should pass ✅ before deploying.**

---

## Next: Read the Detailed Docs

- **Schema details**: `FINAL_DELIVERABLES.md`
- **Production deployment**: `PRODUCTION_NOTES.md`
- **Quick overview**: `IMPLEMENTATION_SUMMARY_v2.md`
- **Smoke test code**: `scripts/smoke-test.js`

---

**Status**: ✅ Ready to deploy  
**Last checked**: February 2026
