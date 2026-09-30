FROM outdoor-fit-api:20260924-v2
WORKDIR /app
COPY --chown=1000:1000 server/src/ ./src/
RUN node --check src/production.js \
    && node --check src/appMysql.js \
    && node --check src/mysqlMediaLibrary.js \
    && node --check src/mysqlEquipmentImageRetirement.js \
    && node --check src/mysqlDatabase.js \
    && node --check src/mysqlRouteTransaction.js \
    && node --input-type=module -e "await import('./src/appMysql.js'); await import('./src/mysqlEquipmentImageRetirement.js'); await import('./src/mysqlDatabase.js'); await import('./src/mysqlRouteTransaction.js')"
USER 1000:1000
CMD ["node", "src/production.js"]
