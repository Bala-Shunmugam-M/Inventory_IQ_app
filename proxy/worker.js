/**
 * InventoryIQ — LLM Proxy (Cloudflare Worker)
 *
 * Keeps your Groq API key OFF the client. The web app calls THIS worker;
 * the worker adds the secret key and forwards to Groq (or any
 * OpenAI-compatible provider). The key lives only as a Wrangler secret.
 *
 * The worker is NOT a general relay: it pins the model, caps tokens and
 * body size, only answers allowed browser origins, and (if the LIMITER
 * binding in wrangler.toml is present) rate-limits per IP.
 *
 * Deploy:
 *   1) npm i -g wrangler && wrangler login
 *   2) cd proxy
 *   3) wrangler secret put GROQ_API_KEY      # paste gsk_... when prompted
 *   4) wrangler deploy
 *   5) Put the printed *.workers.dev URL in AI_CFG.proxy (docs/index.html, docs/dashboard.html)
 */

const UPSTREAM = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';
const MAX_TOKENS = 2000; // the web app asks for at most 1800
const MAX_BODY = 64 * 1024;

// Browser origins allowed to call the worker. Add http://localhost:<port> for local dev.
// ponytail: Origin is enforced by browsers only — curl can fake it. The LIMITER binding caps the rest.
export const ALLOWED_ORIGINS = ['https://bala-shunmugam-m.github.io'];

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

// Rebuild the request from an allowlist of fields so callers can't pick the model or token budget.
export function sanitizeBody(body) {
  if (!body || !Array.isArray(body.messages) || !body.messages.length) return null;
  const messages = body.messages.map((m) => ({
    role: m && ['system', 'user', 'assistant'].includes(m.role) ? m.role : 'user',
    content: String((m && m.content) || ''),
  }));
  const t = Number(body.temperature);
  return {
    model: MODEL,
    messages,
    temperature: Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0.4,
    max_tokens: Math.min(MAX_TOKENS, Math.max(1, Number(body.max_tokens) || 900)),
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);
    const json = (obj, status) =>
      new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'Origin not allowed' }, 403);
    if (!env.GROQ_API_KEY) return json({ error: 'Server not configured: GROQ_API_KEY secret missing' }, 500);

    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'anon' });
      if (!success) return json({ error: 'Too many requests — try again in a minute' }, 429);
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY) return json({ error: 'Request too large' }, 413);
    let body;
    try {
      body = sanitizeBody(JSON.parse(raw));
    } catch {
      body = null;
    }
    if (!body) return json({ error: 'Invalid request body' }, 400);

    let upstream;
    try {
      upstream = await fetch(UPSTREAM, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      return json({ error: 'Upstream network error: ' + e.message }, 502);
    }
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  },
};
