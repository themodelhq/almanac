const { askProvider } = require('../../lib/providers');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  try {
    const { providerId, prompt } = JSON.parse(event.body || '{}');
    if (!providerId || !prompt) {
      return { statusCode: 400, body: JSON.stringify({ error: 'providerId and prompt are required' }) };
    }
    const text = await askProvider(providerId, prompt);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: err.message || 'Provider request failed' }) };
  }
};
