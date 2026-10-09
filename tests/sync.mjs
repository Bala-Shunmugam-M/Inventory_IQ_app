// End-to-end sync: the real web client (docs/iq-core.js) against the real Worker (backend/)
// over an in-memory SQLite D1. Run: node tests/sync.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import worker from '../backend/src/index.js';

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../backend/schema.sql', import.meta.url), 'utf8'));
const DB = {
  prepare(sql) {
    const st = db.prepare(sql);
    let args = [];
    const s = {
      bind: (...a) => ((args = a), s),
      first: async () => st.get(...args) ?? null,
      run: async () => ({ meta: { changes: Number(st.run(...args).changes) } }),
      all: async () => ({ results: st.all(...args) }),
    };
    return s;
  },
};
const coreSrc = readFileSync(new URL('../docs/iq-core.js', import.meta.url), 'utf8');

// One "browser": its own localStorage, fetch routed straight into the Worker.
function device(api = 'https://api.example', store = new Map()) { // pass a shared store to model two tabs of one browser
  const ctx = {
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    fetch: (url, init) => worker.fetch(new Request(url, init), { DB }),
    crypto: globalThis.crypto, Date, JSON, Math, Promise,
  };
  vm.createContext(ctx);
  vm.runInContext(coreSrc + `\nIQ_API = ${JSON.stringify(api)};`, ctx);
  return ctx;
}
const prod = (id, name, stock) => ({ id, name, stock, rop: 10, eoq: 20, cost: 5, sell: 8, history: [] });
const names = (arr) => Array.from(arr, (p) => p.name).sort(); // Array.from: compare in this realm, not the vm's

const A = device(), B = device(), C = device();

// A's first sync creates the store
let r = await A.iqPush([prod(1, 'Atta', 10), prod(2, 'Salt', 5)], [{ date: '2026-10-08T10:00:00Z', totalUnits: 3 }]);
assert.equal(r.mode, 'cloud');
assert.equal(r.merged, null);
const code = A.iqLinkCode();
assert.match(code, /^iq1:IQ-[A-Z2-7]{10}:[\w-]{43}$/);

// B joins with the link code
let snap = await B.iqPull(code);
assert.deepEqual(names(snap.data), ['Atta', 'Salt']);
snap.commit();
assert.equal(B.iqLinkCode(), code);

// A edits and syncs; B, now stale, adds a product and syncs -> 409 -> merge -> retry
await A.iqPush([prod(1, 'Atta', 99), prod(2, 'Salt', 5)], [{ date: '2026-10-08T10:00:00Z', totalUnits: 3 }]);
r = await B.iqPush([prod(1, 'Atta', 10), prod(2, 'Salt', 5), prod(3, 'Soap', 7)], [{ date: '2026-10-08T12:00:00Z', totalUnits: 2 }]);
assert.ok(r.merged, 'stale save must merge, not overwrite');
assert.deepEqual(names(r.merged.data), ['Atta', 'Salt', 'Soap']);
assert.equal(r.merged.sales.length, 2, 'sales from both devices kept');
assert.equal(r.merged.data.find((p) => p.id === 1).stock, 99, "A's edit survives B's merge (B never touched Atta)");

// A pulls its own store and sees everything
snap = await A.iqPull('');
assert.deepEqual(names(snap.data), ['Atta', 'Salt', 'Soap']);

// Cancelled restore must not link the device (else its next push could overwrite that store)
snap = await C.iqPull(code);
assert.equal(snap.data.length, 3);
assert.equal(C.iqLinkCode(), null);

// Bad codes
await assert.rejects(C.iqPull('IQ-ABCDE-12345'), /Invalid link code/);
await assert.rejects(C.iqPull(code.slice(0, -4) + 'AAAA'), /Link code not recognised/);
await assert.rejects(C.iqPull(''), /not synced yet/);

// Server data is scrubbed on the way in
await A.iqPush([prod(4, '<img src=x onerror=alert(1)>Evil', 1)], []);
snap = await B.iqPull('');
assert.equal(snap.data.find((p) => p.id === 4).name, 'img src=x onerror=alert(1)Evil');

// Two tabs of one browser: a stale tab can't reuse the newer tab's version to skip the conflict check
const shared = new Map(), T1 = device(undefined, shared);
await T1.iqPush([prod(1, 'Atta', 20)], []);
const T2 = device(undefined, shared); // loads the same base as T1
await T1.iqPush([prod(1, 'Atta', 17)], []); // T1 sells 3
r = await T2.iqPush([prod(1, 'Atta', 20)], []); // T2 is stale and unchanged
assert.ok(r.merged, 'stale tab must hit the conflict path');
assert.equal(r.merged.data[0].stock, 17, "stale tab doesn't overwrite the newer stock");

// Clearing the catalog syncs (deletes aren't resurrected)
r = await T1.iqPush([], []);
assert.equal(r.mode, 'cloud');
assert.equal((await T1.iqPull('')).data.length, 0);

// Unconfigured: everything stays local
const L = device('');
assert.equal((await L.iqPush([prod(1, 'Atta', 1)], [])).mode, 'local');
assert.equal((await L.iqPull('')).mode, 'local');

console.log('sync: all checks passed');
