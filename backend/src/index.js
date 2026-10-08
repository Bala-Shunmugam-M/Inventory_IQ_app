/**
 * InventoryIQ backend (Cloudflare Worker + D1).
 *
 *   GET  /api/health                  -> { ok: true }
 *   POST /api/stores                  -> { storeId, token }
 *   GET  /api/stores/:id/snapshot     -> { version, updatedAt, products, sales }   (Bearer token)
 *   PUT  /api/stores/:id/snapshot     -> { version, updatedAt } | 409               (Bearer token)
 *   POST /api/ai   (and legacy POST /) -> Groq chat completion, model pinned
 *
 * Secrets: GROQ_API_KEY. Bindings: DB (D1), LIMITER (optional rate limit).
 * See backend/README.md for deploy steps and the full API contract.
 */

// Any OpenAI-compatible endpoint works (update the secret to match), e.g.
// Gemini: https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
// Cerebras: https://api.cerebras.ai/v1/chat/completions · SambaNova: https://api.sambanova.ai/v1/chat/completions
const UPSTREAM = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';
const MAX_TOKENS = 2000; // the web app asks for at most 1800
const MAX_AI_BODY = 64 * 1024;
const MAX_SNAPSHOT_BODY = 1024 * 1024;
const MAX_PRODUCTS = 5000;
const STORE_ID_RE = /^IQ-[A-Z2-7]{10}$/;

// Browser origins allowed to call the AI route. Add http://localhost:<port> for local dev.
// ponytail: Origin is enforced by browsers only — curl can fake it. The LIMITER binding caps the rest.
export const ALLOWED_ORIGINS = ['https://bala-shunmugam-m.github.io'];

const BASE_CORS = {
  'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

// AI route: only our own pages may spend the Groq budget from a browser.
function aiCors(origin) {
  return {
    ...BASE_CORS,
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    Vary: 'Origin',
  };
}

// Store routes: any origin. Auth is a bearer token the caller must already hold (no cookies or
// other ambient credentials), so a foreign page gains nothing from CORS access. `*` also covers
// localhost dev and file:// pages; the Expo app sends no Origin and ignores CORS entirely.
const OPEN_CORS = { ...BASE_CORS, 'Access-Control-Allow-Origin': '*' };

const json = (obj, status, cors) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });

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

async function limited(env, request, prefix) {
  if (!env.LIMITER) return false;
  const ip = request.headers.get('CF-Connecting-IP') || 'anon';
  const { success } = await env.LIMITER.limit({ key: prefix + ip });
  return !success;
}

async function handleAi(request, env) {
  const origin = request.headers.get('Origin') || '';
  const cors = aiCors(origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors);
  if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'Origin not allowed' }, 403, cors);
  if (!env.GROQ_API_KEY) return json({ error: 'Server not configured: GROQ_API_KEY secret missing' }, 500, cors);
  // Same key format as the old proxy so the deployed pages keep their per-IP budget.
  if (await limited(env, request, '')) return json({ error: 'Too many requests — try again in a minute' }, 429, cors);

  const raw = await request.text();
  if (raw.length > MAX_AI_BODY) return json({ error: 'Request too large' }, 413, cors);
  let body;
  try {
    body = sanitizeBody(JSON.parse(raw));
  } catch {
    body = null;
  }
  if (!body) return json({ error: 'Invalid request body' }, 400, cors);

  let upstream;
  try {
    upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return json({ error: 'Upstream network error: ' + e.message }, 502, cors);
  }
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

