FROM node:22-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=node:node src/ ./src/
COPY --chown=node:node scripts/ ./scripts/
COPY --chown=node:node migration/ ./migration/
USER node
CMD ["node", "scripts/import-aliyun-mysql-data.js", "--audit", "/app/migration/source-schema-audit.json", "--input", "/input/export.jsonl", "--report", "/reports/import-report.json", "--apply"]
