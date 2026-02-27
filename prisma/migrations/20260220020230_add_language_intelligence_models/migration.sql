-- CreateEnum
CREATE TYPE "LeaseStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'ERROR', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'ERROR', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ObligationType" AS ENUM ('PAYMENT', 'MAINTENANCE', 'NOTIFICATION', 'COMPLIANCE', 'RENEWAL', 'TERMINATION', 'INSURANCE', 'TAX', 'UTILITY', 'REPAIR', 'INSPECTION', 'DELIVERY', 'PERFORMANCE', 'CONFIDENTIALITY', 'OTHER');

-- CreateEnum
CREATE TYPE "ObligationStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DependencyType" AS ENUM ('TRIGGERS', 'BLOCKS', 'MODIFIES', 'REQUIRES', 'PRECEDES', 'CONFLICTS');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AnalysisType" AS ENUM ('EMBEDDING', 'EXTRACTION', 'SUMMARIZATION', 'CLASSIFICATION', 'RAG', 'OTHER');

-- CreateTable
CREATE TABLE "leases" (
    "id" UUID NOT NULL,
    "leaseNumber" VARCHAR(100) NOT NULL,
    "tenant_name" VARCHAR(255) NOT NULL,
    "landlord_name" VARCHAR(255),
    "property_address" VARCHAR(500) NOT NULL,
    "property_type" VARCHAR(100),
    "square_footage" INTEGER,
    "document_url" TEXT NOT NULL,
    "document_storage_key" VARCHAR(255),
    "raw_text" TEXT,
    "document_type" VARCHAR(50) NOT NULL DEFAULT 'PDF',
    "file_size" INTEGER,
    "start_date" TIMESTAMP NOT NULL,
    "end_date" TIMESTAMP NOT NULL,
    "status" "LeaseStatus" NOT NULL DEFAULT 'PENDING',
    "processing_status" VARCHAR(50),
    "processing_error" TEXT,
    "processed_at" TIMESTAMP,
    "processing_time_ms" INTEGER,
    "abstracted_terms" JSONB,
    "financial_terms" JSONB,
    "key_dates" JSONB,
    "property_details" JSONB,
    "key_clauses" JSONB,
    "extraction_confidence" DOUBLE PRECISION,
    "validation_score" DOUBLE PRECISION,
    "user_id" UUID,
    "organization_id" UUID,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "leases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lease_versions" (
    "id" UUID NOT NULL,
    "lease_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "document_url" TEXT NOT NULL,
    "raw_text" TEXT NOT NULL,
    "abstracted_terms" JSONB NOT NULL,
    "changes" JSONB,
    "change_summary" TEXT,
    "change_type" VARCHAR(50),
    "significant_changes" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_time_ms" INTEGER,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "lease_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "contractNumber" VARCHAR(100) NOT NULL,
    "contract_name" VARCHAR(255) NOT NULL,
    "partyA" VARCHAR(255) NOT NULL,
    "partyB" VARCHAR(255) NOT NULL,
    "contract_type" VARCHAR(100),
    "jurisdiction" VARCHAR(100),
    "effective_date" TIMESTAMP NOT NULL,
    "expiration_date" TIMESTAMP,
    "document_url" TEXT NOT NULL,
    "document_storage_key" VARCHAR(255),
    "raw_text" TEXT,
    "document_type" VARCHAR(50) NOT NULL DEFAULT 'PDF',
    "file_size" INTEGER,
    "status" "ContractStatus" NOT NULL DEFAULT 'PENDING',
    "processing_status" VARCHAR(50),
    "processing_error" TEXT,
    "processed_at" TIMESTAMP,
    "processing_time_ms" INTEGER,
    "abstracted_terms" JSONB,
    "key_clauses" JSONB,
    "financial_terms" JSONB,
    "termination_terms" JSONB,
    "renewal_terms" JSONB,
    "extraction_confidence" DOUBLE PRECISION,
    "validation_score" DOUBLE PRECISION,
    "user_id" UUID,
    "organization_id" UUID,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clauses" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "clause_type" VARCHAR(100) NOT NULL,
    "clause_title" VARCHAR(255),
    "clause_text" TEXT NOT NULL,
    "clause_summary" TEXT,
    "section_number" VARCHAR(50),
    "page_number" INTEGER,
    "version_number" INTEGER NOT NULL,
    "previous_version_id" UUID,
    "changes" JSONB,
    "change_type" VARCHAR(50),
    "change_summary" TEXT,
    "significant_change" BOOLEAN NOT NULL DEFAULT false,
    "extracted_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confidence" DOUBLE PRECISION,
    "extraction_method" VARCHAR(50),

    CONSTRAINT "clauses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_versions" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "document_url" TEXT NOT NULL,
    "raw_text" TEXT NOT NULL,
    "abstracted_terms" JSONB NOT NULL,
    "changes" JSONB,
    "change_summary" TEXT,
    "change_type" VARCHAR(50),
    "significant_changes" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_time_ms" INTEGER,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "contract_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligations" (
    "id" UUID NOT NULL,
    "lease_id" UUID,
    "contract_id" UUID,
    "description" TEXT NOT NULL,
    "obligation_type" "ObligationType" NOT NULL,
    "party" VARCHAR(50) NOT NULL,
    "deadline" TIMESTAMP,
    "start_date" TIMESTAMP,
    "end_date" TIMESTAMP,
    "frequency" VARCHAR(50),
    "amount" DOUBLE PRECISION,
    "currency" VARCHAR(10) DEFAULT 'USD',
    "source_clause" TEXT,
    "confidence" DOUBLE PRECISION,
    "status" "ObligationStatus" NOT NULL DEFAULT 'PENDING',
    "completed_at" TIMESTAMP,
    "owner" VARCHAR(255),
    "owner_email" VARCHAR(255),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,

    CONSTRAINT "obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligation_dependencies" (
    "id" UUID NOT NULL,
    "source_obligation_id" UUID NOT NULL,
    "target_obligation_id" UUID NOT NULL,
    "dependency_type" "DependencyType" NOT NULL,
    "description" TEXT,
    "confidence" DOUBLE PRECISION,
    "source_clause" TEXT,
    "target_clause" TEXT,
    "trigger_condition" TEXT,
    "source_contract_id" UUID,
    "target_contract_id" UUID,
    "source_lease_id" UUID,
    "target_lease_id" UUID,
    "discovered_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "discovered_by" VARCHAR(50),
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP,
    "verified_by" UUID,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "obligation_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" VARCHAR(500),
    "source_url" TEXT,
    "source_type" VARCHAR(50),
    "content" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "chunk_order" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "token_count" INTEGER,
    "start_offset" INTEGER,
    "end_offset" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_jobs" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "documentId" UUID,
    "chunkId" UUID,
    "type" "AnalysisType" NOT NULL DEFAULT 'OTHER',
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "input" JSONB,
    "prompt_snapshot" JSONB,
    "started_at" TIMESTAMP,
    "completed_at" TIMESTAMP,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,

    CONSTRAINT "analysis_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_results" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "result" JSONB,
    "text_output" TEXT,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,

    CONSTRAINT "analysis_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "embeddings" (
    "id" UUID NOT NULL,
    "chunkId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "model" VARCHAR(200) NOT NULL,
    "dims" INTEGER NOT NULL,
    "vector" vector,
    "vector_fallback" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,

    CONSTRAINT "embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_templates" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "version" INTEGER NOT NULL,
    "template" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,

    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leases_leaseNumber_key" ON "leases"("leaseNumber");

-- CreateIndex
CREATE INDEX "leases_leaseNumber_idx" ON "leases"("leaseNumber");

-- CreateIndex
CREATE INDEX "leases_tenant_name_idx" ON "leases"("tenant_name");

-- CreateIndex
CREATE INDEX "leases_status_idx" ON "leases"("status");

-- CreateIndex
CREATE INDEX "leases_user_id_idx" ON "leases"("user_id");

-- CreateIndex
CREATE INDEX "leases_organization_id_idx" ON "leases"("organization_id");

-- CreateIndex
CREATE INDEX "leases_start_date_idx" ON "leases"("start_date");

-- CreateIndex
CREATE INDEX "lease_versions_lease_id_idx" ON "lease_versions"("lease_id");

-- CreateIndex
CREATE INDEX "lease_versions_version_number_idx" ON "lease_versions"("version_number");

-- CreateIndex
CREATE UNIQUE INDEX "lease_versions_lease_id_version_number_key" ON "lease_versions"("lease_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_contractNumber_key" ON "contracts"("contractNumber");

-- CreateIndex
CREATE INDEX "contracts_contractNumber_idx" ON "contracts"("contractNumber");

-- CreateIndex
CREATE INDEX "contracts_partyA_idx" ON "contracts"("partyA");

-- CreateIndex
CREATE INDEX "contracts_partyB_idx" ON "contracts"("partyB");

-- CreateIndex
CREATE INDEX "contracts_status_idx" ON "contracts"("status");

-- CreateIndex
CREATE INDEX "contracts_user_id_idx" ON "contracts"("user_id");

-- CreateIndex
CREATE INDEX "contracts_organization_id_idx" ON "contracts"("organization_id");

-- CreateIndex
CREATE INDEX "contracts_effective_date_idx" ON "contracts"("effective_date");

-- CreateIndex
CREATE INDEX "clauses_contract_id_version_number_idx" ON "clauses"("contract_id", "version_number");

-- CreateIndex
CREATE INDEX "clauses_clause_type_idx" ON "clauses"("clause_type");

-- CreateIndex
CREATE INDEX "clauses_version_number_idx" ON "clauses"("version_number");

-- CreateIndex
CREATE INDEX "clauses_change_type_idx" ON "clauses"("change_type");

-- CreateIndex
CREATE INDEX "contract_versions_contract_id_idx" ON "contract_versions"("contract_id");

-- CreateIndex
CREATE INDEX "contract_versions_version_number_idx" ON "contract_versions"("version_number");

-- CreateIndex
CREATE UNIQUE INDEX "contract_versions_contract_id_version_number_key" ON "contract_versions"("contract_id", "version_number");

-- CreateIndex
CREATE INDEX "obligations_lease_id_idx" ON "obligations"("lease_id");

-- CreateIndex
CREATE INDEX "obligations_contract_id_idx" ON "obligations"("contract_id");

-- CreateIndex
CREATE INDEX "obligations_status_idx" ON "obligations"("status");

-- CreateIndex
CREATE INDEX "obligations_deadline_idx" ON "obligations"("deadline");

-- CreateIndex
CREATE INDEX "obligations_obligation_type_idx" ON "obligations"("obligation_type");

-- CreateIndex
CREATE INDEX "obligation_dependencies_source_obligation_id_idx" ON "obligation_dependencies"("source_obligation_id");

-- CreateIndex
CREATE INDEX "obligation_dependencies_target_obligation_id_idx" ON "obligation_dependencies"("target_obligation_id");

-- CreateIndex
CREATE INDEX "obligation_dependencies_source_contract_id_idx" ON "obligation_dependencies"("source_contract_id");

-- CreateIndex
CREATE INDEX "obligation_dependencies_target_contract_id_idx" ON "obligation_dependencies"("target_contract_id");

-- CreateIndex
CREATE INDEX "obligation_dependencies_dependency_type_idx" ON "obligation_dependencies"("dependency_type");

-- CreateIndex
CREATE INDEX "obligation_dependencies_verified_idx" ON "obligation_dependencies"("verified");

-- CreateIndex
CREATE UNIQUE INDEX "obligation_dependencies_source_obligation_id_target_obligat_key" ON "obligation_dependencies"("source_obligation_id", "target_obligation_id");

-- CreateIndex
CREATE INDEX "documents_userId_created_at_idx" ON "documents"("userId", "created_at");

-- CreateIndex
CREATE INDEX "documents_userId_idx" ON "documents"("userId");

-- CreateIndex
CREATE INDEX "document_chunks_documentId_idx" ON "document_chunks"("documentId");

-- CreateIndex
CREATE INDEX "document_chunks_userId_idx" ON "document_chunks"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_documentId_chunk_order_key" ON "document_chunks"("documentId", "chunk_order");

-- CreateIndex
CREATE INDEX "analysis_jobs_userId_created_at_idx" ON "analysis_jobs"("userId", "created_at");

-- CreateIndex
CREATE INDEX "analysis_jobs_status_idx" ON "analysis_jobs"("status");

-- CreateIndex
CREATE INDEX "analysis_jobs_documentId_idx" ON "analysis_jobs"("documentId");

-- CreateIndex
CREATE INDEX "analysis_jobs_chunkId_idx" ON "analysis_jobs"("chunkId");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_results_job_id_key" ON "analysis_results"("job_id");

-- CreateIndex
CREATE INDEX "analysis_results_userId_idx" ON "analysis_results"("userId");

-- CreateIndex
CREATE INDEX "embeddings_userId_created_at_idx" ON "embeddings"("userId", "created_at");

-- CreateIndex
CREATE INDEX "embeddings_chunkId_idx" ON "embeddings"("chunkId");

-- CreateIndex
CREATE INDEX "prompt_templates_userId_idx" ON "prompt_templates"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_templates_userId_name_version_key" ON "prompt_templates"("userId", "name", "version");

-- AddForeignKey
ALTER TABLE "lease_versions" ADD CONSTRAINT "lease_versions_lease_id_fkey" FOREIGN KEY ("lease_id") REFERENCES "leases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clauses" ADD CONSTRAINT "clauses_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clauses" ADD CONSTRAINT "clauses_previous_version_id_fkey" FOREIGN KEY ("previous_version_id") REFERENCES "clauses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_lease_id_fkey" FOREIGN KEY ("lease_id") REFERENCES "leases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_dependencies" ADD CONSTRAINT "obligation_dependencies_source_obligation_id_fkey" FOREIGN KEY ("source_obligation_id") REFERENCES "obligations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_dependencies" ADD CONSTRAINT "obligation_dependencies_target_obligation_id_fkey" FOREIGN KEY ("target_obligation_id") REFERENCES "obligations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_dependencies" ADD CONSTRAINT "obligation_dependencies_source_contract_id_fkey" FOREIGN KEY ("source_contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_dependencies" ADD CONSTRAINT "obligation_dependencies_target_contract_id_fkey" FOREIGN KEY ("target_contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "document_chunks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_results" ADD CONSTRAINT "analysis_results_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "analysis_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "document_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
