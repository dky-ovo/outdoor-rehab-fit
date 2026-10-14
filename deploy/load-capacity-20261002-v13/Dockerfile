ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY --chown=1000:1000 server/src/appMysql.js server/src/mysqlConfig.js server/src/mysqlDatabase.js server/src/lastSeenPolicy.js /app/src/
RUN node --check /app/src/appMysql.js && node --check /app/src/mysqlConfig.js && node --check /app/src/mysqlDatabase.js && node --check /app/src/lastSeenPolicy.js && node --input-type=module -e "await import('./src/lastSeenPolicy.js'); await import('./src/mysqlDatabase.js')"
