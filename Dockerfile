ARG BEDD_IMAGE=ghcr.io/team-deepiri/bedd:0.8
FROM ${BEDD_IMAGE} AS bedd
FROM ghcr.io/team-deepiri/deepiri-suite:20-alpine
# Bedd runtime — LIS-only document.* skill filter (musl for Alpine).
# Not a Compose sidecar; not embedded into other platform workers.
COPY --from=bedd /opt/bedd/bedd-musl /usr/local/bin/bedd
COPY --from=bedd /opt/bedd/skills /opt/bedd/skills
ENV BEDD_SKILLS_DIR=/opt/bedd/skills
ENV BEDD_ENABLED=true
ENV BEDD_SKILL=drop_fields
ENV BEDD_DROP_FIELDS=ssn,socialSecurityNumber,email,phone,phoneNumber,password,secret,apiKey,creditCard

# Copy package files (@team-deepiri/shared-utils from published git tag in package-lock)
COPY backend/deepiri-language-intelligence-service/package*.json ./
COPY backend/deepiri-language-intelligence-service/tsconfig.json ./

RUN apk add --no-cache git \
 && npm ci --legacy-peer-deps \
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
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:5003/health || exit 1

# Start server
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["/usr/bin/dumb-init", "--", "node", "dist/index.js"]
