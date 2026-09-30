# syntax=docker/dockerfile:1
# Build context is the repository root. Dockerfile.dockerignore restricts it.
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY server/package.json server/package-lock.json ./
# The MySQL runtime does not need the legacy better-sqlite3 native addon.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies --chown=1000:1000 /app/node_modules ./node_modules
COPY --chown=1000:1000 server/package.json ./package.json
COPY --chown=1000:1000 server/src/ ./src/
# Deliberately refuse the old SQLite/loopback-only src/index.js entry point.
RUN node --check /app/src/production.js \
    && node --input-type=module -e "await import('./src/appMysql.js')"
USER 1000:1000
EXPOSE 3000
CMD ["node", "src/production.js"]
