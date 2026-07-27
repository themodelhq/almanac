const { PROVIDERS } = require('../../lib/providers');

exports.handler = async () => {
  const keys = [...new Set([...PROVIDERS.map((p) => p.envKey), 'DATABASE_URL'])];
  const status = {};
  keys.forEach((k) => { status[k] = !!(process.env[k] && process.env[k].trim()); });
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(status)
  };
};
