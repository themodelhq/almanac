const { checkVideo } = require('../../lib/tools/videoGen');

exports.handler = async (event) => {
  const jobId = event.queryStringParameters && event.queryStringParameters.jobId;
  if (!jobId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'jobId is required' }) };
  }
  try {
    const result = await checkVideo(jobId);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: err.message || 'Could not check video status' }) };
  }
};
