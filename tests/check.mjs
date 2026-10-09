// Self-check for the shared web core. Run: node tests/check.mjs
// Backend / AI proxy checks live in backend/test/run.mjs.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const core = createRequire(import.meta.url)('../docs/iq-core.js');

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

// ── Inventory engine ──
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// Planning demand: typed until sales exist, blended under 7 days, then the recent average
assert.equal(core.iqDemand({ demand: 10, history: [] }), 10);
near(core.iqDemand({ demand: 10, history: [20] }), 10 + 10 / 7, 1e-9, '1 day of 20 blends 1/7 toward it');
assert.equal(core.iqDemand({ demand: 10, history: [20, 20, 20, 20, 20, 20, 20] }), 20);
assert.equal(core.iqDemand({ demand: 0, history: [4, 6] }), 5, 'no typed demand → logged average');

// σ: CV fallback on short history; sample σ with a √mean floor once there are 7 days
near(core.iqSigma({ history: [10, 12] }, 10), Math.sqrt(10), 1e-9, 'short history: max(0.3 × mean, √mean)');
near(core.iqSigma({ history: [100, 100] }, 100), 30, 1e-9, 'short history: 0.3 × mean when that is larger');
assert.ok(Math.abs(core.iqSigma({ history: [1, 1, 1, 1, 1, 1] }, 1) - core.iqSigma({ history: [1, 1, 1, 1, 1, 1, 1] }, 1)) < 1e-9, 'no jump at the 7th day');
near(core.iqSigma({ history: [10, 10, 10, 10, 10, 10, 10] }, 10), Math.sqrt(10), 1e-9, 'flat history → √mean floor');
near(core.iqSigma({ history: [0, 20, 0, 20, 0, 20, 0, 20] }, 10), Math.sqrt(400 * 8 / 4 / 7), 1e-9, 'sample σ');

// ROP = d·T + z·σ·√T over the protection period T = L + 1 day review, z by ABC class
assert.equal(core.iqROP(10, 3, 4, 'A'), Math.ceil(50 + 1.65 * 3 * Math.sqrt(5)));
assert.equal(core.iqROP(10, 3, 4, 'C'), Math.ceil(50 + 1.04 * 3 * Math.sqrt(5)));
assert.ok(core.iqROP(10, 3, 4, 'A') > core.iqROP(10, 3, 4, 'B'));
assert.equal(core.iqROP(0, 0, 3, 'A'), 0, 'no demand → no reorder point');

// EOQ = √(2·D·S/H), D annual units, S ₹50/order, H = 20% of cost per unit-year
assert.equal(core.iqEOQ(10, 100), Math.ceil(Math.sqrt(2 * 3650 * 50 / 20)));
assert.equal(core.iqEOQ(0, 100), 0, 'no demand → no order');

// ABC: Pareto on annual revenue across the catalog (80/15/5), with manual override
const cat = core.iqRecompute([
  { id: 1, name: 'big', stock: 50, demand: 80, sell: 10, cost: 8, lead: 2 },  // 800/day
  { id: 2, name: 'mid', stock: 50, demand: 15, sell: 10, cost: 8, lead: 2 },  // 150/day
  { id: 3, name: 'low', stock: 50, demand: 4, sell: 10, cost: 8, lead: 2 },   // 40/day → total 1000 with 'pin'
  { id: 4, name: 'none', stock: 5, demand: 0, sell: 10, cost: 8, lead: 2 },
  { id: 5, name: 'pin', stock: 5, demand: 1, sell: 10, cost: 8, lead: 2, clsManual: 'A' }
]);
assert.deepEqual(cat.map((x) => x.cls), ['A', 'B', 'C', 'C', 'A']);
// …and it moves when sales change the revenue mix
cat[2].history = [200, 200, 200, 200, 200, 200, 200];
core.iqRecompute(cat);
assert.equal(cat[2].cls, 'A');
assert.equal(cat[2].planDemand, 200, 'logged sales replace typed demand');
assert.equal(cat[0].max, cat[0].rop + cat[0].eoq, 'max = order-up-to level');

