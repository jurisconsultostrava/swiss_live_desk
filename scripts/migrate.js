const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL není nastaven. Na Railway přidejte PostgreSQL a nastavte DATABASE_URL=${{Postgres.DATABASE_URL}}.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : undefined
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
