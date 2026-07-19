# Almanac AI

A free, blind arena for cloud LLMs. Ask a question, two anonymous "scribes" (two
different real AI providers) answer it, you vote for the better one, and a shared,
Elo-style ledger — backed by a real Postgres database — keeps score over time.
Same mechanic as chat-arena sites — just running on your own free-tier keys
instead of one company's paid backend.

Fully working on **Netlify** (serverless functions) and **Render** (a normal Node
web service) from this one codebase, both reading and writing the same **Render
Postgres** database.

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
│   ├── ledger.js         ← Elo rating math + transactional Postgres updates
│   └── db.js              ← Postgres connection pool (tuned per platform)
├── migrations/
│   └── 001_init.sql      ← scribes + battles tables
├── scripts/
│   └── migrate.js         ← runs migrations/*.sql — `npm run migrate`
├── server.js            ← Express backend — used by Render / local dev
├── netlify/functions/   ← the same four endpoints as separate serverless functions
├── netlify.toml         ← Netlify build + routing config
├── render.yaml          ← Render Blueprint — creates the web service AND the free Postgres database together
├── package.json
└── .env.example
```

The browser never sees any API key or database credential. It only ever calls
your own backend (`/api/providers`, `/api/chat`, `/api/ledger`, `/api/vote`),
which holds every secret as a server-side environment variable.

**Why Postgres instead of a file or key-value blob:** two people voting at the
same instant need their rating updates to not clobber each other. `lib/ledger.js`
wraps every vote in a transaction with row-level locking (`SELECT ... FOR
UPDATE`), so concurrent votes are applied safely and in order. A flat JSON file
can't do that safely under concurrent writes.

A `battles` table also logs every judged duel (both scribe IDs, the result, and
the prompt) even though the current leaderboard only uses Elo — that history is
exactly what a future Bradley-Terry-style leaderboard would need, so it's captured
from day one instead of being lost.

**Honest caveat:** Render's free Postgres tier expires 30 days after creation
(you get a 14-day grace period to upgrade before it's actually deleted). It is
not a permanent free database. If you want this to run indefinitely for free,
plan to recreate the database (and re-run the migration) every ~30 days, or move
to a provider with a permanent free tier (e.g. Neon, Supabase) later — that's a
one-line `DATABASE_URL` change, nothing else in the code has to move.

---

## 2. Get free API keys (pick as many as you like — 2 minimum to duel)

All of these have a genuine free tier and none but Claude requires payment info,
though a couple ask for a phone number. Free-tier limits and even model names
shift over time, so if a provider starts erroring, check its dashboard first —
the exact model ID in `lib/providers.js` may need a one-line update (this
happened with Cohere retiring `command-r` — the current entry uses
`command-r7b-12-2024`).

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
| Cohere | `COHERE_API_KEY` | dashboard.cohere.com/api-keys | Free evaluation key. Model IDs retire often — check docs.cohere.com/docs/models if it errors. |
| Claude (optional) | `ANTHROPIC_API_KEY` | console.anthropic.com | **Not free** — only add this if you already have a key and want Claude in the mix. |

Almanac AI automatically detects which env vars are set and only uses those
providers — you don't have to edit any code to add or remove a scribe.

---

## 3. Create the Render Postgres database

1. Render dashboard → **New → PostgreSQL**
2. Name it whatever you like, pick the **Free** plan, create it.
3. Once it's up, open its page and find the **Connections** section — you'll see
   two connection strings:
   - **Internal Database URL** — only reachable from other services in the same
     Render account/region. Use this for the Render web service (faster, no
     bandwidth charges).
   - **External Database URL** — reachable from anywhere, including Netlify.
     Use this one for Netlify.
4. Run the migration once, from your own machine, using the **External** URL:
   ```bash
   npm install
   DATABASE_URL="paste-the-external-url-here" npm run migrate
   ```
   You should see `Applying 001_init.sql... done.` — that creates the `scribes`
   and `battles` tables. `server.js` also re-runs migrations automatically on
   every boot (they're idempotent), so this manual step is really just to
   confirm the connection works before you deploy.

If you deploy via the included `render.yaml` **Blueprint**, Render creates this
database for you automatically and wires the Internal URL into the web service's
`DATABASE_URL` — you'd only need to do the steps above if you're setting things
up manually instead, or if you need the External URL for Netlify.

---

## 4. Run it locally first (recommended)

```bash
npm install
cp .env.example .env
# open .env and paste in: DATABASE_URL (the External URL) and at least two provider keys
npm start
# visit http://localhost:3000
```

---

## 5. Deploy to Render

1. Push this folder to a GitHub (or GitLab) repo.
2. In the Render dashboard: **New → Blueprint**, point it at your repo. Render
   reads `render.yaml` and creates both the web service **and** the free
   Postgres database, already connected via `DATABASE_URL`.
   - No `render.yaml`? Use **New → Web Service** instead (build command
     `npm install`, start command `node server.js`, Free plan), then create the
     Postgres database separately (step 3 above) and paste its **Internal URL**
     into the web service's `DATABASE_URL` environment variable yourself.
3. Under the web service's **Environment** tab, add whichever provider keys from
   the table above you want to use (only the ones you have — leave the rest
   blank/unset).
4. Deploy. Render gives you a URL like `https://almanac-ai.onrender.com`.

---

## 6. Deploy to Netlify

Netlify runs the four `netlify/functions/*.js` files as separate serverless
functions. They connect to the **same Render Postgres database**, using its
**External Database URL** (Netlify isn't on Render's private network, so the
Internal URL won't work here).

1. Push this folder to a GitHub (or GitLab) repo.
2. In the Netlify dashboard: **Add new site → Import an existing project**, pick
   your repo. Netlify reads `netlify.toml` and configures the build, publish
   directory, and function routing automatically.
3. Under **Site configuration → Environment variables**, add:
   - `DATABASE_URL` — the Render database's **External Database URL**
   - whichever provider keys you want to use (same table as above)
4. Deploy. Netlify gives you a URL like `https://almanac-ai.netlify.app`.

Or deploy straight from your machine without a git repo:

```bash
npm install -g netlify-cli
netlify login
netlify init
netlify env:set DATABASE_URL "paste-the-external-render-url-here"
netlify env:set GROQ_API_KEY "your-key-here"
# ...repeat for whichever providers you're using
netlify deploy --prod
```

Because both deployments point at the same database, a vote cast on the Netlify
URL and a vote cast on the Render URL update the exact same shared leaderboard.

---

## 7. Installing it as an actual app

Once deployed (Netlify or Render — real HTTPS domain, not a local sandbox), open
the URL on a phone or in Chrome/Edge on desktop and use "Add to Home Screen" /
the install icon in the address bar. The manifest and service worker make it
installable and give it basic offline app-shell caching; live answers still need
a network connection.

---

## 8. Adding another provider later

Open `lib/providers.js` and add an entry to the `PROVIDERS` array with an `id`,
`name`, `envKey`, `kind` (`'openai'` for any OpenAI-compatible endpoint, or write
a new caller like `callCohere`/`callAnthropic` for anything else), `baseURL`, and
`model`. Set the matching env var on Netlify/Render and it appears in the arena
automatically — no frontend changes needed.
