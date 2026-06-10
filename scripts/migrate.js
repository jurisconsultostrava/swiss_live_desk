const { Pool } = require('pg');
const { pickDatabaseUrl, shouldUseSsl } = require('./db-url');
const fs = require('fs');
const path = require('path');

async function main() {
  const databaseUrl = pickDatabaseUrl();
  if (!databaseUrl) {
    console.error('Není nastavena žádná PostgreSQL URL. Nastavte DATABASE_URL nebo DATABASE_PUBLIC_URL.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: shouldUseSsl(databaseUrl),
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 8000)
  });

  const schemaPath = path.join(__dirname, '..', 'sql', 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schemaSql);
  await pool.end();
  console.log('PostgreSQL migrace dokončena:', schemaPath);
}

main().catch((error) => {
  console.error('PostgreSQL migrace selhala:', error);
  process.exit(1);
});
