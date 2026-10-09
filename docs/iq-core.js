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
function iqNum(x) { var n = Number(x); return isFinite(n) && n > 0 ? n : 0; } // finite and >= 0, else 0
// For values placed inside a quoted HTML attribute (e.g. data-*). Scrubbing alone doesn't cover that context.
function iqAttr(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}
// LLM output is untrusted: strip markup from every string and force the numeric fields to numbers.
function iqAiClean(d) {
  d = iqScrub(d) || {};
  var num = function (x) { var n = Number(x); return x != null && x !== '' && isFinite(n) ? n : null; };
  (Array.isArray(d.at_risk_skus) ? d.at_risk_skus : (d.at_risk_skus = [])).forEach(function (s) { s.days_cover = num(s.days_cover); s.confidence = num(s.confidence); });
  (Array.isArray(d.recommendations) ? d.recommendations : (d.recommendations = [])).forEach(function (r) { var n = num(r.priority); r.priority = n == null ? null : Math.max(1, Math.min(9, Math.round(n))); });
  return d;
}
function iqUid() { var a = new Uint32Array(2); crypto.getRandomValues(a); return a[0].toString(36) + a[1].toString(36); }
function iqClean(arr) {
  if (!Array.isArray(arr)) return [];
  var seen = {};
  return arr.filter(function (p) { return p && typeof p === 'object'; }).map(function (p) {
    var tips = Array.isArray(p.tips) ? p.tips : null;
    var c = iqScrub(p);
    IQ_NUM.forEach(function (k) { if (k in c) c[k] = iqNum(c[k]); });
    c.id = Number(c.id); // ids are spliced into onclick="...(id)" handlers
    if (!isFinite(c.id) || seen[c.id]) c.id = Date.now() + Math.floor(Math.random() * 1e6);
    seen[c.id] = 1;
    c.history = Array.isArray(c.history) ? c.history.map(iqNum) : [];
    c.histCens = c.history.map(function (x, i) { return Array.isArray(p.histCens) && p.histCens[i] ? 1 : 0; });
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
  minHistory: 7,        // usable logged days before sales fully replace the typed daily demand
  window: 14,           // most recent logged days used for the planning demand and its variability
  abcCut: [0.80, 0.95], // ABC: products making the first 80% of annual revenue are A, the next 15% B, the rest C
  reviewDays: 1,        // R: stock is reviewed once a day, so an order can go out up to a day late
  watchBand: 1.4,       // "watch" while stock is less than 40% above the reorder point
  defaultLead: 3        // days, when a product has no lead time
};
var IQ_HEALTH_W = [30, 25, 20, 15, 10]; // health weights: stockout, excess, forecast, supplier lead time, service

function iqMean(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : 0; }
function iqLead(p) { return p.lead > 0 ? p.lead : IQ_PARAMS.defaultLead; }

// Usable demand observations: recent logged days that were NOT censored by a stockout
// (a day the product sold out or had no stock only shows how much stock there was).
function iqObs(p) {
  var h = Array.isArray(p.history) ? p.history : [], c = Array.isArray(p.histCens) ? p.histCens : [];
  var n = h.length, from = Math.max(0, n - IQ_PARAMS.window), out = [];
  for (var i = from; i < n; i++) if (!c[i]) out.push(h[i]);
  return out;
}
// Planning demand (units/day): average of usable recent days, blended with the typed
// estimate in proportion to how many usable days there are (full weight at minHistory).
function iqDemand(p) {
  var typed = iqNum(p.demand), obs = iqObs(p);
  if (!obs.length) { // nothing usable: keep the estimate; if there is none, censored sales are a lower bound
    var h = Array.isArray(p.history) ? p.history.slice(-IQ_PARAMS.window) : [];
    return typed || iqMean(h);
  }
  var w = typed ? Math.min(1, obs.length / IQ_PARAMS.minHistory) : 1;
  return w * iqMean(obs) + (1 - w) * typed;
}
// Planning demand of a product already run through iqRecompute (falls back to computing it).
function iqD(p) { return typeof p.planDemand === 'number' ? p.planDemand : iqDemand(p); }

// σ of daily demand from usable days; with fewer than minHistory assume cvFallback.
// Either way never below √mean (Poisson-like randomness of individual customers — an
// assumption), so a few identical days can't zero the safety stock.
function iqSigma(p, d) {
  var h = iqObs(p), sd;
  if (h.length < IQ_PARAMS.minHistory) sd = IQ_PARAMS.cvFallback * d;
  else {
    var m = iqMean(h);
    sd = Math.sqrt(h.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / (h.length - 1));
  }
  return Math.max(sd, Math.sqrt(d));
}
// Daily review: an order covers the lead time plus the review period, T = L + R.
// Safety stock = z × σ × √T ; reorder point = demand over T + safety stock.
// z sets a target chance that an order cycle has no stockout under a normal
// approximation — a model assumption, not a measured service level.
// ponytail: lead time treated as fixed — add lead-time variance once deliveries are logged.
function iqSafetyStock(sigma, lead, cls) { return (IQ_PARAMS.z[cls] || IQ_PARAMS.z.C) * sigma * Math.sqrt(lead + IQ_PARAMS.reviewDays); }
function iqROP(d, sigma, lead, cls) { return d > 0 ? Math.ceil(d * (lead + IQ_PARAMS.reviewDays) + iqSafetyStock(sigma, lead, cls)) : 0; }
// EOQ = √(2·D·S / H) with D = annual demand (units/year), S = ₹ per order, H = ₹ to hold one unit for a year.
// No demand → no order.
function iqEOQ(d, cost) {
  if (!(d > 0)) return 0;
  var H = Math.max(0.1, IQ_PARAMS.holdRate * (cost || 0));
  return Math.max(1, Math.ceil(Math.sqrt(2 * d * 365 * IQ_PARAMS.orderCost / H)));
}

// Recompute every derived field for the whole catalog: planning demand, ABC
// class (Pareto needs all products), safety stock, ROP, EOQ, max and status.
// Run after load, sales, receiving and any add/edit/delete. Mutates and returns ps.
function iqRecompute(ps) {
  ps.forEach(function (p) { p.planDemand = Math.round(iqDemand(p) * 100) / 100; }); // 2 dp keeps slow movers (0.04/day) non-zero
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
  if (!(iqD(p) > 0)) return 'good'; // no demand (or none known yet): nothing to reorder
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
function iqShouldOrder(p) { return p.rop > 0 && (p.stock || 0) + (p.incoming || 0) <= p.rop; }
// How much to order: nothing while the position is above the reorder point; otherwise
// enough to bring it back up to ROP + EOQ (which is at least one EOQ).
function iqOrderQty(p) {
  var ip = (p.stock || 0) + (p.incoming || 0);
  return iqShouldOrder(p) && p.eoq > 0 ? Math.ceil((p.rop || 0) + p.eoq - ip) : 0;
}
function iqReceive(p) {
  p.stock += p.incoming || 0;
  p.incoming = 0;
  if (p.stock > p.max) p.max = p.stock;
}

/* ── Sales history: one bucket per calendar day ──
   history[] feeds demand as "units per day", so a second save on the same day adds
   to today's bucket. histCens[i] = 1 marks a day the product sold out or had no
   stock: that day only shows a lower bound on demand, so demand math skips it. */
function iqToday(d) { // local calendar day, YYYY-MM-DD (today unless a Date is given)
  d = d || new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function iqLogSale(p, q, today, censored) {
  today = today || iqToday();
  if (!Array.isArray(p.history)) p.history = [];
  if (!Array.isArray(p.histCens) || p.histCens.length !== p.history.length) p.histCens = p.history.map(function () { return 0; });
  // ponytail: days with no save at all are skipped, not zero-filled — a forgotten day shouldn't read as zero demand.
  if (p.histDay === today && p.history.length) {
    p.history[p.history.length - 1] += q;
    if (censored) p.histCens[p.histCens.length - 1] = 1;
  } else {
    p.history.push(q);
    p.histCens.push(censored ? 1 : 0);
  }
  p.histDay = today;
  if (p.history.length > 60) { p.history = p.history.slice(-60); p.histCens = p.histCens.slice(-60); }
}
// One sales save. qty = { id: units }. Products not entered get a confirmed zero-sale
// day (the owner logged that day); selling out or an empty shelf marks the day censored.
// ponytail: assumes the owner enters every product sold that day.
// Mutates stock/history and returns the sale lines.
function iqRecordDay(ps, qty, today) {
  var lines = [];
  ps.forEach(function (p) {
    var start = p.stock || 0, q = Math.min(iqNum(qty[p.id]), start);
    p.stock = start - q;
    iqLogSale(p, q, today, p.stock <= 0);
    if (q > 0) lines.push({ id: p.id, name: p.name, qty: q, revenue: q * (p.sell || 0), profit: q * ((p.sell || 0) - (p.cost || 0)) });
  });
  return lines;
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
    ci: Math.round(1.645 * (k >= 3 ? Math.sqrt(sq / k) : iqSigma(p, d))), // typical error band (heuristic, not a calibrated 90% interval)
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
   service   — coverage: Σ min(stock, lead-time demand) ÷ Σ lead-time demand (same as iqSimulate) */
function iqHealth(ps) {
  if (!ps || !ps.length) return null;
  var inv = 0, cogs = 0, exc = 0, rar = 0, so = [0, 0], fc = [0, 0], sup = [0, 0], fill = 0, need = 0;
  var risks = [], opps = [], plan = [], revItems = [], dist = { high: 0, med: 0, low: 0 };
  ps.forEach(function (p) {
    var d = Math.max(0.01, iqD(p)), L = iqLead(p), stock = p.stock || 0, cost = p.cost || 0, sell = p.sell || 0;
    var cover = stock / d, rev = sell * d, r = iqRevAtRisk(p), acc = iqForecast(p).acc;
    var exVal = Math.max(0, stock - (p.rop || 0) - (p.eoq || 0)) * cost;
    inv += stock * cost; cogs += d * 365 * cost; exc += exVal; rar += r;
    so[0] += Math.min(100, cover / (L * 1.5) * 100) * rev; so[1] += rev;
    if (iqD(p) > 0) { fill += Math.min(stock, iqD(p) * L); need += iqD(p) * L; }
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
    ['Forecast', forecastAcc != null ? forecastAcc : 70], ['Supplier', avg(sup, 80)], ['Service', need > 0 ? fill / need * 100 : 100]]
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
    if (!(d > 0)) return; // no demand: nothing to cover
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
   A store is { storeId, token } from POST /api/stores, kept in localStorage
   'iq_store'. Other devices join with the link code iq1:<storeId>:<token> — it
   works like a password. 'iq_sync_base' holds the last synced snapshot and its
   version; each tab keeps the copy it loaded (IQ_BASE), so a stale tab can't
   borrow a newer tab's version and skip the conflict check. On 409 we do a
   three-way merge against that base. Both functions resolve to
   { mode: 'cloud' | 'local', ... }; 'local' = cloud not configured. */
function iqStore(s) {
  if (s) localStorage.setItem('iq_store', JSON.stringify(s));
  try { return JSON.parse(localStorage.getItem('iq_store') || 'null'); } catch (e) { return null; }
}
function iqLinkCode() { var s = iqStore(); return s ? 'iq1:' + s.storeId + ':' + s.token : null; }
function iqLoadBase() { try { return JSON.parse(localStorage.getItem('iq_sync_base') || 'null'); } catch (e) { return null; } }
var IQ_BASE = typeof localStorage !== 'undefined' ? iqLoadBase() : null;
function iqSetBase(version, products, sales) {
  IQ_BASE = { version: version, products: products, sales: sales };
  localStorage.setItem('iq_sync_base', JSON.stringify(IQ_BASE));
}
function iqApi(method, path, token, body) {
  var h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = 'Bearer ' + token;
  return fetch(IQ_API.replace(/\/$/, '') + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, data: d }; }); });
}
function iqFail(r) { throw new Error(r.status === 401 ? 'Link code not recognised' : (r.data.error || 'Server ' + r.status)); }

var IQ_COUNTERS = ['stock', 'incoming'];
var IQ_HIST = ['history', 'histCens', 'histDay'];
function iqSame(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
// Fields iqRecompute derives — never evidence that someone edited a product.
var IQ_DERIVED = { status: 1, planDemand: 1, ss: 1, rop: 1, eoq: 1, max: 1, cls: 1 };
function iqSameProduct(a, b) {
  var strip = function (p) { var o = {}; Object.keys(p).sort().forEach(function (k) { if (!IQ_DERIVED[k]) o[k] = p[k]; }); return o; };
  return iqSame(strip(a), strip(b));
}
// Three-way merge of product lists against the last synced base.
// - unchanged on one side → take the other side (covers adds, edits and deletes)
// - deleted on one side, edited on the other → keep the edit (never lose work)
// - edited on both → stock/incoming combine both sides' changes (base + Δlocal + Δremote);
//   sales history comes from the side that logged most recently; other fields: local wins
//   where local changed, otherwise remote.
// ponytail: same-day sales logged on both devices undercount that day in history[]; stock is exact.
function iqMerge3(base, local, remote) {
  base = iqClean(base); local = iqClean(local); remote = iqClean(remote); // same normal form on all three sides
  var B = {}, L = {}, R = {}, ids = [], seen = {};
  base.forEach(function (p) { B[p.id] = p; });
  [local, remote].forEach(function (list, i) {
    list.forEach(function (p) { (i ? R : L)[p.id] = p; if (!seen[p.id]) { seen[p.id] = 1; ids.push(p.id); } });
  });
  var out = [];
  ids.forEach(function (id) {
    var b = B[id], l = L[id], r = R[id];
    if (!b) { out.push(l || r); return; }             // added on one (or both) sides
    if (!l) { if (r && !iqSameProduct(r, b)) out.push(r); return; } // deleted locally; keep only if remote edited it
    if (!r) { if (!iqSameProduct(l, b)) out.push(l); return; }      // deleted remotely; keep only if local edited it
    if (iqSameProduct(l, b)) { out.push(r); return; }
    if (iqSameProduct(r, b)) { out.push(l); return; }
    var m = {}, k;
    for (k in r) m[k] = r[k];
    for (k in l) if (!IQ_DERIVED[k] && !iqSame(l[k], b[k])) m[k] = l[k];
    IQ_COUNTERS.forEach(function (k) { m[k] = Math.max(0, iqNum(b[k]) + (iqNum(l[k]) - iqNum(b[k])) + (iqNum(r[k]) - iqNum(b[k]))); });
    var src = String(l.histDay || '') >= String(r.histDay || '') ? l : r;
    IQ_HIST.forEach(function (k) { m[k] = src[k]; });
    out.push(m);
  });
  return out;
}
// Sales log entries are events with a unique id; union them.
function iqMergeSales(local, remote) {
  var seen = {}, key = function (e) { return e.id || e.date + ':' + e.totalUnits; };
  return remote.concat(local).filter(function (e) { if (!e || seen[key(e)]) return false; seen[key(e)] = 1; return true; })
    .sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(-365);
}

// Full-screen "Syncing…" lock: no edits can land between capturing the snapshot and applying the result.
var IQ_SYNCING = false;
function iqBusy(on) {
  IQ_SYNCING = on;
  if (typeof document === 'undefined') return;
  var el = document.getElementById('iqBusy');
  if (on && !el) {
    el = document.createElement('div');
    el.id = 'iqBusy';
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(13,18,38,.35);display:flex;align-items:center;justify-content:center;color:#fff;font:700 14px sans-serif';
    el.textContent = 'Syncing…';
    document.body.appendChild(el);
  } else if (!on && el) el.remove();
}

// Resolves { mode, merged }: merged is { data, sales } when another device had saved first —
// the caller must adopt it, since that's now what the cloud holds.
function iqPush(prods, sales) {
  sales = sales || [];
  if (!iqCloudReady()) {
    localStorage.setItem('iq_cloud_snapshot', JSON.stringify({ data: prods, sales: sales, timestamp: Date.now(), deviceId: getDeviceId() }));
    return Promise.resolve({ mode: 'local' });
  }
  if (IQ_SYNCING) return Promise.reject(new Error('A sync is already running'));
  iqBusy(true);
  var s = iqStore();
  var ready = s ? Promise.resolve(s) : iqApi('POST', '/api/stores').then(function (r) {
    if (r.status !== 201) iqFail(r);
    IQ_BASE = null;
    return iqStore({ storeId: r.data.storeId, token: r.data.token });
  });
  return ready.then(function (s) {
    var path = '/api/stores/' + s.storeId + '/snapshot', base = IQ_BASE || { version: 0, products: [], sales: [] };
    var out = { products: prods, sales: sales }, merged = false;
    return iqApi('PUT', path, s.token, { baseVersion: base.version, products: prods, sales: sales }).then(function (r) {
      if (r.status !== 409) return r;
      return iqApi('GET', path, s.token).then(function (g) {
        if (g.status !== 200) iqFail(g);
        var rp = iqClean(g.data.products), rs = iqScrub(g.data.sales || []);
        out = { products: iqMerge3(base.products, prods, rp), sales: iqMergeSales(sales, rs) };
        merged = true;
        return iqApi('PUT', path, s.token, { baseVersion: g.data.version, products: out.products, sales: out.sales });
      });
    }).then(function (r) {
      if (r.status !== 200) iqFail(r);
      iqSetBase(r.data.version, out.products, out.sales);
      return { mode: 'cloud', merged: merged ? { data: out.products, sales: out.sales } : null };
    });
  }).then(function (res) { iqBusy(false); return res; }, function (e) { iqBusy(false); throw e; });
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
    s = { storeId: parts[1], token: parts[2] };
  }
  if (!s) return Promise.reject(new Error('This device has not synced yet — paste a link code'));
  return iqApi('GET', '/api/stores/' + s.storeId + '/snapshot', s.token).then(function (r) {
    if (r.status !== 200) iqFail(r);
    if (!r.data.version) return null;
    var data = iqClean(r.data.products), sales = iqScrub(r.data.sales || []);
    return { mode: 'cloud', data: data, sales: sales, ts: r.data.updatedAt,
      commit: function () { iqStore(s); iqSetBase(r.data.version, data, sales); } };
  });
}

if (typeof module !== 'undefined') module.exports = { iqMerge3: iqMerge3, iqMergeSales: iqMergeSales, iqRecordDay: iqRecordDay, iqAiClean: iqAiClean, iqAttr: iqAttr, iqObs: iqObs, iqPush: iqPush, iqPull: iqPull, iqNeedsAction: iqNeedsAction, iqReceive: iqReceive, iqScrub: iqScrub, iqClean: iqClean, iqSafeTip: iqSafeTip, iqLogSale: iqLogSale, linReg: linReg, iqForecast: iqForecast,
  IQ_PARAMS: IQ_PARAMS, iqDemand: iqDemand, iqSigma: iqSigma, iqSafetyStock: iqSafetyStock, iqROP: iqROP, iqEOQ: iqEOQ, iqRecompute: iqRecompute,
  iqCover: iqCover, iqLostUnits: iqLostUnits, iqRevAtRisk: iqRevAtRisk, iqStatus: iqStatus, iqShouldOrder: iqShouldOrder, iqOrderQty: iqOrderQty,
  iqHealth: iqHealth, iqSimulate: iqSimulate };
