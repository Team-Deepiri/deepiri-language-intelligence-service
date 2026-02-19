# Production Readiness Notes: Language Intelligence Service

## Summary of Changes

This document captures the production setup for the Language Intelligence Service database models, migrations, and deployment considerations.

### Models Added (Language Intelligence Phase 3)

- **Document**: User-submitted documents (text/file/URL) with metadata
- **DocumentChunk**: Segments of documents for RAG/chunked processing
- **AnalysisJob**: Tracks analysis workflows (status, input, prompts)
- **AnalysisResult**: One-to-one result storage with job (JSON + text output)
- **Embedding**: Vector embeddings for document chunks (pgvector or JSON fallback)
- **PromptTemplate**: Versioned prompt templates per user

**Enums**: `JobStatus`, `AnalysisType` (plus existing `LeaseStatus`, `ContractStatus`, `ObligationType`, `ObligationStatus`, `DependencyType`)

---

## Database Setup

### Prerequisites

1. **PostgreSQL 12+** (tested on 13+)
2. **.env file** with `DATABASE_URL` set:
   ```bash
   DATABASE_URL="postgresql://user:password@localhost:5432/deepiri_intelligence"
   ```

### Schema Location

All models are in the **public** schema (default PostgreSQL schema).
- ✅ No multi-schema complexity
- ✅ Simpler migrations and maintenance
- ✅ Standard Prisma/Node.js best practices

---

## Migrations

### First Time Setup

```bash
# 1. Generate Prisma client
npx prisma generate

# 2. Create migration (additive, safe)
npx prisma migrate dev --name "add_language_intelligence_models"

# 3. Verify schema is in place
npx prisma db push --skip-generate

# 4. Run smoke test (see section below)
npm run smoke:test
```

### Deployment (Production)

```bash
# Apply all pending migrations in order
npx prisma migrate deploy

# OR if using azd/containerized:
# Migrations should run as part of your init/startup script
# Example in Dockerfile:
#   RUN npx prisma migrate deploy
#   CMD ["npm", "start"]
```

### Migration Checklist

- [ ] All `.sql` migration files in `prisma/migrations/` are reviewed
- [ ] Cascade delete behavior understood (Documents → Chunks, Jobs, Results)
- [ ] Indexes are applied (userId+createdAt, status, documentId, chunkId)
- [ ] Unique constraints in place (document+chunkOrder, jobId→result)
- [ ] Schema validated: `npx prisma validate`
- [ ] No pending migrations: `npx prisma migrate status`

---

## pgVector Support (Optional)

### If Using Vector Embeddings

#### Step 1: Enable the Extension

Run this **once** in your PostgreSQL database:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

This enables the native `vector` type.

#### Step 2: Update the Schema (Optional)

The `Embedding.vector` field is currently `Unsupported("vector")?`, which means:
- ✅ It *maps* to PG's `vector` type
- ✅ It won't fail if pgvector is not enabled
- ❌ You won't be able to use it unless the extension exists

If you enable pgvector, the field is ready to use.

#### Step 3: Create Vector Index (Manual SQL)

After enabling pgvector and running migrations, create an index for similarity search:

```sql
-- IVF index for cosine similarity (recommended for embeddings)
CREATE INDEX idx_embeddings_vector_cosine
ON embeddings USING ivfflat (vector vector_cosine_ops)
WHERE vector IS NOT NULL;

-- OR L2 distance (Euclidean)
-- CREATE INDEX idx_embeddings_vector_l2
-- ON embeddings USING ivfflat (vector vector_l2_ops)
-- WHERE vector IS NOT NULL;
```

### Fallback: No pgVector

If pgvector is not available:
- **Use `vector_fallback` (JSON array)** stored as JSON in the database
- Perform similarity search in application code (slower but works)
- No schema changes needed; fallback field is always there

**Example in your service code:**
```typescript
// Fallback: compute similarity in Node.js (slow but simple)
const query = [0.5, 0.6, 0.7]; // query embedding
const results = await prisma.embedding.findMany({ take: 10 });
results.sort((a, b) => {
  const simA = cosineSimilarity(query, a.vector_fallback);
  const simB = cosineSimilarity(query, b.vector_fallback);
  return simB - simA; // descending
});
```

---

## Environment Variables

### Required

```bash
DATABASE_URL="postgresql://user:pass@host:5432/dbname"
NODE_ENV="production"              # or "development"
```

### Optional (Best Practice)

```bash
# Logging
LOG_LEVEL="info"                  # debug, info, warn, error

# Database Connection
DATABASE_POOL_SIZE="20"           # Max connections
DATABASE_QUERY_TIMEOUT_MS="30000" # Query timeout

# Testing
NODE_ENV="test"                   # Use separate test DB
TEST_DATABASE_URL="..."           # If different from DATABASE_URL
```

---

## Verification Steps

### Development

```bash
# 1. Validate schema
DATABASE_URL="postgresql://localhost/test" npx prisma validate

# 2. Format schema (auto-fixes formatting issues)
npx prisma format

# 3. Check pending migrations
npx prisma migrate status

# 4. Run smoke test
npm run smoke:test

# 5. Open Prisma Studio (GUI for data)
npx prisma studio
```

### Production

