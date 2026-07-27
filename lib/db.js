// lib/db.js
// One Render Postgres database, reached two different ways:
//  - server.js (Render) is a long-lived process — one shared pool, reused across
//    every request. Use the *Internal* Database URL here (faster, no bandwidth
//    cost, only reachable from services in the same Render account/region).
//  - Netlify functions are stateless — a new process can spin up per request, so
//    we cap the pool at a single connection and close it quickly. Netlify is
//    outside Render's private network, so it MUST use the *External* Database
//    URL instead.
// Both simply read from process.env.DATABASE_URL — you just put a different
// value in on each platform. See README.md for exactly where to find each URL.

const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. See README.md to create a Render Postgres database and wire it up.');
  }

  const isServerless = !!process.env.NETLIFY;

  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }, // Render Postgres requires SSL
    max: isServerless ? 1 : 5,
    idleTimeoutMillis: isServerless ? 1000 : 30000,
    connectionTimeoutMillis: 10000
  });

  pool.on('error', (err) => {
    console.error('Unexpected Postgres pool error', err);
  });

  return pool;
}

async function query(text, params) {
  const client = await getPool().connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

module.exports = { getPool, query };
