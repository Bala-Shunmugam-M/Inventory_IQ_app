/* InventoryIQ — shared core for index.html and dashboard.html.
   Data hygiene, inventory math, forecasting and cloud sync live here once,
   so the mobile web app and the desktop dashboard can't drift apart. */

/* ── Cloud sync config ──
   URL of your deployed backend/ Worker — the same one that serves the AI Advisor,
   e.g. 'https://inventoryiq-llm-proxy.<you>.workers.dev'. Leave empty to keep
   everything on this device. */
var IQ_API = '';

function iqCloudReady() { return !!IQ_API; }

/* ── Device ID ── labels backups with the device they came from. */
function iqRand5() {
  var a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return ('00000' + (a[0] % 60466176).toString(36).toUpperCase()).slice(-5); // 36^5
}
function getDeviceId() {
  var d = localStorage.getItem('iq_device_id');
  if (!d) {
    d = 'IQ-' + iqRand5() + '-' + iqRand5();
    try { localStorage.setItem('iq_device_id', d); } catch (e) {}
  }
  return d;
}

/* ── Data hygiene ──
   Every screen renders product/sales fields with innerHTML, and data can arrive
   from backup files or another device's cloud row. Scrubbing once at load time
   keeps every render site safe without touching each one. */
function iqScrub(v) {
  if (typeof v === 'string') return v.replace(/[<>]/g, '');
  if (Array.isArray(v)) return v.map(iqScrub);
  if (v && typeof v === 'object') {
    var o = {};
    for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = iqScrub(v[k]);
    return o;
  }
  return typeof v === 'number' || typeof v === 'boolean' || v == null ? v : null;
}
// Demo tips carry <strong> markup; escape everything else.
function iqSafeTip(s) {
  return String(s == null ? '' : s).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&lt;(\/?)strong&gt;/g, '<$1strong>');
}
var IQ_NUM = ['stock', 'max', 'rop', 'eoq', 'demand', 'cost', 'sell', 'lead', 'incoming'];
function iqClean(arr) {
  if (!Array.isArray(arr)) return [];
  var seen = {};
  return arr.filter(function (p) { return p && typeof p === 'object'; }).map(function (p) {
    var tips = Array.isArray(p.tips) ? p.tips : null;
    var c = iqScrub(p);
    IQ_NUM.forEach(function (k) { if (k in c) c[k] = Number(c[k]) || 0; });
    c.id = Number(c.id); // ids are spliced into onclick="...(id)" handlers
    if (!isFinite(c.id) || seen[c.id]) c.id = Date.now() + Math.floor(Math.random() * 1e6);
    seen[c.id] = 1;
    c.history = Array.isArray(c.history) ? c.history.map(function (x) { return Number(x) || 0; }) : [];
    if (tips) c.tips = tips.map(function (t) { var s = iqScrub(t) || {}; s.body = iqSafeTip(t && t.body); return s; });
    return c;
  });
}

/* ── Inventory engine ──
   Every inventory formula lives here once; both pages and tests/check.mjs call it.
   mobile/src/lib/storage.js keeps a copy with the same constants (React Native
   can't load this file) — change both together. */
var IQ_PARAMS = {
  orderCost: 50,        // S: ₹ per order placed (calls, travel, receiving)
  holdRate: 0.20,       // holding cost per year as a fraction of unit cost → H = holdRate × cost (₹/unit/year)
  z: { A: 1.65, B: 1.28, C: 1.04 }, // safety factor: 95% / 90% / 85% chance an order cycle has no stockout
  cvFallback: 0.30,     // until there are minHistory days of sales, assume daily demand varies ±30% (σ = 0.3 × mean)
  minHistory: 7,        // logged days before sales fully replace the typed daily demand
  window: 14,           // most recent logged days used for the planning demand and its variability
  abcCut: [0.80, 0.95], // ABC: products making the first 80% of annual revenue are A, the next 15% B, the rest C
  watchBand: 1.4,       // "watch" while stock is less than 40% above the reorder point
  defaultLead: 3        // days, when a product has no lead time
};
var IQ_HEALTH_W = [30, 25, 20, 15, 10]; // health weights: stockout, excess, forecast, supplier lead time, service

function iqMean(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : 0; }
function iqLead(p) { return p.lead > 0 ? p.lead : IQ_PARAMS.defaultLead; }

