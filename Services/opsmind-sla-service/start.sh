#!/bin/sh
set -e

npx prisma db push --skip-generate
node dist/server.js
