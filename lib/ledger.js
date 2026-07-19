// lib/ledger.js — Elo-style rating, now backed by Postgres instead of a file/blob.
// Concurrent votes on the same scribe are made safe with SELECT ... FOR UPDATE
// inside a transaction, so two people voting at the same instant can't clobber
// each other's rating update.

const db = require('./db');
const { PROVIDERS } = require('./providers');

const K = 32;

function expected(ra, rb) {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

async function ensureRow(client, id) {
  const p = PROVIDERS.find((p) => p.id === id);
  await client.query(
    `INSERT INTO scribes (id, name, model) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [id, p ? p.name : id, p ? p.model : '']
  );
}

async function getLedger() {
  const { rows } = await db.query('SELECT * FROM scribes ORDER BY rating DESC');
  const ledger = {};
  rows.forEach((r) => {
    ledger[r.id] = {
      name: r.name,
      model: r.model,
      rating: Number(r.rating),
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      matches: r.matches
    };
  });
  return ledger;
}

// result: 'A' | 'B' | 'tie'
async function applyVote(aId, bId, result, promptText) {
  const pool = db.getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureRow(client, aId);
    await ensureRow(client, bId);

    // Lock both rows in a fixed order (sorted by id) so two simultaneous votes
    // involving an overlapping pair can never deadlock against each other.
    const [first, second] = [aId, bId].sort();
    const { rows } = await client.query(
      'SELECT * FROM scribes WHERE id IN ($1, $2) FOR UPDATE',
      [first, second]
    );
    const a = rows.find((r) => r.id === aId);
    const b = rows.find((r) => r.id === bId);

    const ea = expected(Number(a.rating), Number(b.rating));
    const eb = 1 - ea;

    let sa, sb, aWin = 0, aLoss = 0, aTie = 0, bWin = 0, bLoss = 0, bTie = 0;
    if (result === 'A') { sa = 1; sb = 0; aWin = 1; bLoss = 1; }
    else if (result === 'B') { sa = 0; sb = 1; bWin = 1; aLoss = 1; }
    else { sa = 0.5; sb = 0.5; aTie = 1; bTie = 1; }

    const newARating = Number(a.rating) + K * (sa - ea);
    const newBRating = Number(b.rating) + K * (sb - eb);

    await client.query(
      `UPDATE scribes
       SET rating = $1, wins = wins + $2, losses = losses + $3, ties = ties + $4,
           matches = matches + 1, updated_at = now()
       WHERE id = $5`,
      [newARating, aWin, aLoss, aTie, aId]
    );
    await client.query(
      `UPDATE scribes
       SET rating = $1, wins = wins + $2, losses = losses + $3, ties = ties + $4,
           matches = matches + 1, updated_at = now()
       WHERE id = $5`,
      [newBRating, bWin, bLoss, bTie, bId]
    );
    await client.query(
      'INSERT INTO battles (a_id, b_id, result, prompt) VALUES ($1, $2, $3, $4)',
      [aId, bId, result, promptText ? promptText.slice(0, 4000) : null]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return getLedger();
}

module.exports = { getLedger, applyVote };
