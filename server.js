// server.js — runs on Render (or any Node host, or your own machine).
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { availableProviders, askProvider } = require('./lib/providers');
const { getLedger, applyVote } = require('./lib/ledger');
const { getPool } = require('./lib/db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function runMigrations() {
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const pool = getPool();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await pool.query(sql);
  }
  console.log(`Applied ${files.length} migration file(s).`);
}

app.get('/api/providers', (req, res) => {
  res.json({ providers: availableProviders() });
});

app.post('/api/chat', async (req, res) => {
  const { providerId, prompt } = req.body || {};
  if (!providerId || !prompt) {
    return res.status(400).json({ error: 'providerId and prompt are required' });
  }
  try {
    const text = await askProvider(providerId, prompt);
    res.json({ text });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Provider request failed' });
  }
});

app.get('/api/ledger', async (req, res) => {
  try {
    const ledger = await getLedger();
    res.json({ ledger });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not load ledger' });
  }
});

app.post('/api/vote', async (req, res) => {
  const { aId, bId, result, prompt } = req.body || {};
  if (!aId || !bId || !result) {
    return res.status(400).json({ error: 'aId, bId and result are required' });
  }
  try {
    const ledger = await applyVote(aId, bId, result, prompt);
    res.json({ ledger });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Vote failed' });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;

runMigrations()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Almanac AI listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to run migrations, starting anyway:', err.message);
    app.listen(PORT, () => {
      console.log(`Almanac AI listening on port ${PORT} (migrations were skipped)`);
    });
  });
