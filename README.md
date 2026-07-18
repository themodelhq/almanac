# Almanac AI

A free, blind arena for cloud LLMs. Ask a question, two anonymous "scribes" (two
different real AI providers) answer it, you vote for the better one, and a shared,
Elo-style ledger keeps score over time. Same mechanic as chat-arena sites — just
running on your own free-tier keys instead of one company's paid backend.

Fully working on **Netlify** (serverless functions) and **Render** (a normal Node
web service) from this one codebase.

---

## 1. How it's put together

```
almanac-ai/
├── public/              ← the app (static, served as-is by both platforms)
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── manifest.json    ← PWA manifest
│   ├── sw.js             ← service worker (offline app-shell caching)
│   └── icon.svg
├── lib/
│   ├── providers.js     ← every provider's config + API caller
│   ├── ledger.js        ← Elo rating math (shared by both backends)
│   └── store.js         ← ledger persistence (Netlify Blobs or a JSON file)
├── server.js            ← Express backend — used by Render / local dev
├── netlify/functions/   ← the same four endpoints as separate serverless functions
├── netlify.toml         ← Netlify build + routing config
├── render.yaml          ← Render Blueprint (one Blueprint deploy sets it all up)
├── package.json
└── .env.example
```

The browser never sees any API key. It only ever calls your own backend
(`/api/providers`, `/api/chat`, `/api/ledger`, `/api/vote`), which holds the real
provider keys as server-side environment variables and forwards requests.

---

## 2. Get free API keys (pick as many as you like — 2 minimum to duel)

All of these have a genuine free tier and none but Claude requires payment info,
though a couple ask for a phone number. Free-tier limits and even model names
shift over time, so if a provider starts erroring, check its dashboard first —
the exact model ID in `lib/providers.js` may need a one-line update.

| Provider | Env var | Get a key | Notes |
|---|---|---|---|
| Groq | `GROQ_API_KEY` | console.groq.com/keys | No card. Extremely fast. |
| Google Gemini | `GEMINI_API_KEY` | aistudio.google.com/apikey | No card. Most generous free daily quota. |
| Mistral | `MISTRAL_API_KEY` | console.mistral.ai/api-keys | Free "Experiment" tier may require opting in to data training. |
| Cerebras | `CEREBRAS_API_KEY` | cloud.cerebras.ai | No card. Free model list can be small — check your dashboard. |
| OpenRouter | `OPENROUTER_API_KEY` | openrouter.ai/keys | One key, 20+ `:free` models. Low daily cap until you've added $10 credit (this raises the free cap; you don't have to spend it). |
| NVIDIA NIM | `NVIDIA_API_KEY` | build.nvidia.com | No card. 100+ hosted open models. |
| GitHub Models | `GITHUB_MODELS_TOKEN` | github.com/marketplace/models (use a GitHub personal access token) | Rate limit scales with your GitHub plan. |
| Hugging Face | `HF_API_KEY` | huggingface.co/settings/tokens | Free tier, strict rate limits. |
| Cohere | `COHERE_API_KEY` | dashboard.cohere.com/api-keys | Free evaluation key. |
| Claude (optional) | `ANTHROPIC_API_KEY` | console.anthropic.com | **Not free** — only add this if you already have a key and want Claude in the mix. |

Almanac AI automatically detects which env vars are set and only uses those
providers — you don't have to edit any code to add or remove a scribe.

---

## 3. Run it locally first (recommended)

```bash
npm install
cp .env.example .env
# open .env and paste in at least two API keys
npm start
# visit http://localhost:3000
```

---

## 4. Deploy to Render

Render runs `server.js` as a normal always-on (well, free-tier-sleeps-when-idle)
Node process, so the ledger persists to a JSON file on disk between requests.

1. Push this folder to a GitHub (or GitLab) repo.
2. In the Render dashboard: **New → Blueprint**, point it at your repo. Render
   will read `render.yaml` and create the web service automatically.
   - No `render.yaml`? Use **New → Web Service** instead, with:
     - Build command: `npm install`
     - Start command: `node server.js`
     - Plan: Free
3. Under the new service's **Environment** tab, add whichever provider keys from
   the table above you want to use (only the ones you have — leave the rest
   blank/unset).
4. Deploy. Render gives you a URL like `https://almanac-ai.onrender.com`.

Note: Render's free-tier disk resets on redeploy (not on every request), so the
ledger survives normal traffic but not a fresh deploy. Swap `lib/store.js` for a
real database (Render's free Postgres, for example) if you want it to survive
redeploys long-term.

---

## 5. Deploy to Netlify

Netlify runs the four `netlify/functions/*.js` files as separate serverless
functions, and the ledger persists in **Netlify Blobs** (built-in, free key/value
storage — no extra setup needed).

1. Push this folder to a GitHub (or GitLab) repo.
2. In the Netlify dashboard: **Add new site → Import an existing project**, pick
   your repo. Netlify reads `netlify.toml` and configures the build, publish
   directory, and function routing automatically.
3. Under **Site configuration → Environment variables**, add whichever provider
   keys you want to use (same table as above).
4. Deploy. Netlify gives you a URL like `https://almanac-ai.netlify.app`.

Or deploy straight from your machine without a git repo:

```bash
npm install -g netlify-cli
netlify login
netlify init
netlify env:set GROQ_API_KEY "your-key-here"
netlify env:set GEMINI_API_KEY "your-key-here"
# ...repeat for whichever providers you're using
netlify deploy --prod
```

---

## 6. Installing it as an actual app

Once deployed (Netlify or Render — real HTTPS domain, not a local sandbox), open
the URL on a phone or in Chrome/Edge on desktop and use "Add to Home Screen" /
the install icon in the address bar. The manifest and service worker make it
installable and give it basic offline app-shell caching; live answers still need
a network connection.

---

## 7. Adding another provider later

Open `lib/providers.js` and add an entry to the `PROVIDERS` array with an `id`,
`name`, `envKey`, `kind` (`'openai'` for any OpenAI-compatible endpoint, or write
a new caller like `callCohere`/`callAnthropic` for anything else), `baseURL`, and
`model`. Set the matching env var on Netlify/Render and it appears in the arena
automatically — no frontend changes needed.
