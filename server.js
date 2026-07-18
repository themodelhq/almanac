// server.js — runs on Render (or any Node host, or your own machine).
require('dotenv').config();
const express = require('express');
const path = require('path');
const { availableProviders, askProvider } = require('./lib/providers');
const { applyVote } = require('./lib/ledger');
const { readLedger, writeLedger } = require('./lib/store');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
  const ledger = await readLedger();
  res.json({ ledger });
});

app.post('/api/vote', async (req, res) => {
  const { aId, bId, result } = req.body || {};
  if (!aId || !bId || !result) {
    return res.status(400).json({ error: 'aId, bId and result are required' });
  }
  let ledger = await readLedger();
  ledger = applyVote(ledger, aId, bId, result);
  await writeLedger(ledger);
  res.json({ ledger });
});

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Almanac AI listening on port ${PORT}`);
});
