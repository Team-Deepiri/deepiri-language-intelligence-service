FROM node:20-alpine AS shared-utils-builder
WORKDIR /shared-utils
COPY platform-services/shared/deepiri-shared-utils/package.json ./
COPY platform-services/shared/deepiri-shared-utils/tsconfig.json ./
COPY platform-services/shared/deepiri-shared-utils/src ./src
RUN npm install --legacy-peer-deps && npm run build

# Build main service
FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache curl openssl

COPY platform-services/backend/deepiri-language-intelligence-service/package*.json ./
COPY platform-services/backend/deepiri-language-intelligence-service/tsconfig.json ./

RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));delete p.dependencies['@deepiri/shared-utils'];fs.writeFileSync('package.json',JSON.stringify(p,null,2))"

RUN npm install --legacy-peer-deps && npm cache clean --force

COPY --from=shared-utils-builder /shared-utils/package.json /app/node_modules/@deepiri/shared-utils/package.json
COPY --from=shared-utils-builder /shared-utils/dist /app/node_modules/@deepiri/shared-utils/dist

# Copy source code
COPY platform-services/backend/deepiri-language-intelligence-service/src ./src
COPY platform-services/backend/deepiri-language-intelligence-service/prisma ./prisma

# Copy baseline migration script
COPY --chown=root:root platform-services/shared/scripts/prisma-baseline.sh /usr/local/bin/prisma-baseline.sh
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
