#!/bin/sh
set -e

npx prisma generate
npx prisma db push --skip-generate
exec node dist/server.js
