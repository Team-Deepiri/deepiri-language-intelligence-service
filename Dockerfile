# Build main service
FROM node:20-alpine
WORKDIR /app

# Install curl for health checks and OpenSSL for Prisma
# Alpine uses OpenSSL 3.x, Prisma will use linux-musl-openssl-3.0.x binary
RUN apk add --no-cache curl openssl

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY .npmrc ./

# Install dependencies
RUN --mount=type=secret,id=github_token \
    { echo "@deepiri:registry=https://npm.pkg.github.com"; \
      echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/github_token)"; \
    } > .npmrc && \
    npm ci --legacy-peer-deps && \
    npm cache clean --force && \
    echo "@deepiri:registry=https://npm.pkg.github.com" > .npmrc

# Copy source code
COPY src ./src
COPY prisma ./prisma

# Copy baseline migration script
COPY --chown=root:root scripts/prisma-baseline.sh /usr/local/bin/prisma-baseline.sh
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

