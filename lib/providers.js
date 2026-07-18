// lib/providers.js
// Registry of cloud LLM providers used as "Scribes" in Almanac AI.
// Every provider except Claude has a genuinely free tier that needs no payment card.
// Model IDs on free tiers shift fairly often — if a call starts failing, the first
// thing to check is whether the provider renamed/retired the model below.

const PROVIDERS = [
  {
    id: 'groq',
    name: 'Groq',
    envKey: 'GROQ_API_KEY',
    kind: 'openai',
    baseURL: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    free: true,
    signupUrl: 'https://console.groq.com/keys',
    notes: 'No credit card. Very fast (LPU hardware). Free tier is rate-limited per minute/day.'
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    envKey: 'GEMINI_API_KEY',
    kind: 'openai',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    free: true,
    signupUrl: 'https://aistudio.google.com/apikey',
    notes: 'No credit card. Generous free tier via Google AI Studio.'
  },
  {
    id: 'mistral',
    name: 'Mistral',
    envKey: 'MISTRAL_API_KEY',
    kind: 'openai',
    baseURL: 'https://api.mistral.ai/v1',
    model: 'mistral-small-latest',
    free: true,
    signupUrl: 'https://console.mistral.ai/api-keys',
    notes: 'Free "Experiment" tier; may ask you to opt in to data training for the full quota.'
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    envKey: 'CEREBRAS_API_KEY',
    kind: 'openai',
    baseURL: 'https://api.cerebras.ai/v1',
    model: 'llama-3.3-70b',
    free: true,
    signupUrl: 'https://cloud.cerebras.ai',
    notes: 'No credit card. Free catalog can shrink to very few models — check your dashboard.'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    envKey: 'OPENROUTER_API_KEY',
    kind: 'openai',
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    free: true,
    signupUrl: 'https://openrouter.ai/keys',
    notes: 'One key, many ":free" suffixed models. Daily free-request cap is low until you add $10 credit (raises the cap, doesn\'t spend it).'
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    envKey: 'NVIDIA_API_KEY',
    kind: 'openai',
    baseURL: 'https://integrate.api.nvidia.com/v1',
    model: 'meta/llama-3.3-70b-instruct',
    free: true,
    signupUrl: 'https://build.nvidia.com',
    notes: 'Free hosted evaluation endpoint for 100+ open models.'
  },
  {
    id: 'github',
    name: 'GitHub Models',
    envKey: 'GITHUB_MODELS_TOKEN',
    kind: 'openai',
    baseURL: 'https://models.inference.ai.azure.com',
    model: 'gpt-4o-mini',
    free: true,
    signupUrl: 'https://github.com/marketplace/models',
    notes: 'Use a GitHub personal access token. Rate limit tier depends on your GitHub plan.'
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    envKey: 'HF_API_KEY',
    kind: 'openai',
    baseURL: 'https://router.huggingface.co/v1',
    model: 'meta-llama/Llama-3.3-70B-Instruct',
    free: true,
    signupUrl: 'https://huggingface.co/settings/tokens',
    notes: 'Free tier, strict rate limits, huge model library if you swap the model id.'
  },
  {
    id: 'cohere',
    name: 'Cohere',
    envKey: 'COHERE_API_KEY',
    kind: 'cohere',
    model: 'command-r',
    free: true,
    signupUrl: 'https://dashboard.cohere.com/api-keys',
    notes: 'Free evaluation keys, native (non-OpenAI-shaped) API.'
  },
  {
    id: 'anthropic',
    name: 'Claude (optional, paid)',
    envKey: 'ANTHROPIC_API_KEY',
    kind: 'anthropic',
    model: 'claude-sonnet-4-6',
    free: false,
    signupUrl: 'https://console.anthropic.com',
    notes: 'Not a free tier — include only if you already have a key and want Claude in the mix.'
  }
];

function isConfigured(provider) {
  const val = process.env[provider.envKey];
  return typeof val === 'string' && val.trim().length > 0;
}

function availableProviders() {
  return PROVIDERS.filter(isConfigured).map((p) => ({
    id: p.id,
    name: p.name,
    model: p.model,
    free: p.free
  }));
}

async function callOpenAICompatible({ baseURL, apiKey, model, prompt, maxTokens = 800 }) {
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are a helpful, accurate assistant. Answer clearly and directly.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: maxTokens
    })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim();
}

async function callCohere({ apiKey, model, prompt, maxTokens = 800 }) {
  const res = await fetch('https://api.cohere.com/v2/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens
    })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  if (data.message && Array.isArray(data.message.content)) {
    return data.message.content.map((c) => c.text || '').join('').trim();
  }
  return (data.text || '').trim();
}

async function callAnthropic({ apiKey, model, prompt, maxTokens = 1000 }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.content || []).map((b) => b.text || '').join('').trim();
}

async function askProvider(providerId, prompt) {
  const provider = PROVIDERS.find((p) => p.id === providerId);
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);
  const apiKey = process.env[provider.envKey];
  if (!apiKey) throw new Error(`${provider.name} has no API key configured on the server`);

  if (provider.kind === 'openai') {
    return callOpenAICompatible({ baseURL: provider.baseURL, apiKey, model: provider.model, prompt });
  }
  if (provider.kind === 'cohere') {
    return callCohere({ apiKey, model: provider.model, prompt });
  }
  if (provider.kind === 'anthropic') {
    return callAnthropic({ apiKey, model: provider.model, prompt });
  }
  throw new Error(`No caller implemented for provider kind: ${provider.kind}`);
}

module.exports = { PROVIDERS, availableProviders, askProvider };
