#!/bin/sh
set -eu

: "${OPSMIND_API_URL:=http://localhost:3002}"
: "${OPSMIND_TICKET_URL:=http://localhost:3001}"
: "${OPSMIND_WORKFLOW_API_URL:=http://localhost:3003}"
: "${OPSMIND_AI_API_URL:=http://localhost:8000}"
: "${OPSMIND_AGENTIC_AI_API_URL:=http://localhost:4010}"
: "${OPSMIND_SLA_URL:=http://localhost:3004}"
: "${OPSMIND_NOTIFICATION_URL:=http://localhost:3005/api/notifications}"
: "${OPSMIND_INVENTORY_API_URL:=http://localhost:5000/api}"
: "${OPSMIND_REPORT_API_URL:=http://localhost:3006/analytics}"

envsubst '${OPSMIND_API_URL} ${OPSMIND_TICKET_URL} ${OPSMIND_WORKFLOW_API_URL} ${OPSMIND_AI_API_URL} ${OPSMIND_AGENTIC_AI_API_URL} ${OPSMIND_SLA_URL} ${OPSMIND_NOTIFICATION_URL} ${OPSMIND_INVENTORY_API_URL} ${OPSMIND_REPORT_API_URL}' \
  < /app/assets/js/config.template.js \
  > /app/assets/js/config.js

exec serve -l 85 .
