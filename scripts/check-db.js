const { Pool } = require('pg');
const { pickDatabaseUrl, shouldUseSsl } = require('./db-url');

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
  const result = await pool.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
    order by table_name
  `);
  console.log('PostgreSQL OK. Tabulky:');
  for (const row of result.rows) console.log('-', row.table_name);
  await pool.end();
}

main().catch((error) => {
  console.error('DB check failed:', error);
  process.exit(1);
});
