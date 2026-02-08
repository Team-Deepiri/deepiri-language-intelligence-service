# Language Intelligence Service - Architecture

## Purpose

This is a **document processing service** that:
- Processes lease and contract documents (PDF, DOCX)
- Extracts structured data using AI (Cyrex/LLM)
- Tracks document versions and changes
- Builds dependency graphs between obligations
- Provides structured APIs for document intelligence

## Architecture Principles

### 1. Pure Processing Service
This service focuses on **document processing**, not authentication or authorization.

### 2. No Auth Service Dependency
- **API Gateway** handles authentication
- Gateway validates JWT tokens and rejects invalid requests
- Gateway passes user context as headers (`X-User-Id`, `X-Organization-Id`)
- Service reads headers, doesn't call auth service

### 3. Optional User Context
- User context is **metadata** for multi-tenancy
- Service can process documents without user context (for background/internal processing)
- User context is extracted from headers, not validated by this service

## Request Flow

### Option 1: Through API Gateway (External Users)
```
Frontend/Client → API Gateway → Language Intelligence Service
                  (validates)   (processes documents)
                  (sets headers)
```

1. **Client** sends request with JWT token to API Gateway
2. **API Gateway** validates token with auth service
3. **API Gateway** sets user context headers and proxies to service:
   - `X-User-Id`
   - `X-User-Email` (optional)
   - `X-Organization-Id` (optional)
   - `X-User-Role` (optional)
4. **Language Intelligence Service** reads headers and processes document
5. Service stores user context as metadata (for filtering/auditing)

### Option 2: Direct Access (Internal/Development)
```
AI Team / Other Services → Language Intelligence Service
                           (processes documents)
                           (no auth required)
```

1. **Internal service or AI team** calls service directly on port **5009**
2. **No authentication required** - service accepts requests without user context
3. Service processes document without user metadata
4. Useful for:
   - AI team testing/development
   - Background processing jobs
   - Service-to-service communication
   - Internal tooling

## Why This Architecture?

### ✅ Benefits
- **No dependency on auth service** - service can run independently
- **Faster requests** - no extra HTTP call to auth service
- **Simpler code** - just read headers, no complex auth logic
- **Better separation of concerns** - gateway handles auth, service handles processing
- **Easier testing** - can test without auth service running

### ❌ Previous Architecture (Bad)
- Service called auth service for every request
- Hard dependency on auth service availability
- Extra latency on every request
- Service couldn't run without auth service

## User Context Usage

User context is used for:
1. **Multi-tenancy**: Filter documents by `organizationId`
2. **Auditing**: Track who created/updated documents
3. **Access control**: Filter by `userId` (though gateway should handle this)

User context is **NOT** used for:
- Authentication (gateway handles this)
- Authorization (gateway should handle this)
- Document processing (doesn't need user context)

## Access Patterns

### External Access (Through API Gateway)
- **URL**: `http://api-gateway:5000/api/leases/*` or `/api/contracts/*`
- **Auth**: Required (handled by API Gateway)
- **User Context**: Automatically set by gateway via headers
- **Use Case**: Frontend, external clients, production

### Direct Access (Internal/Development)
- **URL**: `http://localhost:5009/api/v1/leases/*` or `/api/v1/contracts/*`
- **Auth**: None required - service accepts requests directly
- **User Context**: Can be set manually via headers, or omitted
- **Use Case**: AI team development, internal services, testing
- **Security**: Network isolation in production (don't expose port externally)

### Service-to-Service
- **URL**: `http://language-intelligence-service:5003/api/v1/*`
- **Auth**: Optional (internal network)
- **User Context**: Can be passed via headers if needed
- **Use Case**: Other microservices calling this service

## Environment Variables

No auth-related environment variables needed:
- ~~`AUTH_SERVICE_URL`~~ - Not needed, gateway handles auth (or call directly)
- ~~`AUTH_ENABLED`~~ - Not needed, auth is optional

### Security Notes
- **Development**: Port 5009 exposed to host for easy testing
- **Production**: Use network isolation - don't expose port externally, use API Gateway
- **Direct access**: No authentication required - rely on network security

## Migration Notes

If you need to migrate from the old architecture:
1. Update API Gateway to set user context headers after auth validation
2. Service will automatically read headers (no code changes needed)
3. Remove `AUTH_SERVICE_URL` from environment variables

## Examples

### API Gateway Middleware (Backend Team)
```typescript
// In API Gateway (after auth validation)
app.use('/api/leases', (req, res, next) => {
  if (req.user) {
    // Set headers for downstream service
    req.headers['x-user-id'] = req.user.id;
    req.headers['x-organization-id'] = req.user.organizationId;
    req.headers['x-user-email'] = req.user.email;
  }
  next();
});
```

### Direct Access (AI Team)
```bash
# Call service directly - no auth needed
curl -X POST http://localhost:5009/api/v1/leases/upload \
  -F "file=@lease.pdf" \
  -F "leaseNumber=LEASE-001" \
  -F "tenantName=Acme Corp" \
  -F "propertyAddress=123 Main St" \
  -F "startDate=2024-01-01" \
  -F "endDate=2025-01-01"

# Or with user context headers (optional)
curl -X POST http://localhost:5009/api/v1/leases/upload \
  -H "X-User-Id: user-123" \
  -H "X-Organization-Id: org-456" \
  -F "file=@lease.pdf" \
  ...
```

### Service-to-Service (Internal)
```typescript
// From another microservice
const response = await fetch('http://language-intelligence-service:5003/api/v1/leases', {
  method: 'GET',
  headers: {
    'X-User-Id': userId,           // Optional
    'X-Organization-Id': orgId,     // Optional
  }
});
```

## Team Access - Simple Solution

**Give AI Team API Gateway Access (Read-Only)**

**Why?**
- Simpler: One way to access services (through gateway)
- Consistent: Same pattern as frontend team
- Secure: Gateway handles auth
- No complexity: No direct port access needed

**Updated Setup:**
- **AI Team**: ✅ API Gateway access (read-only) - Use `localhost:5100/api/leases`
- **Backend Team**: ✅ Full gateway access (can modify)
- **Frontend Team**: ✅ Gateway access (read-only, for API endpoints)
- **Other Services**: ✅ Direct access on internal port 5003 (service-to-service)

**Production:**
- **Port 5009 NOT exposed** - Remove port mapping
- **All requests through API Gateway** (port 5100) - Gateway handles auth
- **Internal services** use internal network (port 5003)

**That's it - much simpler!**
- Everyone uses gateway (consistent)
- Gateway handles auth (secure)
- AI team has read access (can use, can't break auth)

