# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl libc6-compat bash

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

COPY tsconfig.json ./
COPY src ./src

RUN npx prisma generate
RUN npm run build


FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache openssl libc6-compat bash

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 appuser

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/.bin ./node_modules/.bin
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/dist ./dist
COPY start.sh ./start.sh
RUN chmod +x ./start.sh

USER appuser

ENV PORT=3004

EXPOSE 3004

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD wget --spider --quiet http://127.0.0.1:3004/health || exit 1

CMD ["/bin/sh", "./start.sh"]
