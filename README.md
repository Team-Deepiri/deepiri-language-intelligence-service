# Deepiri Language Intelligence Service

**Regulatory-Contract-Lease Language Intelligence Platform**

## Overview

This service provides:
- **Phase 1**: Lease Abstraction MVP - Extract structured data from lease documents
- **Phase 2**: Contract Intelligence - Contract clause evolution tracking and obligation dependency graphs

## Features

### Phase 1: Lease Abstraction
- Upload and process lease documents (PDF, DOCX)
- Extract structured lease terms (financial, dates, obligations, clauses)
- Version comparison for lease amendments
- Obligation tracking and alerts

### Phase 2: Contract Intelligence
- Contract document processing
- Clause extraction and categorization
- Clause evolution tracking across versions
- Obligation dependency graph building
- Cross-document dependency detection

## API Endpoints

### Leases
- `POST /api/v1/leases/upload` - Upload lease document
- `GET /api/v1/leases/:id` - Get lease details
- `GET /api/v1/leases/:id/obligations` - Get lease obligations
- `POST /api/v1/leases/:id/versions` - Upload new lease version
- `GET /api/v1/leases/:id/versions/:versionId/diff` - Compare versions

### Contracts
- `POST /api/v1/contracts/upload` - Upload contract document
- `GET /api/v1/contracts/:id/clauses` - Get contract clauses
- `GET /api/v1/contracts/:id/clauses/evolution` - Get clause evolution
- `GET /api/v1/contracts/:id/obligations/dependencies` - Get dependency graph
- `GET /api/v1/obligations/:id/cascade` - Find cascading obligations

### Vector Store Management
- `GET /api/v1/vector-store/collections/types` - Get available collection types
- `GET /api/v1/vector-store/collections` - List all collections
- `GET /api/v1/vector-store/collections/:collectionName/stats` - Get collection statistics
- `POST /api/v1/vector-store/collections/:collectionName` - Create/verify collection
- `POST /api/v1/vector-store/collections/:collectionName/documents` - Add documents to collection
- `DELETE /api/v1/vector-store/collections/:collectionName/documents` - Remove documents from collection
- `GET /api/v1/vector-store/collections/:collectionName/documents` - View documents (with query)
- `POST /api/v1/vector-store/collections/:collectionName/documents/search` - Search documents in collection

**Collection Types:**
- `regulatory_documents` - Regulatory language evolution tracking
- `contracts` - Contract clause evolution and intelligence
- `leases` - Lease abstraction and management
- `obligations` - Obligation tracking and dependency graphs
- `clauses` - Clause extraction and evolution
- `compliance_patterns` - Compliance pattern mining and prediction

## Development

```bash
# Install dependencies
npm install

# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# Start dev server
npm run dev

# Build
npm run build
```

## Environment Variables

See `.env.example` for required environment variables.

## Architecture

- **Service**: Node.js/Express microservice (Port 5003)
- **Database**: PostgreSQL via Prisma
- **Storage**: S3/MinIO for document storage
- **Vector Store**: Milvus (via Cyrex API) for document collections
- **AI Processing**: Cyrex (Python/FastAPI) for document abstraction
- **Events**: Redis Streams for event publishing

