#!/usr/bin/env node
/**
 * Smoke test script (plain Node.js) to validate Prisma models and cascade behavior.
 * 
 * Usage:
 *   node scripts/smoke-test.js
 *
 * Prerequisites:
 *   - DATABASE_URL env var must be set and pointing to a test database
 *   - Run migrations first: npx prisma migrate dev --name add_language_intelligence_models
 *   - Or use NODE_ENV=test with a separate test DB to avoid polluting dev/prod
 *
 * This script:
 *   1. Creates a Document
 *   2. Creates two DocumentChunks
 *   3. Creates an AnalysisJob + AnalysisResult
 *   4. Creates an Embedding (uses fallback Json vector)
 *   5. Verifies counts
 *   6. Deletes the Document and verifies cascade deletes
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { randomUUID } = require('crypto');

async function main() {
  const userId = randomUUID();
  console.log('[Smoke Test] userId:', userId);

  try {
    console.log('\n[Step 1] Creating Document...');
    const doc = await prisma.document.create({
      data: {
        userId,
        title: 'Smoke test document',
        sourceType: 'TEST',
        content: 'This is a small document used for testing cascade deletes and relations.',
      },
    });
    console.log('✓ Created Document:', doc.id);

    console.log('\n[Step 2] Creating DocumentChunks...');
    const chunk1 = await prisma.documentChunk.create({
      data: {
        userId,
        documentId: doc.id,
        chunkOrder: 1,
        text: 'Chunk one text.',
        tokenCount: 10,
      },
    });

    const chunk2 = await prisma.documentChunk.create({
      data: {
        userId,
        documentId: doc.id,
        chunkOrder: 2,
        text: 'Chunk two text.',
        tokenCount: 12,
      },
    });
    console.log('✓ Created 2 chunks:', chunk1.id, '&', chunk2.id);

    console.log('\n[Step 3] Creating AnalysisJob...');
    const job = await prisma.analysisJob.create({
      data: {
        userId,
        documentId: doc.id,
        type: 'EXTRACTION',
        status: 'COMPLETED',
        input: { note: 'smoke-test' },
        promptSnapshot: { prompt: 'Test prompt' },
      },
    });
    console.log('✓ Created job:', job.id);

    console.log('\n[Step 4] Creating AnalysisResult...');
    const result = await prisma.analysisResult.create({
      data: {
        userId,
        jobId: job.id,
        result: { summary: 'OK' },
        textOutput: 'Result text',
      },
    });
    console.log('✓ Created result:', result.id);

    console.log('\n[Step 5] Creating Embedding with fallback vector...');
    // Using vector_fallback as Json array (since pgvector may not be enabled)
    const embedding = await prisma.embedding.create({
      data: {
        userId,
        chunkId: chunk1.id,
        model: 'smoke-model',
        dims: 3,
        vector_fallback: [0.1, 0.2, 0.3],
        metadata: { createdBy: 'smoke-test' },
      },
    });
    console.log('✓ Created embedding:', embedding.id);

    console.log('\n[Step 6] Counting records before delete...');
    const docCount = await prisma.document.count({ where: { userId } });
    const chunkCount = await prisma.documentChunk.count({ where: { userId } });
    const jobCount = await prisma.analysisJob.count({ where: { userId } });
    const resultCount = await prisma.analysisResult.count({ where: { userId } });
    const embeddingCount = await prisma.embedding.count({ where: { userId } });

    console.log(`  Documents: ${docCount}, Chunks: ${chunkCount}, Jobs: ${jobCount}, Results: ${resultCount}, Embeddings: ${embeddingCount}`);

    console.log('\n[Step 7] Deleting Document (should cascade)...');
    await prisma.document.delete({ where: { id: doc.id } });
    console.log('✓ Document deleted');

    console.log('\n[Step 8] Counting records after delete...');
    const docCount2 = await prisma.document.count({ where: { userId } });
    const chunkCount2 = await prisma.documentChunk.count({ where: { userId } });
    const jobCount2 = await prisma.analysisJob.count({ where: { userId } });
    const resultCount2 = await prisma.analysisResult.count({ where: { userId } });
    const embeddingCount2 = await prisma.embedding.count({ where: { userId } });

    console.log(`  Documents: ${docCount2}, Chunks: ${chunkCount2}, Jobs: ${jobCount2}, Results: ${resultCount2}, Embeddings: ${embeddingCount2}`);

    console.log('\n[Result] Cascade delete verification:');
    const success = docCount2 === 0 && chunkCount2 === 0 && jobCount2 === 0 && resultCount2 === 0 && embeddingCount2 === 0;
    if (success) {
      console.log('✅ PASS: All cascade deletes worked as expected.');
      process.exit(0);
    } else {
      console.error('❌ FAIL: Some records remain after delete:');
      console.error(`  Expected all zeros, got: docs=${docCount2}, chunks=${chunkCount2}, jobs=${jobCount2}, results=${resultCount2}, embeddings=${embeddingCount2}`);
      process.exit(2);
    }
  } catch (err) {
    console.error('\n❌ Smoke test encountered error:');
    console.error(err);
    process.exit(3);
  } finally {
    await prisma.$disconnect();
  }
}

main();