// Derived fields line up: ROP from planning demand, status from lead-time cover
const big = cat[0];
assert.equal(big.rop, core.iqROP(80, core.iqSigma(big, 80), 2, big.cls));
assert.equal(big.status, 'critical', '50 on hand < 160 needed over the 2-day lead');
assert.equal(core.iqLostUnits(big), 110);
assert.equal(core.iqRevAtRisk(big), 1100);
near(core.iqCover(big), 50 / 80, 1e-9, 'cover in days');
const okP = core.iqRecompute([{ id: 1, stock: 100, demand: 10, sell: 10, cost: 5, lead: 2 }])[0];
assert.equal(okP.status, 'good');
okP.stock = okP.rop; assert.equal(core.iqStatus(okP), 'order');
okP.stock = 20; assert.equal(core.iqStatus(okP), 'order', 'exactly lead-time demand is not yet critical');
okP.stock = 19; assert.equal(core.iqStatus(okP), 'critical');

// Order quantity: back up to ROP + EOQ net of what's already ordered; zero once that covers it
const oq = { stock: 0, incoming: 0, rop: 30, eoq: 50 };
assert.equal(core.iqOrderQty(oq), 80);
oq.stock = 25; assert.equal(core.iqOrderQty(oq), 55);
oq.incoming = 55; assert.equal(core.iqOrderQty(oq), 0, 'enough already on order');
assert.equal(core.iqShouldOrder(oq), false);
assert.equal(core.iqOrderQty({ stock: 30, incoming: 100, rop: 30, eoq: 50 }), 0, 'review case: incoming covers it');
assert.equal(core.iqOrderQty({ stock: 0, incoming: 0, rop: 0, eoq: 0 }), 0, 'zero demand: never reorder');
const dead = core.iqRecompute([{ id: 1, stock: 0, demand: 0, sell: 5, cost: 4, lead: 2 }])[0];
assert.deepEqual([dead.rop, dead.eoq, dead.status, core.iqOrderQty(dead)], [0, 0, 'good', 0]);
assert.equal(core.iqRecompute([{ id: 1, stock: 5, demand: 0.04, sell: 5, cost: 4 }])[0].planDemand, 0.04, 'slow movers keep precision');

// Demand uses confirmed zero-sale days ("Finished entering today's sales") and reads
// stockout-censored days as lower bounds
const days = (n) => Array.from({ length: n }, (_, i) => '2026-10-' + String(i + 1).padStart(2, '0'));
const alt = [{ id: 1, stock: 1000, demand: 0, sell: 1, cost: 1 }];
days(14).forEach((d, i) => { core.iqRecordDay(alt, i % 2 ? {} : { 1: 10 }, d); core.iqCompleteDay(alt, d); });
assert.equal(core.iqDemand(alt[0]), 5, 'review case: 10 on alternate days = 5/day, not 10');

// Review #2, task 5: a partial entry logs only the products entered
const part = [{ id: 1, stock: 500, demand: 10, sell: 1, cost: 1 }, { id: 2, stock: 500, demand: 6, sell: 1, cost: 1 }];
days(7).forEach((d) => core.iqRecordDay(part, { 1: 10 }, d));
assert.deepEqual([part[1].history, core.iqDemand(part[1])], [undefined, 6], 'unentered product: untouched, keeps its typed demand');
assert.equal(core.iqDemand(part[0]), 10);
const quiet = [{ id: 1, stock: 5, demand: 4, sell: 1, cost: 1 }, { id: 2, stock: 0, demand: 4, sell: 1, cost: 1 }];
assert.equal(core.iqCompleteDay(quiet, '2026-10-01'), 2, 'works on a day with no sales at all');
assert.deepEqual([quiet[0].history, quiet[0].histCens, quiet[1].history, quiet[1].histCens], [[0], [0], [0], [1]], 'zeros; empty shelf = censored');
assert.equal(core.iqCompleteDay(quiet, '2026-10-01'), 0, 'idempotent');
core.iqRecordDay(quiet, { 1: 2 }, '2026-10-02'); core.iqCompleteDay(quiet, '2026-10-02');
assert.deepEqual([quiet[0].history, quiet[1].history], [[0, 2], [0, 0]], 'a sold product keeps its sale');

