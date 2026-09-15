-- Drop the "embeddings" table and its indexes.
-- Audit finding (deepiri-platform#317, G9): the pgvector extension and the
-- embeddings table were provisioned but no code path ever writes or reads
-- them -- DocumentChunk.embeddings was an orphaned relation with zero
-- callers of prisma.embedding.*.
DROP TABLE IF EXISTS "embeddings";

-- Disable the pgvector extension: nothing else in this schema depends on
-- the "vector" type now that the embeddings table is gone.
DROP EXTENSION IF EXISTS vector;