// Planning demand (units/day): average of recent logged sales, blended with the
// typed estimate until there are minHistory days of history.
// ponytail: days the shelf was empty can't be logged, so demand during stockouts is under-counted.
function iqDemand(p) {
  var h = Array.isArray(p.history) ? p.history : [], typed = Math.max(0, Number(p.demand) || 0);
  if (!h.length) return typed;
  var w = typed ? Math.min(1, h.length / IQ_PARAMS.minHistory) : 1;
  return w * iqMean(h.slice(-IQ_PARAMS.window)) + (1 - w) * typed;
}
// Planning demand of a product already run through iqRecompute (falls back to computing it).
function iqD(p) { return typeof p.planDemand === 'number' ? p.planDemand : iqDemand(p); }

// σ of daily demand. Short history → assume cvFallback. Never below √mean (the
// randomness of individual customers), so a few identical days can't zero the safety stock.
function iqSigma(p, d) {
  var h = Array.isArray(p.history) ? p.history.slice(-IQ_PARAMS.window) : [];
  if (h.length < IQ_PARAMS.minHistory) return IQ_PARAMS.cvFallback * d;
  var m = iqMean(h);
  var sd = Math.sqrt(h.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / (h.length - 1));
  return Math.max(sd, Math.sqrt(d));
}
// Safety stock = z × σ × √L ; reorder point = demand during the lead time + safety stock.
// ponytail: lead time treated as fixed — add lead-time variance once deliveries are logged.
function iqSafetyStock(sigma, lead, cls) { return (IQ_PARAMS.z[cls] || IQ_PARAMS.z.C) * sigma * Math.sqrt(lead); }
function iqROP(d, sigma, lead, cls) { return Math.max(1, Math.ceil(d * lead + iqSafetyStock(sigma, lead, cls))); }
// EOQ = √(2·D·S / H) with D = annual demand (units/year), S = ₹ per order, H = ₹ to hold one unit for a year.
function iqEOQ(d, cost) {
  var H = Math.max(0.1, IQ_PARAMS.holdRate * (cost || 0));
  return Math.max(1, Math.ceil(Math.sqrt(2 * d * 365 * IQ_PARAMS.orderCost / H)));
}

// Recompute every derived field for the whole catalog: planning demand, ABC
// class (Pareto needs all products), safety stock, ROP, EOQ, max and status.
// Run after load, sales, receiving and any add/edit/delete. Mutates and returns ps.
function iqRecompute(ps) {
  ps.forEach(function (p) { p.planDemand = Math.round(iqDemand(p) * 10) / 10; });
  var val = function (p) { return p.planDemand * 365 * (p.sell || 0); };
  var total = ps.reduce(function (s, p) { return s + val(p); }, 0), cum = 0;
  ps.slice().sort(function (a, b) { return val(b) - val(a); }).forEach(function (p) {
    var share = total > 0 ? cum / total : 1; // share of revenue earned by the products ranked above this one
    cum += val(p);
    p.cls = /^[ABC]$/.test(p.clsManual) ? p.clsManual : share < IQ_PARAMS.abcCut[0] ? 'A' : share < IQ_PARAMS.abcCut[1] ? 'B' : 'C';
  });
  ps.forEach(function (p) {
    var d = p.planDemand, L = iqLead(p), sigma = iqSigma(p, d);
    p.ss = Math.round(iqSafetyStock(sigma, L, p.cls));
    p.rop = iqROP(d, sigma, L, p.cls);
    p.eoq = iqEOQ(d, p.cost);
    p.max = Math.max(p.rop + p.eoq, p.stock || 0); // order-up-to level: reorder point + one order
    p.status = iqStatus(p);
  });
  return ps;
}

/* ── Stock position ── */
function iqCover(p) { return (p.stock || 0) / Math.max(0.01, iqD(p)); } // days the stock on hand lasts
// Units you can't sell if you order today: lead-time demand not covered by stock on hand.
function iqLostUnits(p) { return Math.max(0, iqD(p) * iqLead(p) - (p.stock || 0)); }
function iqRevAtRisk(p) { return Math.round(iqLostUnits(p) * (p.sell || 0)); }
function iqStatus(p) {
  if (!(p.stock > 0) || iqLostUnits(p) > 0) return 'critical'; // runs out before a new order could arrive
  if (p.stock <= p.rop) return 'order';
  if (p.stock <= p.rop * IQ_PARAMS.watchBand) return 'watch';
  return 'good';
}

/* ── Ordering ──
   Decide on inventory position (on hand + already ordered), so a product that
   was marked ordered stops nagging until the order turns out to be too small. */
