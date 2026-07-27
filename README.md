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
│   ├── index.html        ← sidebar + chat-thread app shell
│   ├── styles.css
│   ├── app.js             ← Battle Mode + sidebar/mode-tab wiring
│   ├── agent.js            ← Agent Mode (chat UI, sessions, uploads, tool rendering)
│   ├── manifest.json      ← PWA manifest
│   ├── sw.js               ← service worker (offline app-shell caching)
│   └── icon.svg
├── lib/
│   ├── providers.js       ← every provider's config + API caller
│   ├── ledger.js           ← Elo rating math + transactional Postgres updates
│   ├── db.js                ← Postgres connection pool (tuned per platform)
│   ├── agent.js             ← ReAct-style agent loop (one step per call)
│   └── tools/
│       ├── webSearch.js    ← DuckDuckGo HTML search (free, no key, always on)
│       ├── imageGen.js     ← Z.ai (if configured) with Pollinations fallback
│       ├── videoGen.js      ← Z.ai video, async submit + poll (optional)
│       └── fileIngest.js    ← reads uploaded attachments, incl. zip listings
├── migrations/
│   └── 001_init.sql      ← scribes + battles tables
├── scripts/
│   └── migrate.js         ← runs migrations/*.sql — `npm run migrate`
├── server.js            ← Express backend — used by Render / local dev
├── netlify/functions/   ← the same endpoints as separate serverless functions
├── netlify.toml         ← Netlify build + routing config
├── render.yaml          ← Render Blueprint — creates the web service AND the free Postgres database together
├── package.json
└── .env.example
```

The browser never sees any API key or database credential. It only ever calls
your own backend (`/api/providers`, `/api/chat`, `/api/ledger`, `/api/vote`,
`/api/agent`, `/api/tools`, `/api/video-status`), which holds every secret as a
server-side environment variable.

### Layout

The app is a sidebar + chat-thread shell, in the vein of Z.ai/ChatGPT/Claude's
own interfaces: a left sidebar with a **New Chat** button, a Battle/Agent mode
switcher, and a history list of past Agent Mode chats (stored per-device in
`localStorage`); the main panel holds whichever mode is active. Worth being
precise about what this is and isn't: it's the same general **layout pattern**
those products use (sidebar history + centered chat + bottom composer), built
with Almanac's own ink/parchment/brass visual language — not a pixel-for-pixel
skin of Z.ai's actual current interface. I don't have a verified live reference
for Z.ai's exact present-day design to copy faithfully, and reproducing another
product's specific visual identity wouldn't be the right move even if I did;
the sidebar-history-plus-chat pattern itself is a generic, widely-used
convention, not a proprietary look.

On narrow screens the sidebar collapses behind a ☰ toggle in the top-left.

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

## 2. Battle Mode vs Agent Mode

**Battle Mode** is the blind two-scribe duel described above.

**Agent Mode** lets you pick one scribe and hand it an open-ended task. It plans
its own steps and works through them autonomously — similar in spirit to
arena.ai's Agent Mode, with one deliberate difference:

| Capability | Included? |
|---|---|
| Multi-step autonomous planning | ✅ |
| Web search | ✅ (always on — DuckDuckGo, free, no key) |
| Image generation | ✅ (always on — Pollinations by default, upgrades to Z.ai if `ZAI_API_KEY` is set) |
| Video generation | ✅ (optional — needs `ZAI_API_KEY`; no free/keyless alternative exists for video) |
| File uploads (any type, including .zip) | ✅ (up to 3MB total per task) |
| Writing deliverable files (HTML, code, reports) | ✅ |
| Asking you a clarifying question mid-task | ✅ |
| Arbitrary shell / code **execution** in a sandbox | ❌ — not included, on purpose |

Why code execution is left out: running model-generated shell commands means
giving something you don't fully control the ability to run arbitrary code on
whatever server you deploy this to. That's a real remote-code-execution risk for
you as the operator, not a hypothetical one — so "write a file" made the cut and
"execute a file" didn't. If you want that capability later, it needs to run in
an actually isolated sandbox (a throwaway container/VM per task), which is a
meaningfully bigger infrastructure lift than anything else in this project.

Under the hood, Agent Mode is a simple ReAct-style loop: the model replies with
one JSON action per turn (`web_search`, `generate_image`, `generate_video`,
`write_file`, `ask_user`, or `final_answer`), the backend executes exactly that
action, and feeds the result back for the next turn — capped at 12 steps per
task. Each step is its own request, specifically so a long task doesn't blow
through Netlify's function time limit. Video is a deliberate exception to that
"one step, one request" rule: a render can take minutes, so the agent just
submits the job and moves on, while the browser polls a separate endpoint in
the background until the video is ready — that way waiting for a render never
eats into the 12-step budget or blocks the rest of the task.

### Web search: DuckDuckGo, always on, no key

Web search now needs zero configuration. It works by calling DuckDuckGo's
lightweight HTML results page (`html.duckduckgo.com/html/`) — DuckDuckGo has no
official public search API, so this is an unofficial integration, which makes
it the single most fragile piece of this project: DuckDuckGo can change its
page markup, rate-limit an IP, or serve a CAPTCHA at any time, with no
dashboard or changelog to watch the way an official API would have. If search
results start coming back empty or `lib/tools/webSearch.js` starts throwing,
that's the explanation, and the regex-based HTML parsing in that file is the
first thing to check against DuckDuckGo's current markup.

(This project's web search backend has now changed three times: Brave Search
API → Google Programmable Search Engine → DuckDuckGo. Brave dropped its free
tier for a paid metered one; Google's tier is still free but needed two keys'
worth of setup friction that wasn't worth it once a genuinely free, zero-config
option existed. If DuckDuckGo ever becomes unworkable too, that file is still
the one place to swap in a replacement.)

### File uploads — any file type, including .zip

The composer's 📎 button accepts any file type. What happens to it depends on
what it is, handled by `lib/tools/fileIngest.js`:

- **Text files** (code, markdown, JSON, CSV, HTML, etc.) are read directly and
  included in the agent's context (truncated past ~8,000 characters each).
- **Zip archives** are listed entry-by-entry (name + size) using `adm-zip` —
  this only reads the archive's contents as inert data, nothing is ever
  extracted to disk or executed. Small text files inside the zip (up to 5 of
  them, under 50KB each) have their contents included too, so the agent can
  actually read source files inside an uploaded project zip, not just see
  their names.
- **Everything else** (images, PDFs, other binaries) is noted by name/size/type
  but its contents aren't parsed in this build — the agent will tell you it
  can't read the file directly if it needs to.

Total attachments are capped at **3MB per task** (client-side and server-side),
which is deliberately conservative: everything travels as base64 inside a
single JSON request, and Netlify's serverless functions cap out around 6MB per
request including all the JSON overhead. Render's Express server doesn't have
that specific ceiling, but the same 3MB limit applies everywhere so behavior is
consistent regardless of where you've deployed.

### Optional: Z.ai (GLM) — one key, three upgrades

[Z.ai](https://z.ai) (the commercial arm of Zhipu AI's GLM model family) is
worth adding because a single `ZAI_API_KEY` does three things at once:

1. Adds **GLM-4.7-Flash** as a free scribe in Battle Mode and as an orchestrator
   option in Agent Mode (it's officially listed as a free model).
2. Upgrades Agent Mode's `generate_image` from Pollinations to Z.ai's own image
   model — it still falls back to Pollinations automatically if the Z.ai call
   ever fails.
3. Unlocks `generate_video` in Agent Mode — there's no free, keyless video
   generator equivalent to Pollinations, so this capability simply doesn't
   exist without a Z.ai key.

Get a key at `docs.z.ai/guides/overview/quick-start` → the Z.AI Open Platform →
API Keys. **Before relying on this for anything beyond testing, check Z.ai's
current billing page yourself** — GLM-4.7-Flash chat is documented as free, but
whether image generation and especially video generation fall under a free
allowance or start metering immediately isn't something this README can
promise, since Z.ai's free-tier terms (like most of the providers in this
project) have changed before and will likely change again. Video generation in
particular is compute-heavy and the kind of feature that free tiers usually
meter first.

The video tool here was written from Z.ai's published API documentation rather
than a live end-to-end test, since it involves an async submit-then-poll flow
(`POST /videos/generations` → `GET /async-result/{id}`). If it errors, `lib/tools/videoGen.js`
is the one file to check against `docs.z.ai/api-reference` for any renamed
fields or endpoints.

**Agent Mode's provider dropdown now always lists every registered provider**
(including Z.ai), not just configured ones — an unconfigured one just shows as
disabled with a "— needs API key" label, so you can always see it's a supported
option even before you've wired up its key.

**If a tool still shows "off" after adding the matching env var**, the
definitive check is `https://your-app.onrender.com/api/debug-env` (or the
equivalent Netlify URL) — it returns `true`/`false` for every env var this
project looks for (never the actual values, just whether each one is present),
so there's no ambiguity left. If it says `false` for a key you just set, the
server genuinely isn't seeing it — work through these in order:

1. **Exact variable name.** Case- and space-sensitive — `ZAI_API_KEY`, not
   `Z_AI_API_KEY` or with a trailing space in the value.
2. **Wrong service.** On Render, the key must be on the web service running
   `server.js` — not a different service, and not only on Netlify if you're
   testing the Render URL.
3. **No redeploy happened.** Adding an env var usually triggers an automatic
   redeploy — check the service's **Events** tab for a deploy timestamp *after*
   you saved it; if there isn't one, trigger **Deploy latest commit** manually.
4. Once `/api/debug-env` shows `true`, `/api/tools` and `/api/providers` should
   immediately reflect it too — if the page itself still looks stale, that's
   just a cached page load (hard refresh with Ctrl+Shift+R).

Without a Z.ai key set, Agent Mode still works fine for search, images, and
files — video generation is simply unavailable.

---

## 3. Get free API keys (pick as many as you like — 2 minimum to duel)

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
| Z.ai (GLM) | `ZAI_API_KEY` | docs.z.ai/guides/overview/quick-start | Free chat model (GLM-4.7-Flash); also upgrades/unlocks Agent Mode's image and video generation — see Agent Mode section below. |
| Claude (optional) | `ANTHROPIC_API_KEY` | console.anthropic.com | **Not free** — only add this if you already have a key and want Claude in the mix. |

Almanac AI automatically detects which env vars are set and only uses those
providers — you don't have to edit any code to add or remove a scribe.

---

## 4. Create the Render Postgres database

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

## 5. Run it locally first (recommended)

```bash
npm install
cp .env.example .env
# open .env and paste in: DATABASE_URL (the External URL) and at least two provider keys
npm start
# visit http://localhost:3000
```

---

## 6. Deploy to Render

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

## 7. Deploy to Netlify

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

## 8. Installing it as an actual app

Once deployed (Netlify or Render — real HTTPS domain, not a local sandbox), open
the URL on a phone or in Chrome/Edge on desktop and use "Add to Home Screen" /
the install icon in the address bar. The manifest and service worker make it
installable and give it basic offline app-shell caching; live answers still need
a network connection.

---

## 9. Adding another provider later

Open `lib/providers.js` and add an entry to the `PROVIDERS` array with an `id`,
`name`, `envKey`, `kind` (`'openai'` for any OpenAI-compatible endpoint, or write
a new caller like `callCohere`/`callAnthropic` for anything else), `baseURL`, and
`model`. Set the matching env var on Netlify/Render and it appears in the arena
automatically — no frontend changes needed.
