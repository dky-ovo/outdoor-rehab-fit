FROM outdoor-fit-api:20260924-v1
WORKDIR /app
COPY --chown=1000:1000 server/src/ ./src/
RUN node --check src/appMysql.js \
    && node --check src/mysqlResearchSql.js \
    && node --input-type=module -e "await import('./src/appMysql.js')"
USER 1000:1000
CMD ["node", "src/production.js"]
