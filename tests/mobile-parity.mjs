// The React Native engine (mobile/src/lib) must give the same answers as the web core
// (docs/iq-core.js). RN packages aren't installed here, so we strip the imports and run the
// real mobile source against tiny stubs. Run: node tests/mobile-parity.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

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

// Same three-way merge as the web
const base = [{ id: 1, name: 'Atta', stock: 20 }, { id: 2, name: 'Salt', stock: 5 }];
const local = [{ id: 1, name: 'Atta', stock: 17 }];
const remote = [{ id: 1, name: 'Atta', stock: 16 }, { id: 2, name: 'Salt', stock: 9 }];
const strip = (l) => l.map((p) => ({ id: p.id, name: p.name, stock: p.stock })).sort((a, b) => a.id - b.id);
assert.deepEqual(strip(c.mergeProducts(base, local, remote)), strip(core.iqMerge3(base, local, remote)));
assert.deepEqual(strip(c.mergeProducts(base, local, remote)), [{ id: 1, name: 'Atta', stock: 13 }, { id: 2, name: 'Salt', stock: 9 }]);
assert.equal(c.mergeSales([{ id: 'a', date: 'x' }], [{ id: 'b', date: 'x' }]).length, 2);

console.log('mobile parity: all checks passed');
