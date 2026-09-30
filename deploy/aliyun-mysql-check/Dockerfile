FROM node:22-bookworm-slim
WORKDIR /app
# This is a read-only probe image, not the production application. Dependencies
# use the server lockfile; SQLite native install scripts are unnecessary here.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=node:node src/mysqlConfig.js src/mysqlDatabase.js ./src/
COPY --chown=node:node scripts/check-aliyun-mysql.js ./scripts/
USER node
CMD ["node", "scripts/check-aliyun-mysql.js"]
