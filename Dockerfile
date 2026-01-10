# Build shared-utils first
FROM node:20-alpine AS shared-utils-builder
WORKDIR /shared-utils
COPY shared/deepiri-shared-utils/package*.json ./
COPY shared/deepiri-shared-utils/tsconfig.json ./
COPY shared/deepiri-shared-utils/src ./src

RUN npm install --legacy-peer-deps && \
    npm run build && \
    npm cache clean --force

# Build main service
FROM node:20-alpine
WORKDIR /app

# Install curl for health checks and OpenSSL for Prisma
# Alpine uses OpenSSL 3.x, Prisma will use linux-musl-openssl-3.0.x binary
RUN apk add --no-cache curl openssl

# Copy package files
COPY backend/deepiri-language-intelligence-service/package*.json ./
COPY backend/deepiri-language-intelligence-service/tsconfig.json ./

# Copy built shared-utils
COPY --from=shared-utils-builder /shared-utils /shared-utils

# Install dependencies (including shared-utils as file dependency)
RUN npm install --legacy-peer-deps file:/shared-utils && \
    npm cache clean --force

# Copy source code
COPY backend/deepiri-language-intelligence-service/src ./src
COPY backend/deepiri-language-intelligence-service/prisma ./prisma

# Copy baseline migration script
COPY --chown=root:root shared/scripts/prisma-baseline.sh /usr/local/bin/prisma-baseline.sh
RUN chmod +x /usr/local/bin/prisma-baseline.sh

# Generate Prisma client
# Binary target is specified in schema.prisma for Alpine compatibility
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 5003

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:5003/health || exit 1

# Start server
CMD ["npm", "start"]

