const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL není nastaven.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : undefined });
  const schema = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
  await pool.query(schema);
  await pool.end();
  console.log('Schema created. Server při startu doplní demo účet a karty.');
}
main().catch(err => { console.error(err); process.exit(1); });
