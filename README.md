# Deepiri Language Intelligence Service

**Regulatory-Contract-Lease Language Intelligence Platform**

## Overview

This service provides:
- **Phase 1**: Lease Abstraction MVP - Extract structured data from lease documents
- **Phase 2**: Contract Intelligence - Contract clause evolution tracking and obligation dependency graphs

## Features

- Upload and process documents (PDF, DOCX)
- Extract structures
- Version comparison for document amendments
- Obligation tracking and alerts
- Contract document processing
- Extraction and categorization
- Evolution tracking across versions
- Cross-document dependency detection

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

