// The React Native engine (mobile/src/lib) must give the same answers as the web core
// (docs/iq-core.js). RN packages aren't installed here, so we strip the imports and run the
// real mobile source against tiny stubs. Run: node tests/mobile-parity.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import worker from '../backend/src/index.js';

const core = createRequire(import.meta.url)('../docs/iq-core.js');
const src = (f) => readFileSync(new URL(`../mobile/src/lib/${f}`, import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\s*$/gm, '')   // drop imports (stubs below)
  .replace(/^export (default )?/gm, '');  // plain declarations
const names = (code) => [...code.matchAll(/^(?:async function|function|const|let)\s+(\w+)/gm)].map((m) => m[1]);
function load(code, scope) {
  const keys = Object.keys(scope);
  return new Function(...keys, `${code}\nreturn { ${names(code).join(', ')} };`)(...keys.map((k) => scope[k]));
}
const mem = new Map();
const AsyncStorage = { getItem: async (k) => mem.get(k) ?? null, setItem: async (k, v) => mem.set(k, v), multiRemove: async (ks) => ks.forEach((k) => mem.delete(k)) };
const m = load(src('storage.js'), { AsyncStorage, Alert: { alert() {} } });
const c = load(src('cloud.js'), { AsyncStorage, ...m });

// Same derived numbers on the demo catalog and on review edge cases
const cases = [
  JSON.parse(JSON.stringify(m.DEMO_PRODUCTS)),
  [{ id: 1, stock: 0, demand: 0, sell: 5, cost: 4, lead: 2 }, { id: 2, stock: 5, demand: 0.04, sell: 5, cost: 4 }],
  [{ id: 1, stock: 30, demand: 10, sell: 5, cost: 4, lead: 3, history: [2, 2, 2, 2, 2, 2, 2], histCens: [1, 1, 1, 1, 1, 1, 1] }],
];
for (const cat of cases) {
  const web = core.iqRecompute(core.iqClean(JSON.parse(JSON.stringify(cat))));
  const mob = m.recomputeAll(JSON.parse(JSON.stringify(cat)).map(m.normalize));
  for (let i = 0; i < web.length; i++) {
    for (const k of ['planDemand', 'cls', 'ss', 'rop', 'eoq', 'max', 'status'])
      assert.equal(mob[i][k], web[i][k], `${web[i].name || web[i].id}.${k}: mobile ${mob[i][k]} vs web ${web[i][k]}`);
    assert.equal(m.orderQty(mob[i]), core.iqOrderQty(web[i]), `order qty ${web[i].id}`);
    const { accuracy, ...mf } = m.forecastProduct(mob[i]); // mobile names it 'accuracy', web 'acc'
    assert.deepEqual({ ...mf, acc: accuracy }, core.iqForecast(web[i]), `forecast ${web[i].id}`);
  }
}

// Mobile number cleaning (review case: "10" + 5 was "105")
const n = m.normalize({ id: '7', stock: '10', incoming: 5, cost: -3, history: ['4', 'x'] });
assert.deepEqual([n.id, n.stock + n.incoming, n.cost, n.history], [7, 15, 0, [4, 0]]);

// Same recorded day: confirmed zero + censoring
const [d1] = [{ id: 1, stock: 2, history: [], histDay: '' }];
const logged = m.logDailySale(d1, 2, '2026-10-01', true);
assert.deepEqual([logged.history, logged.histCens], [[2], [1]]);

// Same field-level three-way merge as the web
const base = [{ id: 1, name: 'Atta', stock: 20 }, { id: 2, name: 'Salt', stock: 5 }];
const local = [{ id: 1, name: 'Atta 5kg', stock: 20 }];
const remote = [{ id: 1, name: 'Atta', stock: 20 }, { id: 2, name: 'Salt', stock: 9 }];
const strip = (l) => l.map((p) => ({ id: p.id, name: p.name, stock: p.stock })).sort((a, b) => a.id - b.id);
assert.deepEqual(strip(c.mergeProducts(base, local, remote)), strip(core.iqMerge3(base, local, remote)));
assert.equal(c.mergeSales([{ id: 'a', date: 'x' }], [{ id: 'b', date: 'x' }]).length, 2);

// Same event-replay merge as the web (review #2): every case from HANDOFF task 2
const T = Date.now(), at = (id, t, day, type, f) => ({ id, t: T + t, day, type, ...f });
const atta = (f) => ({ id: 1, name: 'Atta', stock: 20, history: [10], histCens: [0], histDay: '2026-10-01', ...f });
const scenarios = {
  'concurrent sales → 13': [
    { products: [atta()], events: [] },
    { products: [atta({ stock: 17 })], events: [at('a', 1, '2026-10-02', 'sale', { pid: 1, q: 3, cens: 0 })] },
    { products: [atta({ stock: 16 })], events: [at('b', 2, '2026-10-02', 'sale', { pid: 1, q: 4, cens: 0 })] },
    { stock: 13, history: [10, 7] }],
  'lost response retried → 17': [
    { products: [atta()], events: [] },
    { products: [atta({ stock: 17 })], events: [at('a', 1, '2026-10-02', 'sale', { pid: 1, q: 3, cens: 0 })] },
    { products: [atta({ stock: 17 })], events: [at('a', 1, '2026-10-02', 'sale', { pid: 1, q: 3, cens: 0 })] },
    { stock: 17, history: [10, 3] }],
  'shared delivery → +10': [
    { products: [atta({ incoming: 10 })], events: [] },
    { products: [atta({ stock: 30, incoming: 0 })], events: [at('a', 1, '2026-10-02', 'receive', { pid: 1, q: 10 })] },
    { products: [atta({ stock: 30, incoming: 0 })], events: [at('b', 2, '2026-10-02', 'receive', { pid: 1, q: 10 })] },
    { stock: 30, incoming: 0 }],
  'two equal corrections → 18': [
    { products: [atta()], events: [] },
    { products: [atta({ stock: 18 })], events: [at('a', 1, '2026-10-02', 'adjust', { pid: 1, stock: 18, incoming: 0 })] },
    { products: [atta({ stock: 18 })], events: [] }, // older client: the merge synthesizes its adjust
    { stock: 18, conflicts: 0 }],
  'different corrections → later wins, reported': [
    { products: [atta()], events: [] },
    { products: [atta({ stock: 15 })], events: [at('a', 3, '2026-10-02', 'adjust', { pid: 1, stock: 15, incoming: 0 })] },
    { products: [atta({ stock: 18 })], events: [at('b', 2, '2026-10-02', 'adjust', { pid: 1, stock: 18, incoming: 0 })] },
    { stock: 15, conflicts: 1 }],
  'history from both devices → [10, 3, 4]': [
    { products: [atta()], events: [] },
    { products: [atta({ stock: 17 })], events: [at('a', 1, '2026-10-02', 'sale', { pid: 1, q: 3, cens: 0 })] },
    { products: [atta({ stock: 16 })], events: [at('b', 2, '2026-10-03', 'sale', { pid: 1, q: 4, cens: 0 })] },
    { stock: 13, history: [10, 3, 4] }],
  'close + other device\'s sale share the day': [
    { products: [atta()], events: [] },
    { products: [atta({ history: [10, 0], histCens: [0, 0], histDay: '2026-10-02' })], events: [at('a', 1, '2026-10-02', 'close', {})] },
    { products: [atta({ stock: 16 })], events: [at('b', 2, '2026-10-02', 'sale', { pid: 1, q: 4, cens: 0 })] },
    { stock: 16, history: [10, 4] }],
};
const pick = (p) => ({ stock: p.stock, incoming: p.incoming || 0, history: p.history, histCens: p.histCens, histDay: p.histDay });
for (const [name, [b, l, r, want]] of Object.entries(scenarios)) {
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const web = core.iqMergeSnap(copy(b), copy(l), copy(r), T + 5);
  const mob = c.mergeSnapshots(copy(b), copy(l), copy(r), T + 5);
  assert.deepEqual(mob.products.map(pick), web.products.map(pick), `${name}: mobile vs web`);
  assert.equal(mob.conflicts.length, web.conflicts.length, `${name}: conflicts`);
  assert.equal(web.products[0].stock, want.stock, name);
  if (want.history) assert.deepEqual(web.products[0].history, want.history, name);
  if ('incoming' in want) assert.equal(web.products[0].incoming, want.incoming, name);
  if ('conflicts' in want) assert.equal(web.conflicts.length, want.conflicts, name);
}

// Task 3: censor-aware demand, same on both
const sw = { demand: 0, history: [], histCens: [] };
for (let i = 0; i < 14; i++) { sw.history.push(i % 2 ? 20 : 2); sw.histCens.push(i % 2); }
assert.equal(m.planDemand(sw), core.iqDemand(sw));
assert.ok(Math.abs(m.planDemand(sw) - 11) < 1e-6, 'alternating 2 / sold-out 20 → ~11');

// Task 5 + 8 on the mobile storage path: partial entry, completeDay, failed saves return null
mem.clear();
await m.saveProducts([{ id: 1, name: 'Atta', stock: 50, demand: 5 }, { id: 2, name: 'Salt', stock: 0, demand: 3 }]);
await m.recordSales({ 1: 4 });
let ps = await m.loadProducts();
assert.deepEqual([ps[0].history, ps[1].history], [[4], []], 'partial entry logs only the entered product');
assert.equal(await m.completeDay(m.localDay()), 1, 'completeDay zeroes the rest');
ps = await m.loadProducts();
assert.deepEqual([ps[0].history, ps[1].history, ps[1].histCens], [[4], [0], [1]]);
assert.deepEqual((await m.loadEvents()).map((e) => e.type).sort(), ['close', 'sale']);
m.SYNC.busy = true;
assert.equal(await m.addProduct({ name: 'Soap', stock: 3 }), null, 'refused save → null');
assert.equal(await m.updateProduct(1, { stock: 1 }), null);
assert.equal(await m.deleteProduct(1), null);
m.SYNC.busy = false;
assert.equal((await m.loadProducts()).length, 2, 'nothing changed while refused');

// Mobile sync end to end against the real Worker (in-memory D1): two phones sell from 20
// concurrently → 13 on both, and the sync lock is released.
const sql = new DatabaseSync(':memory:');
sql.exec(readFileSync(new URL('../backend/schema.sql', import.meta.url), 'utf8'));
const DB = { prepare(q) { const st = sql.prepare(q); let a = []; const s = { bind: (...x) => ((a = x), s), first: async () => st.get(...a) ?? null, run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }) }; return s; } };
function phone() {
  const store = new Map();
  const AS = { getItem: async (k) => store.get(k) ?? null, setItem: async (k, v) => store.set(k, v), multiRemove: async (ks) => ks.forEach((k) => store.delete(k)) };
  const st = load(src('storage.js'), { AsyncStorage: AS, Alert: { alert() {} } });
  const cl = load(src('cloud.js').replace("API_BASE = ''", "API_BASE = 'https://api.example'"),
    { AsyncStorage: AS, fetch: (u, i) => worker.fetch(new Request(u, i), { DB }), ...st });
  return { ...st, ...cl };
}
const P1 = phone(), P2 = phone();
await P1.saveProducts([{ id: 1, name: 'Atta', stock: 20, demand: 5 }]);
assert.equal((await P1.syncToCloud()).mode, 'cloud');
assert.ok((await P2.restoreFromCloud(await P1.getLinkCode())).ok);
await P1.recordSales({ 1: 3 });
await P2.recordSales({ 1: 4 });
assert.ok((await P1.syncToCloud()).ok);
const r2 = await P2.syncToCloud();
assert.ok(r2.ok && r2.merged, JSON.stringify(r2));
assert.equal((await P2.loadProducts())[0].stock, 13, 'phone 2 after merge');
assert.ok((await P1.syncToCloud()).merged);
assert.equal((await P1.loadProducts())[0].stock, 13, 'phone 1 after its next sync');
assert.equal(P1.SYNC.busy || P2.SYNC.busy, false, 'sync lock released');

console.log('mobile parity: all checks passed');
