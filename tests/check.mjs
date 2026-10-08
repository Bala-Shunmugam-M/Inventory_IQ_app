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
near(core.iqSigma({ history: [10, 12] }, 10), 3, 1e-9, 'fallback σ = 0.3 × mean');
near(core.iqSigma({ history: [10, 10, 10, 10, 10, 10, 10] }, 10), Math.sqrt(10), 1e-9, 'flat history → √mean floor');
near(core.iqSigma({ history: [0, 20, 0, 20, 0, 20, 0, 20] }, 10), Math.sqrt(400 * 8 / 4 / 7), 1e-9, 'sample σ');

// ROP = d·L + z·σ·√L, z by ABC class (95/90/85%)
assert.equal(core.iqROP(10, 3, 4, 'A'), Math.ceil(40 + 1.65 * 3 * 2));
assert.equal(core.iqROP(10, 3, 4, 'C'), Math.ceil(40 + 1.04 * 3 * 2));
assert.ok(core.iqROP(10, 3, 4, 'A') > core.iqROP(10, 3, 4, 'B'));
assert.equal(core.iqROP(0, 0, 3, 'A'), 1, 'never below 1');

// EOQ = √(2·D·S/H), D annual units, S ₹50/order, H = 20% of cost per unit-year
assert.equal(core.iqEOQ(10, 100), Math.ceil(Math.sqrt(2 * 3650 * 50 / 20)));
assert.equal(core.iqEOQ(0, 100), 1);

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

// Order quantity: back up to ROP + EOQ, never less than EOQ, net of what's already ordered
const oq = { stock: 0, incoming: 0, rop: 30, eoq: 50 };
assert.equal(core.iqOrderQty(oq), 80);
oq.stock = 25; assert.equal(core.iqOrderQty(oq), 55);
oq.incoming = 55; assert.equal(core.iqOrderQty(oq), 50);
assert.equal(core.iqShouldOrder(oq), false);

// Forecast accuracy is a backtest (1 − WAPE), not R²; null until 7 days
assert.equal(core.iqForecast({ demand: 5, history: [5, 6, 5] }).acc, null);
assert.equal(core.iqForecast({ demand: 9, history: [9, 9, 9, 9, 9, 9, 9] }).acc, 100);
const noisy = core.iqForecast({ demand: 10, history: [10, 2, 18, 3, 17, 2, 18, 3, 17, 2] });
assert.ok(noisy.acc < 70, `noisy series can't look accurate: ${noisy.acc}`);
assert.ok(noisy.r2 < 10);
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

console.log('all checks passed');
