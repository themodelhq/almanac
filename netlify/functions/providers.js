const { availableProviders, allProvidersCatalog } = require('../../lib/providers');

exports.handler = async () => {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providers: availableProviders(), allProviders: allProvidersCatalog() })
  };
};
