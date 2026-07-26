const { runAgentStep } = require('../../lib/agent');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  try {
    const { providerId, task, transcript } = JSON.parse(event.body || '{}');
    if (!providerId || (!task && !(transcript && transcript.length))) {
      return { statusCode: 400, body: JSON.stringify({ error: 'providerId and task (or an existing transcript) are required' }) };
    }
    const result = await runAgentStep({ providerId, task, transcript });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Agent step failed' }) };
  }
};
