ARG BASE_IMAGE
FROM ${BASE_IMAGE}
WORKDIR /app
COPY --chown=1000:1000 server/src/ ./src/
COPY --chown=1000:1000 schema.sql migrate.mjs ./continuity/
RUN node --check src/production.js && node --check src/appMysql.js && node --check src/accountContinuity.js && node --check src/accountDocuments.js \
    && node --input-type=module -e "await import('./src/appMysql.js')"
USER 1000:1000
CMD ["node", "src/production.js"]
