// Backend self-check. Run: node backend/test/run.mjs   (Node 22.5+ for node:sqlite; no wrangler, no npm)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker, { sanitizeBody, ALLOWED_ORIGINS } from '../src/index.js';

// Minimal D1 shim: prepare(sql).bind(...).first()/run()/all() over an in-memory SQLite.
function d1(db) {
  return {
    prepare(sql) {
      const st = db.prepare(sql);
      let args = [];
      const s = {
        bind: (...a) => ((args = a), s),
        first: async () => st.get(...args) ?? null,
        run: async () => ({ success: true, meta: { changes: Number(st.run(...args).changes) } }),
        all: async () => ({ results: st.all(...args) }),
      };
      return s;
    },
  };
}
const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
const env = { DB: d1(db), GROQ_API_KEY: 'k' };

const ORIGIN = ALLOWED_ORIGINS[0];
const call = (method, path, { token, body, origin, e = env } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
  return worker.fetch(new Request('https://w.example' + path, { method, headers, body }), e);
};
const put = (id, token, obj) => call('PUT', `/api/stores/${id}/snapshot`, { token, body: JSON.stringify(obj) });

// health
let r = await call('GET', '/api/health');
assert.equal(r.status, 200);
assert.deepEqual(await r.json(), { ok: true });

// create store
r = await call('POST', '/api/stores');
assert.equal(r.status, 201);
assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*');
const { storeId, token } = await r.json();
assert.match(storeId, /^IQ-[A-Z2-7]{10}$/);
assert.match(token, /^[A-Za-z0-9_-]{43}$/);
const stored = db.prepare('SELECT token_hash FROM stores WHERE id = ?').get(storeId);
assert.match(stored.token_hash, /^[0-9a-f]{64}$/);
assert.notEqual(stored.token_hash, token, 'only the hash is stored');

// get before any save: version 0, empty arrays
r = await call('GET', `/api/stores/${storeId}/snapshot`, { token });
assert.equal(r.status, 200);
assert.deepEqual(await r.json(), { version: 0, updatedAt: null, products: [], sales: [] });

// put/get roundtrip
const products = [{ id: 1, name: 'Atta 5kg', stock: 12, rop: 8, history: [3, 4] }, { id: 2.5, name: 'Dal' }];
const sales = [{ id: 1, qty: 2, at: '2026-10-08' }];
r = await put(storeId, token, { baseVersion: 0, products, sales });
assert.equal(r.status, 200);
const saved = await r.json();
assert.equal(saved.version, 1);
assert.ok(!Number.isNaN(Date.parse(saved.updatedAt)));
r = await call('GET', `/api/stores/${storeId}/snapshot`, { token });
assert.deepEqual(await r.json(), { version: 1, updatedAt: saved.updatedAt, products, sales });

// sales: null is stored as []
r = await put(storeId, token, { baseVersion: 1, products, sales: null });
assert.equal((await r.json()).version, 2);
assert.deepEqual((await (await call('GET', `/api/stores/${storeId}/snapshot`, { token })).json()).sales, []);

// stale baseVersion -> 409 with current version, nothing overwritten
r = await put(storeId, token, { baseVersion: 1, products: [], sales: [] });
assert.equal(r.status, 409);
const conflict = await r.json();
assert.equal(conflict.version, 2);
assert.ok(conflict.error && conflict.updatedAt);
assert.equal((await (await call('GET', `/api/stores/${storeId}/snapshot`, { token })).json()).products.length, 2);

// auth: wrong token, missing token, unknown store, malformed id -> all 401
const other = await (await call('POST', '/api/stores')).json();
assert.equal((await call('GET', `/api/stores/${storeId}/snapshot`, { token: other.token })).status, 401);
assert.equal((await call('GET', `/api/stores/${storeId}/snapshot`)).status, 401);
assert.equal((await put(storeId, 'nope', { baseVersion: 2, products: [] })).status, 401);
assert.equal((await call('GET', '/api/stores/IQ-AAAAAAAAAA/snapshot', { token })).status, 401);
assert.equal((await call('GET', '/api/stores/%zz/snapshot', { token })).status, 401);

