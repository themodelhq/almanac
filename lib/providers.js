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
    model: 'command-r7b-12-2024',
    free: true,
    signupUrl: 'https://dashboard.cohere.com/api-keys',
    notes: 'Free evaluation keys, native (non-OpenAI-shaped) API. Cohere retires model IDs fairly often — check docs.cohere.com/docs/models if this one stops working.'
  },
  {
    id: 'zai',
    name: 'Z.ai (GLM)',
    envKey: 'ZAI_API_KEY',
    kind: 'openai',
    baseURL: 'https://api.z.ai/api/paas/v4',
    model: 'glm-4.7-flash',
    free: true,
    signupUrl: 'https://docs.z.ai/guides/overview/quick-start',
    notes: 'GLM-4.7-Flash is officially free. The same ZAI_API_KEY also unlocks higher-quality image generation and video generation in Agent Mode — see README.'
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

// Every registered provider, configured or not — lets Agent Mode's dropdown
// show the full lineup (e.g. Z.ai) even before its key is set, with a clear
// "needs API key" flag, instead of silently omitting it. Battle Mode keeps
// using availableProviders() above and is unaffected by this.
function allProvidersCatalog() {
  return PROVIDERS.map((p) => ({
    id: p.id,
    name: p.name,
    model: p.model,
    free: p.free,
    envKey: p.envKey,
    configured: isConfigured(p)
  }));
}

async function callOpenAICompatible({ baseURL, apiKey, model, system, messages, maxTokens = 800 }) {
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, ...messages],
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

async function callCohere({ apiKey, model, system, messages, maxTokens = 800 }) {
  const res = await fetch('https://api.cohere.com/v2/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, ...messages],
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

async function callAnthropic({ apiKey, model, system, messages, maxTokens = 1000 }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      system,
      max_tokens: maxTokens,
      messages
    })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.content || []).map((b) => b.text || '').join('').trim();
}

const DEFAULT_SYSTEM = 'You are a helpful, accurate assistant. Answer clearly and directly.';

// Battle Mode: one question, one answer. Unchanged behavior for existing callers.
async function askProvider(providerId, prompt) {
  return askProviderMessages(providerId, DEFAULT_SYSTEM, [{ role: 'user', content: prompt }]);
}

// Agent Mode: full control over the system prompt and message history, so the
// agent loop in lib/agent.js can feed back tool results as the conversation grows.
async function askProviderMessages(providerId, system, messages, maxTokens) {
  const provider = PROVIDERS.find((p) => p.id === providerId);
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);
  const apiKey = process.env[provider.envKey];
  if (!apiKey) throw new Error(`${provider.name} has no API key configured on the server`);

  const args = { apiKey, model: provider.model, system, messages, ...(maxTokens ? { maxTokens } : {}) };

  if (provider.kind === 'openai') {
    return callOpenAICompatible({ baseURL: provider.baseURL, ...args });
  }
  if (provider.kind === 'cohere') {
    return callCohere(args);
  }
  if (provider.kind === 'anthropic') {
    return callAnthropic(args);
  }
  throw new Error(`No caller implemented for provider kind: ${provider.kind}`);
}

module.exports = { PROVIDERS, availableProviders, allProvidersCatalog, askProvider, askProviderMessages };
