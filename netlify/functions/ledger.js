const { getLedger } = require('../../lib/ledger');

exports.handler = async () => {
  try {
    const ledger = await getLedger();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ledger })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Could not load ledger' }) };
  }
};