function iqNeedsAction(p) {
  return p.status !== 'good' && p.stock + (p.incoming || 0) <= p.rop * IQ_PARAMS.watchBand;
}
function iqShouldOrder(p) { return p.stock + (p.incoming || 0) <= p.rop; }
// How much to order: enough to bring the position back up to ROP + EOQ, never less than one EOQ.
function iqOrderQty(p) { return Math.max(p.eoq || 1, Math.ceil((p.rop || 0) + (p.eoq || 0) - p.stock - (p.incoming || 0))); }
function iqReceive(p) {
  p.stock += p.incoming || 0;
  p.incoming = 0;
  if (p.stock > p.max) p.max = p.stock;
}

/* ── Sales history: one bucket per calendar day ──
   history[] feeds the forecast as "units per day", so a second save on the
   same day must add to today's bucket, not create a new "day". */
function iqToday(d) { // local calendar day, YYYY-MM-DD (today unless a Date is given)
  d = d || new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function iqLogSale(p, q, today) {
  today = today || iqToday();
  if (!Array.isArray(p.history)) p.history = [];
  // ponytail: days with no logged sales are skipped, not zero-filled — a forgotten entry shouldn't read as zero demand.
  if (p.histDay === today && p.history.length) p.history[p.history.length - 1] += q;
  else p.history.push(q);
  p.histDay = today;
  if (p.history.length > 60) p.history = p.history.slice(-60);
}

/* ── Forecast: linear trend blended with 7-day moving average ── */
function linReg(arr) {
  var n = arr.length;
  if (n < 2) return { slope: 0, intercept: arr[0] || 0, r2: 0 };
  var sx = 0, sy = 0, sxy = 0, sx2 = 0;
  arr.forEach(function (y, x) { sx += x; sy += y; sxy += x * y; sx2 += x * x; });
  var slope = (n * sxy - sx * sy) / (n * sx2 - sx * sx) || 0;
  var intercept = (sy - slope * sx) / n;
  var ym = sy / n;
  var ssTot = arr.reduce(function (s, y) { return s + Math.pow(y - ym, 2); }, 0);
  var ssRes = arr.reduce(function (s, y, x) { return s + Math.pow(y - (slope * x + intercept), 2); }, 0);
  return { slope: slope, intercept: intercept, r2: ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0 };
}
// Next-day forecast from history h: 0.6 × trend line + 0.4 × 7-day average.
// The trend part is held within ±50% of the 7-day average so a short or noisy run
// can't extrapolate to silly (negative or runaway) values; under 4 days it's just the average.
function iqFcNext(h) {
  var n = h.length, ma = iqMean(h.slice(-7));
  if (n < 4) return ma;
  var reg = linReg(h);
  var lin = Math.min(Math.max(reg.intercept + reg.slope * n, ma * 0.5), ma * 1.5);
  return 0.6 * lin + 0.4 * ma;
}
// acc = forecast accuracy measured by backtest: forecast each of the last (up to) 7
// logged days from the days before it; acc = 1 − WAPE (Σ|error| ÷ Σ actual), null until 7 days.
// r2 is how straight the history is (trend fit), not accuracy. trendPct = trend change per week.
function iqForecast(p) {
  var h = Array.isArray(p.history) ? p.history : [], n = h.length, d = iqD(p);
  if (n < 2) return { forecast: Math.round(d), ci: Math.round(1.645 * iqSigma(p, d)), trend: 'flat', trendPct: 0, acc: null, r2: 0, ma7: Math.round(d), n: n };
  var k = Math.min(7, n - 4), err = 0, sq = 0, act = 0;
  for (var t = n - k; t < n; t++) {
    var e = h[t] - iqFcNext(h.slice(0, t));
    err += Math.abs(e); sq += e * e; act += h[t];
  }
  var reg = linReg(h), ma7 = iqMean(h.slice(-7));
  var pct = ma7 > 0 ? Math.round(reg.slope * 7 / ma7 * 100) : 0;
  return {
    forecast: Math.max(0, Math.round(iqFcNext(h))),
    ci: Math.round(1.645 * (k >= 3 ? Math.sqrt(sq / k) : iqSigma(p, d))), // 90% band from backtest errors
    trend: pct >= 5 ? 'up' : pct <= -5 ? 'down' : 'flat',
    trendPct: Math.abs(pct),
    acc: k >= 3 && act > 0 ? Math.max(0, Math.round((1 - err / act) * 100)) : null,
    r2: Math.round(reg.r2 * 100),
    ma7: Math.round(ma7),
    n: n
  };
}

/* ── Inventory health (0–100) and the numbers behind it ──
   Weighted (IQ_HEALTH_W) mix of five sub-scores, each 0–100:
   stockout  — days of cover vs 1.5 × lead time, weighted by revenue
   excess    — share of stock value that is NOT above max (ROP + EOQ)
   forecast  — backtest accuracy, weighted by demand (70 when no product has 7 days of sales)
   supplier  — shorter lead times score higher (delivery history isn't tracked yet)
   service   — expected fill: share of lead-time demand the stock on hand can serve */
function iqHealth(ps) {
  if (!ps || !ps.length) return null;
  var inv = 0, cogs = 0, exc = 0, rar = 0, so = [0, 0], fc = [0, 0], sup = [0, 0], svc = [0, 0];
  var risks = [], opps = [], plan = [], revItems = [], dist = { high: 0, med: 0, low: 0 };
  ps.forEach(function (p) {
    var d = Math.max(0.01, iqD(p)), L = iqLead(p), stock = p.stock || 0, cost = p.cost || 0, sell = p.sell || 0;
    var cover = stock / d, rev = sell * d, r = iqRevAtRisk(p), acc = iqForecast(p).acc;
    var exVal = Math.max(0, stock - (p.rop || 0) - (p.eoq || 0)) * cost;
    inv += stock * cost; cogs += d * 365 * cost; exc += exVal; rar += r;
    so[0] += Math.min(100, cover / (L * 1.5) * 100) * rev; so[1] += rev;
    svc[0] += Math.min(100, stock / (d * L) * 100) * d; svc[1] += d;
    if (acc != null) { fc[0] += acc * d; fc[1] += d; }
    sup[0] += Math.max(0, Math.min(100, (1 - (L - 1) / 13) * 100)) * d; sup[1] += d;
    var st = iqStatus(p), lvl = st === 'critical' ? 'high' : st === 'order' ? 'med' : 'low', c = Math.round(cover * 10) / 10;
    dist[lvl]++;
    if (r > 0) revItems.push({ name: p.name, ico: p.ico || '📦', amt: r });
    if (lvl !== 'low') risks.push({ name: p.name, ico: p.ico || '📦', cover: c, lvl: lvl, amt: r });
    if (exVal > 0) opps.push({ name: p.name, ico: p.ico || '📦', amt: Math.round(exVal) });
    if (iqShouldOrder(p)) { var q = iqOrderQty(p); plan.push({ name: p.name, ico: p.ico || '📦', qty: q, cost: Math.round(q * cost), cover: c }); }
  });
  var avg = function (a, dflt) { return a[1] ? a[0] / a[1] : dflt; };
  var forecastAcc = fc[1] ? Math.round(fc[0] / fc[1]) : null;
  var sub = [['Stockout', avg(so, 100)], ['Excess', 100 - Math.min(100, inv > 0 ? exc / inv * 100 : 0)],
    ['Forecast', forecastAcc != null ? forecastAcc : 70], ['Supplier', avg(sup, 80)], ['Service', avg(svc, 100)]]
    .map(function (s) { return [s[0], Math.round(s[1])]; });
  var health = Math.max(0, Math.min(100, Math.round(sub.reduce(function (a, s, i) { return a + IQ_HEALTH_W[i] * s[1]; }, 0) / 100)));
  var turnover = inv > 0 ? cogs / inv : 0;
  revItems.sort(function (a, b) { return b.amt - a.amt; });
  risks.sort(function (a, b) { return b.amt - a.amt || a.cover - b.cover; });
  opps.sort(function (a, b) { return b.amt - a.amt; });
  plan.sort(function (a, b) { return a.cover - b.cover; });
  return {
    health: health, grade: health >= 85 ? 'A' : health >= 75 ? 'B' : health >= 65 ? 'C' : health >= 55 ? 'D' : 'E', sub: sub,
    invValue: Math.round(inv), recoverable: Math.round(exc), revAtRisk: rar, revItems: revItems,
    serviceLevel: sub[4][1], forecastAcc: forecastAcc, turnover: Math.round(turnover * 10) / 10, dio: turnover > 0 ? Math.round(365 / turnover) : null,
    risks: risks, opps: opps, plan: plan, dist: dist
  };
}
// Keeps one health score per day in localStorage; returns the previous score and the history.
function iqTrackHealth(health) {
  var prev = null, hist = [];
  try {
    hist = JSON.parse(localStorage.getItem('iq_health_hist') || '[]');
    var today = new Date().toISOString().slice(0, 10);
    if (!hist.length || hist[hist.length - 1].d !== today) {
      if (hist.length) prev = hist[hist.length - 1].h;
      hist.push({ d: today, h: health });
      while (hist.length > 60) hist.shift();
      localStorage.setItem('iq_health_hist', JSON.stringify(hist));
    } else if (hist.length > 1) prev = hist[hist.length - 2].h;
  } catch (e) {}
  return { prev: prev, hist: hist };
}

/* ── What-if: demand changes by dPct %, lead time by lDelta days ──
   stockouts = products whose stock won't last the new lead time; service = expected fill
   (as in iqHealth); capital = cost of topping each product up to its new reorder point;
   ssPct = change in total safety stock. */
function iqSimulate(ps, dPct, lDelta) {
  var f = 1 + dPct / 100, stockouts = 0, capital = 0, fill = 0, need = 0, ssBase = 0, ssNew = 0, rows = [];
  ps.forEach(function (p) {
    var d = iqD(p), sigma = iqSigma(p, d), L = iqLead(p), nl = Math.max(1, L + lDelta), cost = p.cost || 0, stock = p.stock || 0;
    var leadDemand = d * f * nl, newRop = iqROP(d * f, sigma * f, nl, p.cls), out = stock < leadDemand, extra = Math.max(0, newRop - stock) * cost;
    if (out) stockouts++;
    capital += extra; fill += Math.min(stock, leadDemand); need += leadDemand;
    ssBase += iqSafetyStock(sigma, L, p.cls); ssNew += iqSafetyStock(sigma * f, nl, p.cls);
    rows.push({ name: p.name, ico: p.ico || '📦', out: out, capital: Math.round(extra), newRop: newRop, oldRop: p.rop || 0 });
  });
  rows.sort(function (a, b) { return b.capital - a.capital; });
  return { stockouts: stockouts, capital: Math.round(capital), service: need > 0 ? Math.round(fill / need * 100) : 100,
    ssPct: ssBase > 0 ? Math.round((ssNew - ssBase) / ssBase * 100) : 0, rows: rows };
}

/* ── Feature status shown in the app — keep it true to what this build does ── */
function iqFeatures() {
  var planned = 'Planned — not implemented in this build.';
  return [
    { n: 'Reorder engine (ROP · EOQ · ABC)', d: 'Reorder point = demand over the lead time + safety stock (95/90/85% service for A/B/C). EOQ order size. ABC = Pareto on annual revenue. All recomputed from logged sales.', ok: true },
    { n: 'Demand forecast', d: 'Trend line + 7-day moving average over daily sales. Accuracy is measured by backtesting the last 7 logged days.', ok: true },
    { n: 'Cloud sync', d: iqCloudReady() ? 'Versioned snapshot sync to your backend; other devices join with the store link code.' : 'Not configured — data stays on this device. See backend/README.md.', ok: iqCloudReady() },
    { n: 'DSE — Differential Sync Engine', d: planned, ok: false },
    { n: 'VCR — Vector Clock Resolver', d: planned, ok: false },
    { n: 'EnergyGuard · FieldLock · SHA-256 integrity hash', d: planned, ok: false }
  ];
}

/* ── Cloud sync (backend/: Cloudflare Worker + D1) ──
   A store is { storeId, token } from POST /api/stores, saved in localStorage
   'iq_store' with the last synced version. Other devices join with the link
   code iq1:<storeId>:<token> — it works like a password. Both functions
   resolve to { mode: 'cloud' | 'local', ... }; 'local' = cloud not configured. */
function iqStore(s) {
  if (s) localStorage.setItem('iq_store', JSON.stringify(s));
  try { return JSON.parse(localStorage.getItem('iq_store') || 'null'); } catch (e) { return null; }
}
function iqLinkCode() { var s = iqStore(); return s ? 'iq1:' + s.storeId + ':' + s.token : null; }
function iqApi(method, path, token, body) {
  var h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = 'Bearer ' + token;
  return fetch(IQ_API.replace(/\/$/, '') + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, data: d }; }); });
}
function iqFail(r) { throw new Error(r.status === 401 ? 'Link code not recognised' : (r.data.error || 'Server ' + r.status)); }

