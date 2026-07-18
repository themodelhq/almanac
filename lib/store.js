// lib/store.js
// Netlify Functions are stateless, so on Netlify we persist the shared ledger in
// Netlify Blobs (free, built-in key/value storage). On Render (a normal long-lived
// Node process) we just keep a JSON file on disk. Render's free-tier disk is wiped
// on redeploy, not on every request, so this is fine for a demo leaderboard —
// swap in a real database if you need it to survive redeploys.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const LEDGER_FILE = path.join(DATA_DIR, 'ledger.json');

async function getNetlifyBlobStore() {
  if (!process.env.NETLIFY) return null;
  try {
    const { getStore } = await import('@netlify/blobs');
    return getStore('almanac-ledger');
  } catch (e) {
    return null;
  }
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function readLedger() {
  const blobs = await getNetlifyBlobStore();
  if (blobs) {
    const val = await blobs.get('ledger', { type: 'json' });
    return val || {};
  }
  ensureDir();
  if (!fs.existsSync(LEDGER_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

async function writeLedger(ledger) {
  const blobs = await getNetlifyBlobStore();
  if (blobs) {
    await blobs.setJSON('ledger', ledger);
    return;
  }
  ensureDir();
  fs.writeFileSync(LEDGER_FILE, JSON.stringify(ledger, null, 2));
}

module.exports = { readLedger, writeLedger };
