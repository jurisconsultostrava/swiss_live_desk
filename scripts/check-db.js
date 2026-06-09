const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL není nastaven.');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : undefined
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