// Union by product id (this device wins on clashes) and by sale timestamp.
// ponytail: whole-product last-writer-wins; field-level merge if two devices edit the same product often.
function iqMerge(local, remote) {
  var byId = {}, order = [];
  remote.products.concat(local.products).forEach(function (p) { if (!(p.id in byId)) order.push(p.id); byId[p.id] = p; });
  var seen = {};
  var sales = remote.sales.concat(local.sales)
    .filter(function (e) { if (!e || seen[e.date]) return false; seen[e.date] = 1; return true; })
    .sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(-365);
  return { products: order.map(function (id) { return byId[id]; }), sales: sales };
}

// Resolves { mode, merged }: merged is { data, sales } when another device had saved
// first — the caller should adopt it, since that's now what the cloud holds.
function iqPush(prods, sales) {
  sales = sales || [];
  if (!iqCloudReady()) {
    localStorage.setItem('iq_cloud_snapshot', JSON.stringify({ data: prods, sales: sales, timestamp: Date.now(), deviceId: getDeviceId() }));
    return Promise.resolve({ mode: 'local' });
  }
  var s = iqStore();
  var ready = s ? Promise.resolve(s) : iqApi('POST', '/api/stores').then(function (r) {
    if (r.status !== 201) iqFail(r);
    return iqStore({ storeId: r.data.storeId, token: r.data.token, version: 0 });
  });
  return ready.then(function (s) {
    var path = '/api/stores/' + s.storeId + '/snapshot', merged = null;
    return iqApi('PUT', path, s.token, { baseVersion: s.version, products: prods, sales: sales }).then(function (r) {
      if (r.status !== 409) return r;
      return iqApi('GET', path, s.token).then(function (g) {
        if (g.status !== 200) iqFail(g);
        merged = iqMerge({ products: prods, sales: sales }, { products: iqClean(g.data.products), sales: iqScrub(g.data.sales || []) });
        return iqApi('PUT', path, s.token, { baseVersion: g.data.version, products: merged.products, sales: merged.sales });
      });
    }).then(function (r) {
      if (r.status !== 200) iqFail(r);
      s.version = r.data.version;
      iqStore(s);
      return { mode: 'cloud', merged: merged && { data: merged.products, sales: merged.sales } };
    });
  });
}

