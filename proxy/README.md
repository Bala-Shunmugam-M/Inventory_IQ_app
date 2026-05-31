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

In `mobile/src/lib/ai.js`:

```js
export const AI_PROXY_URL = 'https://inventoryiq-llm-proxy.<you>.workers.dev';
```

Leave `AI_API_KEY` empty — when `AI_PROXY_URL` is set, the app uses the proxy
and no key ships in the build.

## Switch provider

Edit `UPSTREAM` in `worker.js` (and the matching secret), then `wrangler deploy`:

- Gemini: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
- Cerebras: `https://api.cerebras.ai/v1/chat/completions`
- SambaNova: `https://api.sambanova.ai/v1/chat/completions`
