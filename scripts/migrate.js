// scripts/migrate.js
// Run with: npm run migrate
// Applies every .sql file in migrations/, in filename order. Each file is
// written to be idempotent (CREATE TABLE IF NOT EXISTS, etc.) so re-running
// this is always safe.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getPool } = require('../lib/db');

async function run() {
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  if (!files.length) {
    console.log('No migration files found.');
    return;
  }

  const pool = getPool();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    console.log(`Applying ${file}...`);
    await pool.query(sql);
    console.log(`  done.`);
  }
  console.log('All migrations applied.');
  await pool.end();
}

run().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
