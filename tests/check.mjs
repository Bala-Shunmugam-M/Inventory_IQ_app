// Self-check for the shared web core and the AI proxy. Run: node tests/check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const core = createRequire(import.meta.url)('../docs/iq-core.js');
const worker = await import('../proxy/worker.js');

// iqClean: data from backups / other devices can't inject markup or handler code
const [p] = core.iqClean([{ id: '1);alert(1);(', name: '<img src=x onerror=alert(1)>Atta', stock: '12', history: ['3', 'x'],
  tips: [{ title: '<b>t</b>', body: 'Order <strong>88</strong> <script>bad()</script>' }] }]);
assert.equal(typeof p.id, 'number');
assert.ok(Number.isFinite(p.id));
assert.equal(p.name, 'img src=x onerror=alert(1)Atta');
assert.equal(p.stock, 12);
assert.deepEqual(p.history, [3, 0]);
assert.equal(p.tips[0].body, 'Order <strong>88</strong> &lt;script&gt;bad()&lt;/script&gt;');
assert.equal(core.iqClean([{ id: 5 }, { id: 5 }]).map((x) => x.id).filter((x) => x === 5).length, 1, 'duplicate ids get fresh ones');

// iqLogSale: one history bucket per day
const q = { history: [4] };
core.iqLogSale(q, 2, '2026-10-08');
core.iqLogSale(q, 3, '2026-10-08');
core.iqLogSale(q, 1, '2026-10-09');
assert.deepEqual(q.history, [4, 5, 1]);

// iqForecast: rising demand is detected and forecast lands near the trend
const f = core.iqForecast({ demand: 10, history: [10, 12, 14, 16, 18, 20, 22] });
assert.equal(f.trend, 'up');
assert.ok(f.forecast >= 20 && f.forecast <= 25, `forecast ${f.forecast}`);
assert.equal(core.iqForecast({ demand: 7, history: [] }).forecast, 7);

// Ordering: an order that covers the gap clears the action; receiving moves it to stock
const r = { status: 'critical', stock: 10, rop: 30, incoming: 0, max: 100 };
assert.equal(core.iqNeedsAction(r), true);
r.incoming = 88;
assert.equal(core.iqNeedsAction(r), false);
core.iqReceive(r);
assert.deepEqual([r.stock, r.incoming], [98, 0]);

// Proxy: caller can't pick the model or blow the token budget
const b = worker.sanitizeBody({ model: 'expensive-model', max_tokens: 99999, temperature: 5, messages: [{ role: 'tool', content: 'hi' }] });
assert.equal(b.model, 'llama-3.3-70b-versatile');
assert.equal(b.max_tokens, 2000);
assert.equal(b.temperature, 1);
assert.equal(b.messages[0].role, 'user');
assert.equal(worker.sanitizeBody({}), null);

const call = (origin, body) => worker.default.fetch(
  new Request('https://w.example/', { method: 'POST', headers: origin ? { Origin: origin } : {}, body }), { GROQ_API_KEY: 'k' });
assert.equal((await call('https://evil.example', '{}')).status, 403);
assert.equal((await call(null, '{}')).status, 403);
assert.equal((await call(worker.ALLOWED_ORIGINS[0], 'not json')).status, 400);
assert.equal((await call(worker.ALLOWED_ORIGINS[0], 'x'.repeat(70000))).status, 413);

console.log('all checks passed');
