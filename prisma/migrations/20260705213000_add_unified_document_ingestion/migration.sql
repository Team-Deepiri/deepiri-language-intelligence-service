-- Add generic dynamic document ingestion tables without removing legacy lease/contract tables.

-- CreateEnum
CREATE TYPE "IntelligenceDocumentStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'ERROR', 'ARCHIVED');

-- CreateTable
CREATE TABLE "unified_documents" (
    "id" UUID NOT NULL,
    "document_key" VARCHAR(200) NOT NULL,
    "document_kind" VARCHAR(120) NOT NULL,
    "intelligence_profile" VARCHAR(120) NOT NULL,
    "profile_hints" JSONB,
    "document_url" TEXT NOT NULL,
    "document_storage_key" VARCHAR(255),
    "raw_text" TEXT,
    "document_type" VARCHAR(50) NOT NULL DEFAULT 'PDF',
    "file_size" INTEGER,
    "status" "IntelligenceDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "processing_status" VARCHAR(50),
    "processing_error" TEXT,
    "processed_at" TIMESTAMP(6),
    "processing_time_ms" INTEGER,
    "abstracted_terms" JSONB,
    "financial_terms" JSONB,
    "key_dates" JSONB,
    "extracted_supplement" JSONB,
    "structured_segments" JSONB,
    "termination_details" JSONB,
    "renewal_details" JSONB,
    "extraction_confidence" DOUBLE PRECISION,
    "validation_score" DOUBLE PRECISION,
    "user_id" UUID,
    "organization_id" UUID,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "unified_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unified_document_versions" (
    "id" UUID NOT NULL,
    "intelligence_document_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "document_url" TEXT NOT NULL,
    "raw_text" TEXT NOT NULL,
    "abstracted_terms" JSONB NOT NULL,
    "changes" JSONB,
    "change_summary" TEXT,
    "change_type" VARCHAR(50),
    "significant_changes" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_time_ms" INTEGER,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "unified_document_versions_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "obligations" ADD COLUMN "intelligence_document_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "unified_documents_document_key_key" ON "unified_documents"("document_key");

-- CreateIndex
CREATE INDEX "unified_documents_document_key_idx" ON "unified_documents"("document_key");

-- CreateIndex
CREATE INDEX "unified_documents_document_kind_idx" ON "unified_documents"("document_kind");

-- CreateIndex
CREATE INDEX "unified_documents_intelligence_profile_idx" ON "unified_documents"("intelligence_profile");

-- CreateIndex
CREATE INDEX "unified_documents_status_idx" ON "unified_documents"("status");

-- CreateIndex
CREATE INDEX "unified_documents_user_id_idx" ON "unified_documents"("user_id");

-- CreateIndex
CREATE INDEX "unified_documents_organization_id_idx" ON "unified_documents"("organization_id");

-- CreateIndex
CREATE INDEX "unified_document_versions_intelligence_document_id_idx" ON "unified_document_versions"("intelligence_document_id");

-- CreateIndex
CREATE INDEX "unified_document_versions_version_number_idx" ON "unified_document_versions"("version_number");

-- CreateIndex
CREATE UNIQUE INDEX "unified_document_versions_intelligence_document_id_version_key" ON "unified_document_versions"("intelligence_document_id", "version_number");

-- CreateIndex
CREATE INDEX "obligations_intelligence_document_id_idx" ON "obligations"("intelligence_document_id");

-- AddForeignKey
ALTER TABLE "unified_document_versions" ADD CONSTRAINT "unified_document_versions_intelligence_document_id_fkey" FOREIGN KEY ("intelligence_document_id") REFERENCES "unified_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_intelligence_document_id_fkey" FOREIGN KEY ("intelligence_document_id") REFERENCES "unified_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