// ---- stores ----

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Both inputs are fixed-length hex hashes; compare without early exit.
function sameHash(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function createStore(request, env) {
  if (await limited(env, request, 'store:')) return json({ error: 'Too many requests — try again in a minute' }, 429, OPEN_CORS);
  // 256 % 32 === 0, so `& 31` is unbiased. 50 bits of id; a collision fails the INSERT (500), never merges stores.
  const storeId = 'IQ-' + [...randomBytes(10)].map((b) => B32[b & 31]).join('');
  const token = base64url(randomBytes(32));
  await env.DB.prepare('INSERT INTO stores (id, token_hash, created_at) VALUES (?, ?, ?)')
    .bind(storeId, await sha256hex(token), new Date().toISOString())
    .run();
  return json({ storeId, token }, 201, OPEN_CORS);
}

// Returns the store row, or null for a bad/missing token or unknown store (callers answer 401 for all).
async function authStore(request, env, storeId) {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer\s+(\S+)$/i);
  const given = await sha256hex(m ? m[1] : '');
  if (!m || !STORE_ID_RE.test(storeId)) return null;
  const row = await env.DB.prepare('SELECT * FROM stores WHERE id = ?').bind(storeId).first();
  return row && sameHash(given, row.token_hash) ? row : null;
}

async function getSnapshot(row) {
  return json(
    { version: row.version, updatedAt: row.updated_at, products: JSON.parse(row.products), sales: JSON.parse(row.sales) },
    200,
    OPEN_CORS
  );
}

async function putSnapshot(request, env, row) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_SNAPSHOT_BODY) return json({ error: 'Snapshot too large (max 1 MB)' }, 413, OPEN_CORS);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid JSON' }, 400, OPEN_CORS);
  }
  const bad = (error) => json({ error }, 400, OPEN_CORS);
  if (!body || typeof body !== 'object') return bad('Body must be an object');
  if (!Number.isInteger(body.baseVersion)) return bad('baseVersion must be an integer');
  const { products } = body;
  if (!Array.isArray(products)) return bad('products must be an array');
  if (products.length > MAX_PRODUCTS) return bad(`At most ${MAX_PRODUCTS} products`);
  if (!products.every((p) => p && typeof p === 'object' && !Array.isArray(p) && typeof p.id === 'number' && Number.isFinite(p.id)))
    return bad('Every product must be an object with a finite numeric id');
  const sales = body.sales ?? [];
  if (!Array.isArray(sales)) return bad('sales must be an array or null');

  const now = new Date().toISOString();
  // The version check lives in the WHERE clause, so two concurrent PUTs can't both win.
  const res = await env.DB.prepare(
    'UPDATE stores SET products = ?, sales = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?'
  )
    .bind(JSON.stringify(products), JSON.stringify(sales), now, row.id, body.baseVersion)
    .run();
  if (!res.meta.changes) {
    const cur = await env.DB.prepare('SELECT version, updated_at FROM stores WHERE id = ?').bind(row.id).first();
    return json({ error: 'Version conflict — pull the latest snapshot and retry', version: cur.version, updatedAt: cur.updated_at }, 409, OPEN_CORS);
  }
  return json({ version: body.baseVersion + 1, updatedAt: now }, 200, OPEN_CORS);
}

async function handleStores(request, env, path) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: OPEN_CORS });
  if (path === '/api/health') return request.method === 'GET' ? json({ ok: true }, 200, OPEN_CORS) : json({ error: 'Method not allowed' }, 405, OPEN_CORS);
  if (!env.DB) return json({ error: 'Server not configured: DB binding missing' }, 500, OPEN_CORS);

  if (path === '/api/stores') {
    return request.method === 'POST' ? createStore(request, env) : json({ error: 'Method not allowed' }, 405, OPEN_CORS);
  }
  const m = path.match(/^\/api\/stores\/([^/]+)\/snapshot$/);
  if (!m) return json({ error: 'Not found' }, 404, OPEN_CORS);
  if (request.method !== 'GET' && request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405, OPEN_CORS);
  const row = await authStore(request, env, m[1]);
  if (!row) return json({ error: 'Unauthorized' }, 401, OPEN_CORS);
  return request.method === 'GET' ? getSnapshot(row) : putSnapshot(request, env, row);
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    if (path === '/' || path === '/api/ai') return handleAi(request, env); // `/` = legacy proxy URL
    try {
      return await handleStores(request, env, path);
    } catch (e) {
      console.error(e);
      return json({ error: 'Internal error' }, 500, OPEN_CORS);
    }
  },
};
