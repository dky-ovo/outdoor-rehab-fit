ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY --chown=1000:1000 server/src/assistantFaqKnowledge.js server/src/assistantFaq.js server/src/accountContinuity.js /app/src/
RUN node --check /app/src/assistantFaqKnowledge.js && node --check /app/src/assistantFaq.js && node --check /app/src/accountContinuity.js && node --input-type=module -e "const m=await import('./src/assistantFaqKnowledge.js');if(!m.ASSISTANT_FAQ_ENTRIES.length)throw Error('FAQ_EMPTY');await import('./src/accountContinuity.js');"
