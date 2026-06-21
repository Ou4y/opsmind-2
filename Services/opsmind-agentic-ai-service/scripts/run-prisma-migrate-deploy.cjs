const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const serviceRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(serviceRoot, '..', '..');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const parsed = {};
  const content = fs.readFileSync(filePath, 'utf8');

  for (const rawLine of content.split(/\r?\n/)) {
    const match = rawLine.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2].trim();
    if (value.startsWith('"')) {
      const end = value.lastIndexOf('"');
      value = end > 0 ? value.slice(1, end) : value.slice(1);
      value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else if (value.startsWith("'")) {
      const end = value.lastIndexOf("'");
      value = end > 0 ? value.slice(1, end) : value.slice(1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    parsed[key] = value;
  }

  return parsed;
}

function fail(message) {
  console.error(`[agentic-db] ${message}`);
  process.exit(1);
}

const rootEnv = parseEnvFile(path.join(repoRoot, '.env'));
const serviceEnv = parseEnvFile(path.join(serviceRoot, '.env'));
const loadedEnv = { ...rootEnv, ...serviceEnv, ...process.env };

const agenticOverride = process.env.AGENTIC_DATABASE_URL
  || serviceEnv.AGENTIC_DATABASE_URL
  || rootEnv.AGENTIC_DATABASE_URL;
const rawDatabaseUrl = agenticOverride
  || process.env.DATABASE_URL
  || serviceEnv.DATABASE_URL
  || rootEnv.DATABASE_URL;

if (!rawDatabaseUrl) {
  fail('DATABASE_URL is unavailable. Set AGENTIC_DATABASE_URL to a host-reachable MySQL connection URL.');
}

const databaseUrl = rawDatabaseUrl.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (placeholder, key) => (
  Object.prototype.hasOwnProperty.call(loadedEnv, key) ? loadedEnv[key] : placeholder
));

let parsedDatabaseUrl;
try {
  parsedDatabaseUrl = new URL(databaseUrl);
} catch {
  fail('The resolved database URL is invalid. Set AGENTIC_DATABASE_URL to a valid host-reachable MySQL URL.');
}

if (parsedDatabaseUrl.protocol !== 'mysql:') {
  fail('The resolved database URL does not use MySQL, which this Prisma schema requires. Set AGENTIC_DATABASE_URL to the agentic MySQL database URL.');
}

const hostname = parsedDatabaseUrl.hostname.toLowerCase();
const dockerOnlyHost = hostname === 'mysql'
  || hostname.endsWith('.docker.internal')
  || hostname.endsWith('.local.internal');
if (dockerOnlyHost) {
  fail('The resolved MySQL URL uses a container-only hostname that is not safe to assume from the host terminal. Set AGENTIC_DATABASE_URL to the explicit host-reachable URL.');
}

const prismaBinary = path.join(
  serviceRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'prisma.cmd' : 'prisma',
);
if (!fs.existsSync(prismaBinary)) {
  fail('The local Prisma binary is missing. Run npm install in this service; Prisma was not downloaded automatically.');
}

const result = spawnSync(prismaBinary, ['migrate', 'deploy'], {
  cwd: serviceRoot,
  env: {
    ...loadedEnv,
    DATABASE_URL: databaseUrl,
  },
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(`[agentic-db] Failed to start the local Prisma binary: ${result.error.message}`);
  process.exit(1);
}

process.exit(typeof result.status === 'number' ? result.status : 1);
