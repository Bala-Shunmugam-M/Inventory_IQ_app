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
// Set ctx.dropPut = true to lose the response of the next PUT after the server applied it.
function device(api = 'https://api.example', store = new Map()) { // pass a shared store to model two tabs of one browser
  const ctx = {
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    fetch: async (url, init) => {
      const res = await worker.fetch(new Request(url, init), { DB });
      if (ctx.dropPut && init.method === 'PUT') { ctx.dropPut = false; throw new Error('network lost'); }
      return res;
    },
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

// ── Review #2: event replay. Each pair of devices works on the same objects the pages
// mutate (PRODS from the pull / the push), through the same core calls the pages make. ──
const tick = () => new Promise((res) => setTimeout(res, 3)); // distinct event timestamps
async function pair(p) { // X creates a fresh store with [p], Y joins; returns both devices and their PRODS
  const X = device(), Y = device(), PX = [p];
  await X.iqPush(PX, []);
  const s = await Y.iqPull(X.iqLinkCode());
  s.commit();
  return { X, Y, PX, PY: s.data };
}
const syncBoth = async (X, PX, Y, PY) => { // both sync, then X again; returns X's and Y's view
  const ry = await Y.iqPush(PY, []);
  if (ry.merged) PY = ry.merged.data;
  await tick(); // keep the second push's timestamps later than the first
  const rx = await X.iqPush(PX, []);
  if (rx.merged) PX = rx.merged.data;
  return { PX, PY, rx, ry };
};

// Task 1: the base is a copy — selling from the synced objects must not move it. 20 − 3 − 4 = 13.
{
  const { X, Y, PX, PY } = await pair(prod(1, 'Atta', 20));
  X.iqRecordDay(PX, { 1: 3 }, '2026-10-02');
  Y.iqRecordDay(PY, { 1: 4 }, '2026-10-02');
  const v = await syncBoth(X, PX, Y, PY);
  assert.equal(v.PX[0].stock, 13, 'concurrent sales from 20: 13');
  assert.equal(v.rx.merged.data[0].stock, 13);
  assert.deepEqual([...v.PX[0].history], [7], 'same-day sales on two devices share one bucket');
  assert.equal((await Y.iqPull('')).data[0].stock, 13);
}

// Task 2a: a PUT whose response was lost is retried — our own landed sale must not apply twice (17, not 14)
{
  const { X, PX } = await pair(prod(1, 'Atta', 20));
  X.iqRecordDay(PX, { 1: 3 }, '2026-10-02');
  X.dropPut = true;
  await assert.rejects(X.iqPush(PX, []), /network lost/);
  r = await X.iqPush(PX, []);
  assert.ok(r.merged, 'the retry hits the conflict path');
  assert.equal(r.merged.data[0].stock, 17, 'retry after a lost response: 17');
  assert.deepEqual([...r.merged.data[0].history], [3]);
}

// Task 2b: one delivery received on two devices counts once (+10, not +20)
{
  const { X, Y, PX, PY } = await pair({ ...prod(1, 'Atta', 20), incoming: 10 });
  X.iqReceive(PX[0]);
  Y.iqReceive(PY[0]);
  const v = await syncBoth(X, PX, Y, PY);
  assert.deepEqual([v.PX[0].stock, v.PX[0].incoming], [30, 0], 'shared delivery: +10 once');
}
// …while two separate orders, each received, both count
{
  const { X, Y, PX, PY } = await pair(prod(1, 'Atta', 20));
  assert.equal(X.iqMarkOrdered(PX[0], 10), 10);
  assert.equal(Y.iqMarkOrdered(PY[0], 5), 5);
  let v = await syncBoth(X, PX, Y, PY);
  assert.equal(v.PX[0].incoming, 15, 'orders from both devices add up');
  X.iqReceive(v.PX[0]);
  r = await X.iqPush(v.PX, []);
  assert.deepEqual([r.merged ? r.merged.data[0].stock : v.PX[0].stock, v.PX[0].incoming], [35, 0]);
}

// Task 2c: two people correcting the same shelf count 20→18 → 18 (not 16), no conflict
{
  const { X, Y, PX, PY } = await pair(prod(1, 'Atta', 20));
  PX[0].stock = 18; // edit form: no event, the push synthesizes one
  PY[0].stock = 18;
  const v = await syncBoth(X, PX, Y, PY);
  assert.equal(v.PX[0].stock, 18, 'same correction twice: 18');
  assert.equal(v.ry.conflicts.length + v.rx.conflicts.length, 0);
}
// …different corrections: the later one wins and is reported
{
  const { X, Y, PX, PY } = await pair(prod(1, 'Atta', 20));
  PY[0].stock = 18;
  await Y.iqPush(PY, []);
  await tick();
  PX[0].stock = 15;
  r = await X.iqPush(PX, []);
  assert.equal(r.merged.data[0].stock, 15, 'later correction wins');
  assert.deepEqual(JSON.parse(JSON.stringify(r.conflicts)), [{ name: 'Atta', kept: 15 }]);
}
// …a correction plus a later sale elsewhere: the sale applies on top of the correction
{
  const { X, Y, PX, PY } = await pair(prod(1, 'Atta', 20));
  PX[0].stock = 18;
  await X.iqPush(PX, []);
  await tick();
  Y.iqRecordDay(PY, { 1: 4 }); // today, like the Sales screen
  r = await Y.iqPush(PY, []);
  assert.equal(r.merged.data[0].stock, 14, 'corrected to 18, then sold 4');
}

// Task 2d: history from both devices — base [10], X logs Oct 2, Y logs Oct 3 → [10, 3, 4]
{
  const { X, Y, PX, PY } = await pair({ ...prod(1, 'Atta', 20), history: [10], histDay: '2026-10-01' });
  X.iqRecordDay(PX, { 1: 3 }, '2026-10-02');
  Y.iqRecordDay(PY, { 1: 4 }, '2026-10-03');
  const v = await syncBoth(X, PX, Y, PY);
  assert.deepEqual([...v.PX[0].history], [10, 3, 4], 'both devices\' days kept, in day order');
  assert.deepEqual([...(await Y.iqPull('')).data[0].history], [10, 3, 4], 'and Y gets them on its next pull');
  assert.equal(v.PX[0].stock, 13);
}

// Task 5 through sync: a "finished entering" day on one device logs zeros everywhere
{
  const { X, Y, PX, PY } = await pair({ ...prod(1, 'Atta', 20), history: [10], histDay: '2026-10-01' });
  Y.iqRecordDay(PY, { 1: 4 }, '2026-10-02');
  X.iqCompleteDay(PX, '2026-10-02'); // X saw no sale of Atta on Oct 2 …
  const v = await syncBoth(X, PX, Y, PY);
  assert.deepEqual([...v.PX[0].history], [10, 4], '… but Y did: the day holds Y\'s 4, not a separate 0');
}

// Task 6: a saved empty catalog comes back as [] (restorable), not "nothing saved"
{
  const { X, Y } = await pair(prod(1, 'Atta', 20));
  await X.iqPush([], []);
  const s = await Y.iqPull('');
  assert.ok(s, 'an empty saved catalog is still a snapshot');
  assert.equal(s.data.length, 0);
  assert.equal(await device().iqPull(X.iqLinkCode().replace(/:[^:]+:/, ':IQ-AAAAAAAAAA:')).catch(() => 'rejected'), 'rejected');
  const N = device(), PN = [];
  await N.iqPush(PN, []); // a store created by an empty push…
  // …is saved (version 1), so it's restorable too; only a never-saved store (version 0) resolves null
  assert.equal((await device().iqPull(N.iqLinkCode())).data.length, 0);
}

// Unconfigured: everything stays local
const L = device('');
assert.equal((await L.iqPush([prod(1, 'Atta', 1)], [])).mode, 'local');
assert.equal((await L.iqPull('')).mode, 'local');

console.log('sync: all checks passed');
