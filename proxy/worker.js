/**
 * InventoryIQ — LLM Proxy (Cloudflare Worker)
 *
 * Keeps your Groq API key OFF the phone. The app calls THIS worker;
 * the worker adds the secret key and forwards to Groq (or any
 * OpenAI-compatible provider). The key lives only as a Wrangler secret.
 *
 * Deploy:
 *   1) npm i -g wrangler && wrangler login
 *   2) cd proxy
 *   3) wrangler secret put GROQ_API_KEY      # paste gsk_... when prompted
 *   4) wrangler deploy
 *   5) Copy the printed *.workers.dev URL into the app:
 *        src/lib/ai.js  →  AI_PROXY_URL = 'https://<your-worker>.workers.dev'
 *
 * Switch providers by changing UPSTREAM (and the matching secret name).
 */

// Upstream OpenAI-compatible endpoint. Default = Groq.
const UPSTREAM = 'https://api.groq.com/openai/v1/chat/completions';

// Optional: lock down who can call this worker. Leave '*' for any origin
// (fine for a mobile app), or set to your web dashboard origin.
const ALLOWED_ORIGIN = '*';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders() });
    }
    if (!env.GROQ_API_KEY) {
      return json({ error: 'Server not configured: GROQ_API_KEY secret missing' }, 500);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    // Forward the chat-completion request to the upstream provider.
    let upstream;
    try {
      upstream = await fetch(UPSTREAM, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      return json({ error: 'Upstream network error: ' + e.message }, 502);
    }

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}