// Review #2, task 3: sold-out days are lower bounds, not discarded
const sw = { demand: 0, history: [], histCens: [] };
for (let i = 0; i < 14; i++) { sw.history.push(i % 2 ? 20 : 2); sw.histCens.push(i % 2); }
near(core.iqDemand(sw), 11, 1e-6, 'alternating 2 / sold-out 20 → ~11, not 2');
near(core.iqDemand({ demand: 0, history: [4, 2, 2], histCens: [0, 1, 1] }), 4, 1e-6, 'sold-out days below the mean count as the mean');
assert.equal(core.iqDemand({ demand: 0, history: [2, 4], histCens: [1, 1] }), 3, 'all sold out, nothing typed: plain mean as the lower bound');
const cens = [{ id: 1, stock: 0, demand: 10, sell: 1, cost: 1 }];
days(7).forEach((d) => { cens[0].stock = 2; core.iqRecordDay(cens, { 1: 2 }, d); });
assert.equal(core.iqDemand(cens[0]), 10, 'review case: sold-out days keep the estimate, not 2/day');
assert.deepEqual(cens[0].histCens, [1, 1, 1, 1, 1, 1, 1]);
const same = [{ id: 1, stock: 50, demand: 5, sell: 1, cost: 1 }];
core.iqRecordDay(same, { 1: 2 }, '2026-10-01'); core.iqRecordDay(same, { 1: 3 }, '2026-10-01');
assert.deepEqual([same[0].history, same[0].stock], [[5], 45], 'two saves in a day = one bucket');

// One service definition: health and an unchanged what-if agree
const svcCat = core.iqRecompute([{ id: 1, stock: 1, demand: 1, lead: 1, sell: 1, cost: 1 }, { id: 2, stock: 0, demand: 1, lead: 10, sell: 1, cost: 1 }]);
assert.equal(core.iqHealth(svcCat).serviceLevel, core.iqSimulate(svcCat, 0, 0).service);

// Untrusted data: numbers must be finite and non-negative; LLM numbers forced to numbers
const [bad] = core.iqClean([{ id: 1, stock: 'Infinity', cost: -5, sell: '12', history: [3, -1, 'x'] }]);
assert.deepEqual([bad.stock, bad.cost, bad.sell, bad.history], [0, 0, 12, [3, 0, 0]]);
const ai = core.iqAiClean({ at_risk_skus: [{ sku: '<b>x</b>', days_cover: '<img src=x onerror=alert(1)>' }], recommendations: [{ priority: '"><svg onload=alert(1)>' }] });
assert.deepEqual([ai.at_risk_skus[0].days_cover, ai.at_risk_skus[0].sku, ai.recommendations[0].priority], [null, 'bx/b', null]);
assert.equal(core.iqAttr(`');x=1;//"`), '&#39;);x=1;//&quot;');

// Three-way sync merge (review cases)
const b0 = [{ id: 1, name: 'Atta', stock: 20, price: 10 }, { id: 2, name: 'Salt', stock: 5 }];
const T0 = Date.now(), ev = (id, t, type, f) => ({ id, t: T0 + t, day: '2026-10-02', type, ...f });
const sold = (id, t, q) => ev(id, t, 'sale', { pid: 1, q, cens: 0 });
let mm = core.iqMergeSnap({ products: b0, events: [] }, { products: [{ ...b0[0], stock: 17 }, b0[1]], events: [sold('a', 1, 3)] },
  { products: [{ ...b0[0], stock: 16 }, b0[1]], events: [sold('b', 2, 4)] }, T0 + 3);
assert.equal(mm.products.find((x) => x.id === 1).stock, 13, 'both devices sold: 20 − 3 − 4 = 13');
mm = core.iqMergeSnap({ products: b0, events: [] }, { products: [{ ...b0[0], stock: 17 }, b0[1]], events: [sold('a', 1, 3)] },
  { products: [{ ...b0[0], stock: 17 }, b0[1]], events: [sold('a', 1, 3)] }, T0 + 3);
assert.equal(mm.products[0].stock, 17, 'own sale already on the server (lost response) applies once');
mm = core.iqMergeSnap({ products: b0, events: [] }, { products: [{ ...b0[0], stock: 20 }, b0[1]], events: [] },
  { products: [{ ...b0[0], stock: 25 }, b0[1]], events: [] }, T0 + 3);