// code: a link code from another device, or blank for this store's latest.
// Resolves null when nothing is saved. Call snap.commit() only after the user
// confirms the restore — it links this device to that store from then on.
function iqPull(code) {
  code = (code || '').trim();
  if (!iqCloudReady()) {
    var l = null;
    try { l = JSON.parse(localStorage.getItem('iq_cloud_snapshot') || 'null'); } catch (e) {}
    return Promise.resolve(l && { mode: 'local', data: iqClean(l.data), sales: Array.isArray(l.sales) ? iqScrub(l.sales) : null, ts: l.timestamp, deviceId: l.deviceId, commit: function () {} });
  }
  var s = iqStore();
  if (code) {
    var parts = code.split(':');
    if (parts[0] !== 'iq1' || !parts[1] || !parts[2]) return Promise.reject(new Error('Invalid link code — it looks like iq1:IQ-…:…'));
    s = { storeId: parts[1], token: parts[2], version: 0 };
  }
  if (!s) return Promise.reject(new Error('This device has not synced yet — paste a link code'));
  return iqApi('GET', '/api/stores/' + s.storeId + '/snapshot', s.token).then(function (r) {
    if (r.status !== 200) iqFail(r);
    if (!r.data.version) return null;
    return { mode: 'cloud', data: iqClean(r.data.products), sales: iqScrub(r.data.sales || []), ts: r.data.updatedAt,
      commit: function () { s.version = r.data.version; iqStore(s); } };
  });
}

if (typeof module !== 'undefined') module.exports = { iqMerge: iqMerge, iqPush: iqPush, iqPull: iqPull, iqNeedsAction: iqNeedsAction, iqReceive: iqReceive, iqScrub: iqScrub, iqClean: iqClean, iqSafeTip: iqSafeTip, iqLogSale: iqLogSale, linReg: linReg, iqForecast: iqForecast,
  IQ_PARAMS: IQ_PARAMS, iqDemand: iqDemand, iqSigma: iqSigma, iqSafetyStock: iqSafetyStock, iqROP: iqROP, iqEOQ: iqEOQ, iqRecompute: iqRecompute,
  iqCover: iqCover, iqLostUnits: iqLostUnits, iqRevAtRisk: iqRevAtRisk, iqStatus: iqStatus, iqShouldOrder: iqShouldOrder, iqOrderQty: iqOrderQty,
  iqHealth: iqHealth, iqSimulate: iqSimulate };
