function pickDatabaseUrl() {
  return process.env.DATABASE_URL
    || process.env.DATABASE_PUBLIC_URL
    || process.env.POSTGRES_URL
    || process.env.POSTGRES_PUBLIC_URL
    || process.env.DATABASE_PRIVATE_URL
    || process.env.POSTGRES_PRIVATE_URL
    || '';
}

function shouldUseSsl(connectionString) {
  if (!connectionString) return undefined;
  if (connectionString.includes('localhost') || connectionString.includes('127.0.0.1')) return undefined;
  if (connectionString.includes('sslmode=disable')) return undefined;
  return { rejectUnauthorized: false };
}

module.exports = { pickDatabaseUrl, shouldUseSsl };
