const { readLedger } = require('../../lib/store');

exports.handler = async () => {
  const ledger = await readLedger();
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ledger })
  };
};
