const { isAvailable: webSearchAvailable } = require('../../lib/tools/webSearch');
const { zaiConfigured } = require('../../lib/tools/imageGen');
const { isAvailable: videoGenAvailable } = require('../../lib/tools/videoGen');

exports.handler = async () => {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      webSearch: webSearchAvailable(),
      imageGen: true,
      imageGenProvider: zaiConfigured() ? 'zai' : 'pollinations',
      videoGen: videoGenAvailable(),
      writeFile: true
    })
  };
};
