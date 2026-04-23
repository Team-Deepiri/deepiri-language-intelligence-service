FROM ghcr.io/team-deepiri/deepiri-base:20-alpine

# Copy package files
COPY backend/deepiri-language-intelligence-service/package*.json ./
COPY backend/deepiri-language-intelligence-service/tsconfig.json ./

# Install dependencies
RUN --mount=type=secret,id=github_token \
    { echo "@team-deepiri:registry=https://npm.pkg.github.com"; \
      echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/github_token)"; \
    } > .npmrc \
 && npm ci --legacy-peer-deps \
 && npm cache clean --force \
 && echo "@team-deepiri:registry=https://npm.pkg.github.com" > .npmrc

# Copy source code
COPY backend/deepiri-language-intelligence-service/src ./src
COPY backend/deepiri-language-intelligence-service/prisma ./prisma

# Generate Prisma client
# Binary target is specified in schema.prisma for Alpine compatibility
RUN npx prisma generate

# Build TypeScript
RUN npm run build

RUN npm prune --omit=dev && \
    npm cache clean --force && \
    mkdir -p logs && chown -R nodejs:nodejs /app

USER nodejs

# Expose port
EXPOSE 5003

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:5003/health || exit 1

# Start server
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["/usr/bin/dumb-init", "--", "node", "dist/index.js"]