```bash
# 1. Check migrations deployed
npx prisma migrate status

# 2. Verify PrismaClient initialization
# In your application logs, look for:
#   "Language Intelligence Service: Connected to PostgreSQL"

# 3. Health check endpoint
curl http://localhost:3000/health
# Expected: { "status": "healthy", "service": "language-intelligence-service", "database": "connected", "timestamp": "..." }

# 4. Monitor database connections
SELECT datname, count(*) FROM pg_stat_activity GROUP BY datname;
```

---

## Best Practices & Risks

### ✅ DO

1. **Always use migrations** for schema changes (never direct ALTER TABLE in prod)
2. **Test migrations locally** before deploying to staging/prod
3. **Use cascade deletes** judiciously (we use them for Document→Chunks/Jobs/Results)
4. **Index by userId** (mandatory for multi-tenancy: `@@index([userId, createdAt])`)
5. **Use timestamps**: `createdAt` (immutable) + `updatedAt` (auto-updated)
6. **Store JSON metadata** instead of adding new nullable columns
7. **Monitor slow queries** in development: check Prisma logs

### ⚠️ RISKS & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Orphaned AnalysisJobs** if chunk deleted | Data inconsistency | `onDelete: SetNull` on `AnalysisJob.chunk` |
| **Large cascades** (delete doc → 1000+ chunks) | Lock/perf hit | Consider archiving instead of delete; add batch delete with limits |
| **Missing pgvector extension** | Vector field unusable | Always use fallback JSON; add comments in schema |
| **No indexes on userId** | Slow queries per tenant | Verified: `@@index([userId, createdAt])` on all major models |
| **Unique constraint violation** | Race conditions | `DocumentChunk` unique on (documentId, chunkOrder); `AnalysisResult` unique on jobId |
| **JSON size unbounded** | Large document rows | Recommend: limit `metadata` size in application validation |

### 🔍 Monitoring

Enable Prisma logging in development:

```typescript
// src/db.ts
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? ['query', 'error', 'warn']  // verbose in dev
    : ['error'],                   // minimal in prod
});
```

### 🗑️ Data Cleanup

For testing/development, clear a user's data:

```bash
# Using Prisma Studio (GUI)
npx prisma studio

# Or via script
npx prisma db execute prisma/cleanup.sql
```

Example cleanup script (`prisma/cleanup.sql`):

```sql
-- WARNING: Only use in development!
-- DELETE FROM analysis_results WHERE id IN (
--   SELECT id FROM analysis_results WHERE user_id = 'XXXX-XXXX-XXXX-XXXX'
-- );
-- DELETE FROM analysis_jobs WHERE user_id = 'XXXX-XXXX-XXXX-XXXX';
-- DELETE FROM embeddings WHERE user_id = 'XXXX-XXXX-XXXX-XXXX';
-- DELETE FROM document_chunks WHERE user_id = 'XXXX-XXXX-XXXX-XXXX';
-- DELETE FROM documents WHERE user_id = 'XXXX-XXXX-XXXX-XXXX';
```

---

## Graceful Shutdown

The service implements graceful shutdown:

```typescript
// src/db.ts
process.on('SIGINT', async () => {
  await disconnectDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await disconnectDatabase();
  process.exit(0);
});
```

This ensures:
- ✅ Pending queries complete before exit
- ✅ Connection pool drained
- ✅ No orphaned connections in PostgreSQL

---

## Smoke Test

Quick validation of all models and cascade deletes:

```bash
npm run smoke:test
```

**What it does:**
1. Creates a Document + 2 chunks
2. Creates an AnalysisJob + AnalysisResult
3. Creates an Embedding (using JSON fallback)
4. Counts all records
5. Deletes the Document
6. Verifies cascade deleted related records (chunks, jobs, results, embeddings)
7. Exits 0 if successful, non-zero if failed

**Expected output:**
```
[Smoke Test] userId: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
[Step 1] Creating Document...
✓ Created Document: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
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

---

## Deployment Checklist

- [ ] `DATABASE_URL` is set in production environment
- [ ] Database schema exists and is accessible
- [ ] Run `npx prisma migrate deploy` before starting app
- [ ] Health endpoint `/health` returns `healthy` status
- [ ] pgvector extension installed (if using vector embeddings)
- [ ] Backup database before major migrations
- [ ] Monitor slow queries and index usage
- [ ] Set up log aggregation (Winston logs to application output)
- [ ] Configure connection pooling (optional, via DATABASE_URL params)

---

## Support & Debugging

### Connection Issues

```bash
# Test DB connection
DATABASE_URL="postgresql://..." psql -c "SELECT 1"

# Check Prisma engine compatibility
npx prisma --version
```

### Migration Issues

```bash
# Check status
npx prisma migrate status

# View pending migrations
ls prisma/migrations/

# Reset (DEV ONLY!)
# npx prisma migrate reset
```

### Performance

```bash
# Enable query logging in dev
export NODE_ENV=development

# Use Prisma Studio to inspect data
npx prisma studio

# Check database stats
SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) 
FROM pg_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

---

## Related Files

- **Schema**: `prisma/schema.prisma`
- **DB Client**: `src/db.ts`
- **Server**: `src/server.ts`
- **Migrations**: `prisma/migrations/`
- **Smoke Test**: `scripts/smoke-test.js` (run via `npm run smoke:test`)

---

**Last Updated**: February 2026  
**Version**: 1.0  
**Status**: Production Ready
