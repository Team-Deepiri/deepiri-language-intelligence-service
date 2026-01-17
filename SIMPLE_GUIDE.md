# Language Intelligence Service - Simple Guide

## For AI Team

**Use API Gateway (simpler):**

```bash
# Through API Gateway (recommended)
curl -X POST http://localhost:5100/api/leases/upload \
  -H "Authorization: Bearer <token>" \
  -F "file=@lease.pdf" \
  -F "leaseNumber=LEASE-001" \
  -F "tenantName=Acme Corp" \
  -F "propertyAddress=123 Main St" \
  -F "startDate=2024-01-01" \
  -F "endDate=2025-01-01"
```

**Or direct access (development only):**
```bash
# Direct access (port 5009, dev only)
curl -X POST http://localhost:5009/api/v1/leases/upload \
  -F "file=@lease.pdf" \
  ...
```

**Gateway is simpler - use that.**

## Architecture

### Development
- **Direct Access**: `localhost:5009` - No auth required (localhost only)
- **Through Gateway**: `localhost:5100/api/leases` - Gateway handles auth
- **Service-to-Service**: `language-intelligence-service:5003` - Internal network

### Production
- **Port 5009 NOT exposed** - Remove port mapping
- **Gateway Only**: `api-gateway:5100/api/leases` - Gateway handles auth
- **Internal Access**: `language-intelligence-service:5003` - Internal network only
- **Customers**: Can only access through gateway (secure)

## Security

- **Development**: Port exposed on localhost (safe for dev)
- **Production**: Port hidden, gateway-only (customers can't access directly)
- **No auth needed** for internal/development use
- **Gateway handles auth** for customer requests

## That's All You Need

No complexity. Just call the service. Done.

