#!/bin/sh
set -eu

: "${OPSMIND_API_URL:=http://localhost:3002}"
: "${OPSMIND_TICKET_URL:=http://localhost:3001}"
: "${OPSMIND_WORKFLOW_API_URL:=http://localhost:3003}"
: "${OPSMIND_AI_API_URL:=http://localhost:8000}"
: "${GEMINI_API_KEY:=}"
: "${GEMINI_API_URL:=https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent}"

envsubst '${OPSMIND_API_URL} ${OPSMIND_TICKET_URL} ${OPSMIND_WORKFLOW_API_URL} ${OPSMIND_AI_API_URL} ${GEMINI_API_KEY} ${GEMINI_API_URL}' \
  < /app/assets/js/config.template.js \
  > /app/assets/js/config.js

exec serve -l 85 .
