FROM node:18-alpine

LABEL maintainer="malakmahdy2005@gmail.com"
LABEL description="OpsMind Notification Service"

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev && npm cache clean --force

COPY src ./src

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

RUN mkdir -p logs && chown -R nodejs:nodejs logs

USER nodejs

EXPOSE 3000



CMD ["node", "src/index.js"]