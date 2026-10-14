ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY --chown=1000:1000 server/src/app.js server/src/appMysql.js server/src/production.js server/src/mediaLibrary.js server/src/mysqlMediaLibrary.js server/src/publicVideoDelivery.js /app/src/
RUN node --check /app/src/app.js && node --check /app/src/appMysql.js && node --check /app/src/production.js && node --check /app/src/mediaLibrary.js && node --check /app/src/mysqlMediaLibrary.js && node --check /app/src/publicVideoDelivery.js && node --input-type=module -e "await import('./src/publicVideoDelivery.js')"
