FROM ghcr.io/team-deepiri/deepiri-suite:20-alpine

COPY shared/deepiri-shared-utils/package*.json /shared/deepiri-shared-utils/
COPY shared/deepiri-shared-utils/tsconfig.json /shared/deepiri-shared-utils/
COPY shared/deepiri-shared-utils/src /shared/deepiri-shared-utils/src
# Copy package files
COPY backend/deepiri-language-intelligence-service/package*.json ./
COPY backend/deepiri-language-intelligence-service/tsconfig.json ./

# Install dependencies
RUN node -e "const fs=require('fs'),lock=JSON.parse(fs.readFileSync('package-lock.json'));delete lock.packages['../../shared/deepiri-shared-utils'];delete lock.packages['node_modules/@team-deepiri/shared-utils'];fs.writeFileSync('package-lock.json',JSON.stringify(lock));" \
 && cd /shared/deepiri-shared-utils \
 && npm ci --legacy-peer-deps \
 && npm run build --if-present \
 && node -e "const fs=require('fs'),p=JSON.parse(fs.readFileSync('package.json'));delete p.scripts.prepare;fs.writeFileSync('package.json',JSON.stringify(p,null,2));" \
 && cd /app \
 && npm install --legacy-peer-deps \
 && npm install --legacy-peer-deps file:/shared/deepiri-shared-utils \
 && cd /shared/deepiri-shared-utils \
 && npm ci --omit=dev --legacy-peer-deps \
 && cd /app \
 && npm cache clean --force

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