// oversize -> 413
r = await put(storeId, token, { baseVersion: 2, products: [{ id: 1, name: 'x'.repeat(1024 * 1024) }] });
assert.equal(r.status, 413);

// bad bodies -> 400
for (const body of [
  { baseVersion: 2, products: 'nope' },
  { baseVersion: 2, products: [{ name: 'no id' }] },
  { baseVersion: 2, products: [{ id: '7' }] },
  { baseVersion: 2, products: [null] },
  { baseVersion: 2, products: Array.from({ length: 5001 }, (_, i) => ({ id: i })) },
  { baseVersion: 2, products: [], sales: 'x' },
  { baseVersion: '2', products: [] },
  { products: [] },
]) assert.equal((await put(storeId, token, body)).status, 400, JSON.stringify(body).slice(0, 80));
assert.equal((await call('PUT', `/api/stores/${storeId}/snapshot`, { token, body: 'not json' })).status, 400);
// non-JSON numbers can't sneak in: JSON has no NaN/Infinity, and 1e999 parses to Infinity
assert.equal((await call('PUT', `/api/stores/${storeId}/snapshot`, { token, body: '{"baseVersion":2,"products":[{"id":1e999}]}' })).status, 400);

// store creation is rate limited when LIMITER is bound
const deny = { ...env, LIMITER: { limit: async () => ({ success: false }) } };
assert.equal((await call('POST', '/api/stores', { e: deny })).status, 429);

// OPTIONS preflight
r = await call('OPTIONS', `/api/stores/${storeId}/snapshot`, { origin: 'http://localhost:5173' });
assert.equal(r.status, 204);
assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*');
assert.match(r.headers.get('Access-Control-Allow-Headers'), /Authorization/);
assert.match(r.headers.get('Access-Control-Allow-Headers'), /Content-Type/);
assert.match(r.headers.get('Access-Control-Allow-Methods'), /PUT/);
r = await call('OPTIONS', '/api/ai', { origin: ORIGIN });
assert.equal(r.status, 204);
assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);

// unknown route
assert.equal((await call('GET', '/api/nope')).status, 404);

// ---- AI proxy (moved from tests/check.mjs) ----
const b = sanitizeBody({ model: 'expensive-model', max_tokens: 99999, temperature: 5, messages: [{ role: 'tool', content: 'hi' }] });
assert.equal(b.model, 'llama-3.3-70b-versatile');
assert.equal(b.max_tokens, 2000);
assert.equal(b.temperature, 1);
assert.equal(b.messages[0].role, 'user');
assert.equal(sanitizeBody({}), null);

for (const path of ['/', '/api/ai']) {
  assert.equal((await call('POST', path, { origin: 'https://evil.example', body: '{}' })).status, 403);
  assert.equal((await call('POST', path, { body: '{}' })).status, 403);
  assert.equal((await call('POST', path, { origin: ORIGIN, body: 'not json' })).status, 400);
  assert.equal((await call('POST', path, { origin: ORIGIN, body: 'x'.repeat(70000) })).status, 413);
  assert.equal((await call('GET', path, { origin: ORIGIN })).status, 405);
}

// legacy POST / and /api/ai forward to Groq with the model pinned and the key added server-side
const realFetch = globalThis.fetch;
let sent;
globalThis.fetch = async (url, init) => {
  sent = { url, init };
  return new Response('{"choices":[]}', { status: 200 });
};
try {
  for (const path of ['/', '/api/ai']) {
    r = await call('POST', path, { origin: ORIGIN, body: JSON.stringify({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }) });
    assert.equal(r.status, 200);
    assert.equal(await r.text(), '{"choices":[]}');
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    assert.equal(JSON.parse(sent.init.body).model, 'llama-3.3-70b-versatile');
    assert.equal(sent.init.headers.Authorization, 'Bearer k');
  }
} finally {
  globalThis.fetch = realFetch;
}

console.log('backend: all checks passed');
