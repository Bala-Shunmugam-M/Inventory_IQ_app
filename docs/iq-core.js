/* InventoryIQ — shared core for index.html and dashboard.html.
   Data hygiene, sales history, forecasting and cloud sync live here once,
   so the mobile web app and the desktop dashboard can't drift apart. */

/* ── Cloud sync config ──
   Fill in after running supabase/schema.sql. The anon/publishable key is meant
   to be public: the schema blocks direct table access, so the key alone can't
   read anyone's data. Leave empty to keep everything on this device. */
var IQ_CLOUD = { url: '', key: '' };

function iqCloudReady() { return !!(IQ_CLOUD.url && IQ_CLOUD.key); }

/* ── Device ID ── the Device ID is the password to this store's cloud data, so use a CSPRNG. */
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

/* ── Ordering ──
   Decide on inventory position (on hand + already ordered), so a product that
   was marked ordered stops nagging until the order turns out to be too small. */
function iqNeedsAction(p) {
  return p.status !== 'good' && p.stock + (p.incoming || 0) <= p.rop * 1.4;
}
function iqReceive(p) {
  p.stock += p.incoming || 0;
  p.incoming = 0;
  if (p.stock > p.max) p.max = p.stock;
}

/* ── Sales history: one bucket per calendar day ──
   history[] feeds the forecast as "units per day", so a second save on the
   same day must add to today's bucket, not create a new "day". */
function iqToday() {
  var d = new Date();
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

/* ── Forecast: linear regression blended with 7-day moving average ── */
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
function iqForecast(p) {
  var hist = Array.isArray(p.history) ? p.history : [];
  var n = hist.length;
  if (n < 2) return { forecast: p.demand || 0, ci: 0, trend: 'flat', trendPct: 0, acc: 0 };
  var reg = linReg(hist);
  var ma7 = hist.slice(-7).reduce(function (a, b) { return a + b; }, 0) / Math.min(7, n);
  var resid = hist.map(function (y, x) { return y - (reg.slope * x + reg.intercept); });
  var stdErr = Math.sqrt(resid.reduce(function (s, r) { return s + r * r; }, 0) / Math.max(1, n - 2));
  return {
    forecast: Math.max(0, Math.round((reg.intercept + reg.slope * n) * 0.6 + ma7 * 0.4)),
    ci: Math.round(1.65 * stdErr),
    trend: reg.slope > 0.3 ? 'up' : reg.slope < -0.3 ? 'down' : 'flat',
    trendPct: Math.abs(Math.round((reg.slope * 100) / (ma7 || 1))),
    acc: Math.round(reg.r2 * 100)
  };
}

/* ── Feature status shown in the app — keep it true to what this build does ── */
function iqFeatures() {
  var planned = 'Planned — not implemented in this build.';
  return [
    { n: 'Reorder engine (ROP · EOQ · ABC)', d: 'Reorder point, order quantity and ABC class computed for every product.', ok: true },
    { n: 'Demand forecast', d: 'Linear regression + 7-day moving average over daily sales history.', ok: true },
    { n: 'Cloud sync', d: iqCloudReady() ? 'Full-snapshot sync via Supabase, keyed by Device ID.' : 'Not configured — data stays on this device. See supabase/schema.sql.', ok: iqCloudReady() },
    { n: 'DSE — Differential Sync Engine', d: planned, ok: false },
    { n: 'VCR — Vector Clock Resolver', d: planned, ok: false },
    { n: 'EnergyGuard · FieldLock · SHA-256 integrity hash', d: planned, ok: false }
  ];
}

/* ── Cloud sync (Supabase RPC; see supabase/schema.sql) ──
   Both resolve to { mode: 'cloud' | 'local', ... }. 'local' means cloud isn't
   configured and the snapshot only lives in this browser. */
function iqRpc(fn, body) {
  return fetch(IQ_CLOUD.url.replace(/\/$/, '') + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { apikey: IQ_CLOUD.key, Authorization: 'Bearer ' + IQ_CLOUD.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function (r) {
    return r.text().then(function (t) {
      if (!r.ok) throw new Error('Cloud ' + r.status + ': ' + t.slice(0, 120));
      return t ? JSON.parse(t) : null;
    });
  });
}
function iqPush(prods, sales) {
  var id = getDeviceId();
  if (!iqCloudReady()) {
    localStorage.setItem('iq_cloud_snapshot', JSON.stringify({ data: prods, sales: sales, timestamp: Date.now(), deviceId: id }));
    return Promise.resolve({ mode: 'local' });
  }
  return iqRpc('iq_push', { p_device_id: id, p_data: prods, p_sales: sales }).then(function () { return { mode: 'cloud' }; });
}
// Resolves to null when nothing is stored for that ID.
function iqPull(id) {
  id = (id || '').trim().toUpperCase() || getDeviceId();
  if (!iqCloudReady()) {
    var s = null;
    try { s = JSON.parse(localStorage.getItem('iq_cloud_snapshot') || 'null'); } catch (e) {}
    return Promise.resolve(s && { mode: 'local', data: iqClean(s.data), sales: Array.isArray(s.sales) ? iqScrub(s.sales) : null, ts: s.timestamp, deviceId: s.deviceId });
  }
  return iqRpc('iq_pull', { p_device_id: id }).then(function (r) {
    return r && { mode: 'cloud', data: iqClean(r.data), sales: Array.isArray(r.sales_log) ? iqScrub(r.sales_log) : null, ts: r.updated_at, deviceId: id };
  });
}

if (typeof module !== 'undefined') module.exports = { iqNeedsAction: iqNeedsAction, iqReceive: iqReceive, iqScrub: iqScrub, iqClean: iqClean, iqSafeTip: iqSafeTip, iqLogSale: iqLogSale, linReg: linReg, iqForecast: iqForecast };
