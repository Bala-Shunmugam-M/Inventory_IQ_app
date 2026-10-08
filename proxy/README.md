# InventoryIQ LLM Proxy (Cloudflare Worker)

Keeps your Groq API key off the phone. The app calls this Worker; the Worker
adds the secret key and forwards the request to Groq.

## Deploy (one time)

```bash
npm i -g wrangler
wrangler login

cd proxy
wrangler secret put GROQ_API_KEY     # paste gsk_... when prompted
wrangler deploy
```

Wrangler prints a URL like `https://inventoryiq-llm-proxy.<you>.workers.dev`.

## Point the app at it

In `docs/index.html` and `docs/dashboard.html`, set `AI_CFG.proxy` to the worker
URL and leave `AI_CFG.apiKey` empty — no key ships in the page.

## What the worker enforces

- Only origins in `ALLOWED_ORIGINS` (your GitHub Pages origin) are served.
  Add `http://localhost:<port>` there for local testing.
- Model is pinned (`MODEL`), `max_tokens` capped at 2000, body capped at 64 KB.
- 20 requests / minute per IP via the `LIMITER` binding in `wrangler.toml`.

Origin checks only stop browsers; the rate limit is what stops scripts.

## Switch provider

Edit `UPSTREAM` in `worker.js` (and the matching secret), then `wrangler deploy`:

- Gemini: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
- Cerebras: `https://api.cerebras.ai/v1/chat/completions`
- SambaNova: `https://api.sambanova.ai/v1/chat/completions`
