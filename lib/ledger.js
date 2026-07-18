// lib/ledger.js — Elo-style rating update for the shared leaderboard.
const { PROVIDERS } = require('./providers');

const K = 32;

function expected(ra, rb) {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

function ensureEntry(ledger, id) {
  if (!ledger[id]) {
    const p = PROVIDERS.find((p) => p.id === id);
    ledger[id] = {
      name: p ? p.name : id,
      model: p ? p.model : '',
      rating: 1500,
      wins: 0,
      losses: 0,
      ties: 0,
      matches: 0
    };
  }
  return ledger[id];
}

// result: 'A' | 'B' | 'tie' | 'bad'
function applyVote(ledger, aId, bId, result) {
  const a = ensureEntry(ledger, aId);
  const b = ensureEntry(ledger, bId);
  const ea = expected(a.rating, b.rating);
  const eb = 1 - ea;
  let sa, sb;
  if (result === 'A') {
    sa = 1; sb = 0; a.wins++; b.losses++;
  } else if (result === 'B') {
    sa = 0; sb = 1; b.wins++; a.losses++;
  } else {
    sa = 0.5; sb = 0.5; a.ties++; b.ties++;
  }
  a.rating += K * (sa - ea);
  b.rating += K * (sb - eb);
  a.matches++;
  b.matches++;
  return ledger;
}

module.exports = { applyVote };
