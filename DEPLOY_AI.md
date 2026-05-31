# Deploy InventoryIQ with AI — full walkthrough

Goal: a secure, public site you open on your phone, with the Groq-powered
AI Advisor working — and your API key **not** exposed in the GitHub repo.

Architecture (all you need):

```
  Phone browser (PWA)  ──►  GitHub Pages (docs/index.html, dashboard.html)
                                      │  AI Advisor button → fetch
                                      ▼
                       Cloudflare Worker (holds Groq key as a secret)
                                      ▼
                                Groq LLM API
```

No separate app backend is required. The Worker is the only server piece,
and it exists purely to keep the key private.

---

## Step 1 — Deploy the key-holding Worker (one time)

```bash
npm i -g wrangler
wrangler login
cd proxy
wrangler secret put GROQ_API_KEY      # paste your gsk_... key when prompted
wrangler deploy
```

Copy the URL it prints, e.g. `https://inventoryiq-llm-proxy.<you>.workers.dev`.

> Regenerate your Groq key first if it was ever pasted into a screenshot or
> a public file. console.groq.com → API Keys.

## Step 2 — Point the site at the Worker (key stays out of the repo)

In **both** `docs/index.html` and `docs/dashboard.html`, find `AI_CFG` and set:

```js
var AI_CFG = {
  baseUrl: 'https://api.groq.com/openai/v1',
  model:   'llama-3.3-70b-versatile',
  apiKey:  '',                                              // leave EMPTY for public deploy
  proxy:   'https://inventoryiq-llm-proxy.<you>.workers.dev', // ← your Worker URL
  storageKey: 'inventoryiq_v8_data'
};
```

Because `apiKey` is empty and `proxy` is set, nothing secret is committed.

## Step 3 — Push to GitHub Pages

```bash
git add docs/
git commit -m "Add Groq AI Advisor (via Worker proxy)"
git push
```

In the repo: **Settings → Pages → Source: Deploy from branch → /docs**.
Wait ~1 min, then your site is live at the Pages URL.

## Step 4 — Install on your phone

Open the Pages URL on your phone → browser menu → **Add to Home Screen**.
It now launches full-screen like a native app, with all features including
the **🤖 AI Advisor** (button on the AI screen / bottom-right on desktop).

---

## Notes

- **Private repo + just testing?** You can skip the Worker and paste the key
  straight into `AI_CFG.apiKey` instead. Only do this if the repo is private.
- **Switch provider** anytime by changing `UPSTREAM` in `proxy/worker.js`
  (Gemini, Cerebras, SambaNova endpoints are listed there) and redeploying.
- **Expo APK** is the alternative native path; this PWA route matches your
  existing GitHub deploy and needs no build server.
- The AI never invents numbers — InventoryIQ computes stock/forecast locally
  and the LLM only explains, prioritizes, and writes the per-team briefs.