assert.equal(mm.products[0].stock, 25, 'remote stock change without events (older client) is kept as an adjust');
assert.equal(mm.events.filter((e) => e.type === 'adjust').length, 1);
let m = core.iqMerge3(b0, [b0[0]], [b0[0], b0[1]]);
assert.deepEqual(m.map((x) => x.id), [1], 'local delete is not resurrected');
m = core.iqMerge3(b0, [b0[0]], [b0[0], { id: 2, name: 'Salt', stock: 9 }]);
assert.equal(m.find((x) => x.id === 2).stock, 9, 'delete vs remote edit keeps the edit');
m = core.iqMerge3(b0, [{ id: 1, name: 'Atta 5kg', stock: 20, price: 10 }, b0[1]], [{ id: 1, name: 'Atta', stock: 20, price: 12 }, b0[1]]);
assert.deepEqual([m[0].name, m[0].price], ['Atta 5kg', 12], 'field-level: each side keeps its own edit');
const sm = core.iqMergeSales([{ id: 'a', date: '2026-10-08T10:00:00Z' }], [{ id: 'b', date: '2026-10-08T10:00:00Z' }, { id: 'a', date: '2026-10-08T10:00:00Z' }]);
assert.equal(sm.length, 2, 'same timestamp, different sales: both kept');

// Forecast accuracy is a backtest (1 − WAPE), not R²; null until 7 days
assert.equal(core.iqForecast({ demand: 5, history: [5, 6, 5] }).acc, null);
assert.equal(core.iqForecast({ demand: 9, history: [9, 9, 9, 9, 9, 9, 9] }).acc, 100);
const noisy = core.iqForecast({ demand: 10, history: [10, 2, 18, 3, 17, 2, 18, 3, 17, 2] });
assert.ok(noisy.acc < 70, `noisy series can't look accurate: ${noisy.acc}`);
assert.ok(noisy.r2 < 10);
// Review #2, task 4: sold-out days don't drag the forecast down or count as perfect accuracy
const so = core.iqForecast({ demand: 10, history: [2, 2, 2, 2, 2, 2, 2], histCens: [1, 1, 1, 1, 1, 1, 1] });
assert.deepEqual([so.forecast, so.acc], [10, null], 'seven sold-out 2s with typed 10 → forecast 10, no accuracy claim');
assert.ok(so.ci > 0, 'band is not 0');
const mix = core.iqForecast({ demand: 0, history: [5, 5, 5, 5, 5, 5, 5, 5, 5, 1], histCens: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1] });
assert.equal(mix.acc, 100, 'the sold-out last day is not scored');
// …and the trend can't extrapolate to silly values
const crash = core.iqForecast({ demand: 50, history: [100, 80, 60, 40, 20, 0] });
assert.ok(crash.forecast >= 0);
const spike = core.iqForecast({ demand: 5, history: [1, 1, 1, 1, 1, 1, 60] });
assert.ok(spike.forecast <= 1.5 * (66 / 7) + 1, `spike forecast ${spike.forecast}`);

// Health: shared by both pages; sub-scores bounded; plan uses order-up-to quantities
const h = core.iqHealth(cat);
assert.ok(h.health >= 0 && h.health <= 100);
assert.ok(h.sub.every((s) => s[1] >= 0 && s[1] <= 100));
assert.equal(h.revAtRisk, cat.reduce((a, x) => a + core.iqRevAtRisk(x), 0));
assert.ok(h.plan.every((x) => x.qty >= 1 && x.cost === Math.round(x.qty * 8)));
assert.equal(core.iqHealth([]), null);

// What-if: more demand + longer lead → more safety stock, no better service
const base = core.iqSimulate(cat, 0, 0), worse = core.iqSimulate(cat, 20, 2);
assert.equal(base.ssPct, 0);
assert.ok(worse.ssPct > 0 && worse.service <= base.service && worse.stockouts >= base.stockouts);

// Review #2, task 7: names typed into add/edit forms lose < > at the next recompute
const typedName = core.iqRecompute([{ id: 1, name: '<img src=x onerror=alert(1)>Atta', supplier: '<b>S</b>', stock: 1, demand: 1 }])[0];
assert.deepEqual([typedName.name, typedName.supplier], ['img src=x onerror=alert(1)Atta', 'bS/b']);

console.log('all checks passed');
