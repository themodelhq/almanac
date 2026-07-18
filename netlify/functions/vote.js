const { readLedger, writeLedger } = require('../../lib/store');
const { applyVote } = require('../../lib/ledger');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  try {
    const { aId, bId, result } = JSON.parse(event.body || '{}');
    if (!aId || !bId || !result) {
      return { statusCode: 400, body: JSON.stringify({ error: 'aId, bId and result are required' }) };
    }
    let ledger = await readLedger();
    ledger = applyVote(ledger, aId, bId, result);
    await writeLedger(ledger);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ledger })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Vote failed' }) };
  }
};
