/**
 * InventoryIQ — Core Storage & Engine
 *
 * Single source of truth for the React Native mobile app.
 * Mirrors the same data model and storage keys used by the
 * web build (docs/index.html, docs/dashboard.html) so a user
 * can move between web and APK with the same data.
 *
 * Storage keys are intentionally identical to the web build's:
 *   inventoryiq_v8_data       — products array (JSON)
 *   inventoryiq_v8_sales      — sales log (JSON)
 *   inventoryiq_v8_dismissed  — dismissed action cards
 *   inventoryiq_v8_synchist   — last 5 sync snapshots (for undo)
 *   iq_device_id              — this device's stable ID
 *   iq_cloud_snapshot         — last cloud-sync snapshot
 *   iq_last_sync              — timestamp of last successful sync
 *   iq_events                 — stock event log (sale/order/receive/adjust/close), replayed on sync merge
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

export const KEYS = {
  PRODS: 'inventoryiq_v8_data',
  SALES: 'inventoryiq_v8_sales',
  DISMISSED: 'inventoryiq_v8_dismissed',
  SYNC_HIST: 'inventoryiq_v8_synchist',
  DEVICE: 'iq_device_id',
  CLOUD: 'iq_cloud_snapshot',
  LAST_SYNC: 'iq_last_sync',
  ONBOARDED: 'iq_onboarded',
  EVENTS: 'iq_events',
};

// ============================================================
// DEVICE ID
// ============================================================
export async function getDeviceId() {
  let id = await AsyncStorage.getItem(KEYS.DEVICE);
  if (!id) {
    // ponytail: Math.random, not a CSPRNG — RN has no crypto.getRandomValues without adding expo-crypto.
    // The ID is the cloud-sync password, so switch to expo-crypto if sync goes beyond a demo.
    const r = () => Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, '0');
    id = `IQ-${r()}-${r()}`;
    await AsyncStorage.setItem(KEYS.DEVICE, id);
  }
  return id;
}

// ============================================================
// PRODUCTS (CRUD)
// ============================================================
// Store data can come from older builds or another device: numbers must be finite and
// non-negative ("10" + 5 must be 15, not "105"). Same rules as iqClean in docs/iq-core.js.
const NUM_FIELDS = ['stock', 'max', 'rop', 'eoq', 'demand', 'cost', 'sell', 'lead', 'incoming'];
export const num = (x) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? n : 0; };
export function normalize(p) {
  const c = { ...p };
  NUM_FIELDS.forEach((k) => { if (k in c) c[k] = num(c[k]); });
  c.id = Number(c.id);
  c.history = Array.isArray(c.history) ? c.history.map(num) : [];
  c.histCens = c.history.map((_, i) => (Array.isArray(p.histCens) && p.histCens[i] ? 1 : 0));
  return c;
}

export async function loadProducts() {
  try {
    const raw = await AsyncStorage.getItem(KEYS.PRODS);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return recomputeAll(arr.filter((p) => p && typeof p === 'object').map(normalize).filter((p) => Number.isFinite(p.id)));
  } catch (e) {
    console.warn('loadProducts failed', e);
    return [];
  }
}

// cloud.js sets busy while a sync is in flight; a save then would be overwritten by the sync result.
export const SYNC = { busy: false };

// Derived fields (ROP, EOQ, ABC, max, status) are recomputed for the whole catalog on every save.
// Returns false (and tells the user) when nothing was written.
export async function saveProducts(products, { fromSync = false } = {}) {
  if (SYNC.busy && !fromSync) {
    Alert.alert('Sync in progress', 'Try again in a moment.');
    return false;
  }
  try {
    recomputeAll(products);
    await AsyncStorage.setItem(KEYS.PRODS, JSON.stringify(products));
    await AsyncStorage.setItem(KEYS.PRODS + '_ts', new Date().toISOString());
    return true;
  } catch (e) {
    console.warn('saveProducts failed', e);
    return false;
  }
}

export async function addProduct(input) {
  const products = await loadProducts();
  const newP = buildProduct(input);
  products.push(newP);
  if (!(await saveProducts(products))) return null;
  return newP;
}

// Mutations return null when nothing was saved (e.g. a sync is in progress).
export async function updateProduct(id, patch) {
  const products = await loadProducts();
  const idx = products.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const merged = { ...products[idx], ...patch };
  products[idx] = merged;
  if (!(await saveProducts(products))) return null; // recomputes merged's ROP/EOQ/ABC/status in place
  return merged;
}

export async function deleteProduct(id) {
  const products = await loadProducts();
  const filtered = products.filter((p) => p.id !== id);
  if (!(await saveProducts(filtered))) return null;
  return filtered;
}

// ============================================================
// EVENT LOG — every stock-changing action is also an event with a unique id, so
// sync can replay events instead of adding up differences (cloud.js). Same as docs/iq-core.js.
// ============================================================
const EV_MAX = 3000, EV_DAYS = 120;
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export async function loadEvents() {
  try {
    const a = JSON.parse((await AsyncStorage.getItem(KEYS.EVENTS)) || '[]');
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}
export function trimEvents(ev) {
  const cut = Date.now() - EV_DAYS * 864e5;
  return ev.filter((e) => e && e.t >= cut).sort((a, b) => a.t - b.t).slice(-EV_MAX);
}
export async function saveEvents(ev) {
  ev = trimEvents(ev);
  await AsyncStorage.setItem(KEYS.EVENTS, JSON.stringify(ev));
  return ev;
}
export async function addEvents(list) {
  const t = Date.now(), day = localDay();
  return saveEvents([...(await loadEvents()), ...list.map((f) => ({ id: uid(), t, day, ...f }))]);
}

// ============================================================
// INVENTORY ENGINE — same constants and formulas as docs/iq-core.js
// (RN can't load that file). Change both together.
// ============================================================
export const IQ_PARAMS = {
  orderCost: 50, // S: ₹ per order placed (calls, travel, receiving)
  holdRate: 0.2, // holding cost per year as a fraction of unit cost → H = holdRate × cost (₹/unit/year)
  z: { A: 1.65, B: 1.28, C: 1.04 }, // safety factor: 95% / 90% / 85% chance an order cycle has no stockout
  cvFallback: 0.3, // until there are minHistory days of sales, assume σ = 0.3 × mean daily demand
  minHistory: 7, // usable logged days before sales fully replace the typed daily demand
  window: 14, // most recent logged days used for the planning demand and its variability
  abcCut: [0.8, 0.95], // ABC: first 80% of annual revenue = A, next 15% = B, rest = C
  reviewDays: 1, // R: stock is reviewed once a day, so an order can go out up to a day late
  watchBand: 1.4, // "watch" while stock is less than 40% above the reorder point
  defaultLead: 3, // days
};

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
export const leadOf = (p) => (p.lead > 0 ? p.lead : IQ_PARAMS.defaultLead);

// Recent window with sold-out days read as lower bounds: iterate
// d = mean(x_i if uncensored else max(x_i, d)) from the plain mean to its fixed point.
// Returns { d, n: uncensored days, x: imputed window }. Same as iqCensMean.
export function censMean(p) {
  const h = Array.isArray(p.history) ? p.history : [];
  const c = Array.isArray(p.histCens) ? p.histCens : [];
  const from = Math.max(0, h.length - IQ_PARAMS.window), x = h.slice(from);
  const cs = x.map((_, i) => (c[from + i] ? 1 : 0));
  const n = cs.filter((k) => !k).length;
  const fill = (d) => x.map((v, i) => (cs[i] ? Math.max(v, d) : v));
  let d = mean(x);
  for (let it = 0; it < 200 && n > 0 && n < x.length; it++) { // all censored: plain mean
    const nd = mean(fill(d));
    if (Math.abs(nd - d) < 1e-9) { d = nd; break; }
    d = nd;
  }
  return { d, n, x: fill(d) };
}
// Planning demand (units/day): censor-aware average of recent days, blended with the typed
// estimate in proportion to how many uncensored days there are (full weight at minHistory).
export function planDemand(p) {
  const typed = num(p.demand);
  const e = censMean(p);
  if (!e.n) return typed || e.d; // no uncensored day: keep the estimate; sold-out days are a lower bound
  const w = typed ? Math.min(1, e.n / IQ_PARAMS.minHistory) : 1;
  return w * e.d + (1 - w) * typed;
}
const dOf = (p) => (typeof p.planDemand === 'number' ? p.planDemand : planDemand(p));

// σ of daily demand over the censor-imputed window; cvFallback under minHistory uncensored days; never below √mean.
export function demandSigma(p, d) {
  const { x: h, n } = censMean(p);
  let sd = IQ_PARAMS.cvFallback * d;
  if (n >= IQ_PARAMS.minHistory) {
    const m = mean(h);
    sd = Math.sqrt(h.reduce((s, x) => s + (x - m) ** 2, 0) / (h.length - 1));
  }
  return Math.max(sd, Math.sqrt(d));
}
// Protection period T = lead time + 1-day review. SS = z·σ·√T ; ROP = d·T + SS. No demand → 0.
export const safetyStock = (sigma, lead, cls) =>
  (IQ_PARAMS.z[cls] || IQ_PARAMS.z.C) * sigma * Math.sqrt(lead + IQ_PARAMS.reviewDays);
export const reorderPoint = (d, sigma, lead, cls) =>
  d > 0 ? Math.ceil(d * (lead + IQ_PARAMS.reviewDays) + safetyStock(sigma, lead, cls)) : 0;
// EOQ = √(2·D·S / H): D = annual demand (units/yr), S = ₹/order, H = ₹ to hold one unit a year. No demand → 0.
export function eoqOf(d, cost) {
  if (!(d > 0)) return 0;
  const H = Math.max(0.1, IQ_PARAMS.holdRate * (cost || 0));
  return Math.max(1, Math.ceil(Math.sqrt((2 * d * 365 * IQ_PARAMS.orderCost) / H)));
}

// Recompute planning demand, Pareto ABC (needs the whole catalog), safety stock,
// ROP, EOQ, max and status. Mutates and returns ps.
export function recomputeAll(ps) {
  ps.forEach((p) => { p.planDemand = Math.round(planDemand(p) * 100) / 100; });
  const val = (p) => p.planDemand * 365 * (p.sell || 0);
  const total = ps.reduce((s, p) => s + val(p), 0);
  let cum = 0;
  [...ps].sort((a, b) => val(b) - val(a)).forEach((p) => {
    const share = total > 0 ? cum / total : 1;
    cum += val(p);
    p.cls = /^[ABC]$/.test(p.clsManual) ? p.clsManual : share < IQ_PARAMS.abcCut[0] ? 'A' : share < IQ_PARAMS.abcCut[1] ? 'B' : 'C';
  });
  ps.forEach((p) => {
    const d = p.planDemand, L = leadOf(p), sigma = demandSigma(p, d);
    p.ss = Math.round(safetyStock(sigma, L, p.cls));
    p.rop = reorderPoint(d, sigma, L, p.cls);
    p.eoq = eoqOf(d, p.cost);
    p.max = Math.max(p.rop + p.eoq, p.stock || 0); // order-up-to level
    p.status = computeStatus(p);
  });
  return ps;
}

// ============================================================
// PRODUCT BUILDER — raw inputs; derived fields via recomputeAll
// ============================================================
export function buildProduct(input) {
  const stock = parseInt(input.stock) || 0;
  const product = {
    id: input.id || Date.now() + Math.floor(Math.random() * 1000),
    name: (input.name || '').trim(),
    ico: input.ico || '📦',
    stock,
    demand: parseInt(input.demand) || Math.max(1, Math.round(stock * 0.1)),
    cost: parseFloat(input.cost) || 0,
    sell: parseFloat(input.sell) || 0,
    lead: parseInt(input.lead) || 3,
    clsManual: input.cls && /^[ABC]$/i.test(input.cls) ? input.cls.toUpperCase() : '',
    supplier: (input.supplier || '').trim() || '—',
    phone: input.phone || '',
    incoming: 0,
    history: Array.isArray(input.history) ? input.history : [],
  };
  // ponytail: ABC of a lone product is 'A'; saveProducts re-ranks it against the catalog.
  return recomputeAll([product])[0];
}

// ============================================================
// STATUS & STOCK POSITION
// ============================================================
export const daysOfCover = (p) => (p.stock || 0) / Math.max(0.01, dOf(p));
// Units you can't sell if you order today: lead-time demand not covered by stock.
export const lostUnits = (p) => Math.max(0, dOf(p) * leadOf(p) - (p.stock || 0));
export const revenueAtRisk = (p) => Math.round(lostUnits(p) * (p.sell || 0));
export function computeStatus(p) {
  if (!p || !(dOf(p) > 0)) return 'good'; // no demand (or none known yet): nothing to reorder
  if (!(p.stock > 0) || lostUnits(p) > 0) return 'critical'; // runs out before a new order could arrive
  if (p.stock <= p.rop) return 'order';
  if (p.stock <= p.rop * IQ_PARAMS.watchBand) return 'watch';
  return 'good';
}

// ============================================================
// SALES LOG
// ============================================================
export async function loadSalesLog() {
  try {
    const raw = await AsyncStorage.getItem(KEYS.SALES);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// One sales save. Only entered products are logged — a partial entry must not declare
// zero sales for the rest (completeDay does that). Selling out or an empty shelf marks the
// day censored. Same as iqRecordDay.
export async function recordSales(qtyMap) {
  const products = await loadProducts();
  const lines = [], events = [];
  const today = localDay();
  const updated = products.map((p) => {
    if (!(num(qtyMap[p.id]) > 0)) return p;
    const sold = Math.min(num(qtyMap[p.id]), p.stock || 0);
    const stock = (p.stock || 0) - sold;
    if (sold > 0) lines.push({ id: p.id, name: p.name, qty: sold, revenue: sold * p.sell, profit: sold * (p.sell - p.cost) });
    events.push({ type: 'sale', day: today, pid: p.id, q: sold, cens: stock <= 0 ? 1 : 0 });
    return { ...p, stock, ...logDailySale(p, sold, today, stock <= 0) };
  });
  if (!lines.length) return null;
  if (!(await saveProducts(updated))) return null; // logged sales feed planning demand → ROP/EOQ/ABC
  await addEvents(events);
  const sum = (k) => lines.reduce((s, l) => s + l[k], 0);
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), // unique sale event id for sync
    date: new Date().toISOString(),
    items: lines.length,
    totalUnits: sum('qty'),
    totalRevenue: sum('revenue'),
    totalProfit: sum('profit'),
    lines,
  };
  const log = await loadSalesLog();
  log.push(entry);
  if (log.length > 365) log.splice(0, log.length - 365);
  await AsyncStorage.setItem(KEYS.SALES, JSON.stringify(log));
  return entry;
}

// "Finished entering today's sales": every product with no sale logged today gets a
// confirmed zero day (censored when it had no stock). Works on a day with no sales at all.
// Returns how many products got a zero day, or null if nothing could be saved. Same as iqCompleteDay.
export async function completeDay(today = localDay()) {
  const products = await loadProducts();
  let n = 0;
  const updated = products.map((p) => {
    if (p.histDay === today) return p;
    n++;
    return { ...p, ...logDailySale(p, 0, today, !(p.stock > 0)) };
  });
  if (!(await saveProducts(updated))) return null;
  await addEvents([{ type: 'close', day: today }]);
  return n;
}

// history[] = units per DAY (second save the same day adds to today's bucket);
// histCens[i] = 1 marks a sold-out / empty-shelf day, a lower bound on that day's demand.
// ponytail: days with no save at all are skipped, not zero-filled.
export function localDay(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
export function logDailySale(p, qty, today, censored = false) {
  const history = Array.isArray(p.history) ? [...p.history] : [];
  const cens = Array.isArray(p.histCens) && p.histCens.length === history.length ? [...p.histCens] : history.map(() => 0);
  if (p.histDay === today && history.length) {
    history[history.length - 1] += qty;
    if (censored) cens[cens.length - 1] = 1;
  } else {
    history.push(qty);
    cens.push(censored ? 1 : 0);
  }
  return { history: history.slice(-60), histCens: cens.slice(-60), histDay: today };
}

// ============================================================
// ORDERING — decide on inventory position (on hand + already ordered)
// ============================================================
export function needsAction(p) {
  return p.status !== 'good' && p.stock + (p.incoming || 0) <= p.rop * IQ_PARAMS.watchBand;
}
export const shouldOrder = (p) => p.rop > 0 && (p.stock || 0) + (p.incoming || 0) <= p.rop;
// How much to order: nothing while the position is above the reorder point; otherwise back up to ROP + EOQ.
export const orderQty = (p) =>
  shouldOrder(p) && p.eoq > 0 ? Math.ceil(p.rop + p.eoq - (p.stock || 0) - (p.incoming || 0)) : 0;

export async function markOrdered(id) {
  const p = (await loadProducts()).find((x) => x.id === id);
  const q = p && orderQty(p);
  if (!q) return null; // enough already on order
  const r = await updateProduct(id, { incoming: (p.incoming || 0) + q });
  if (r) await addEvents([{ type: 'order', pid: id, q }]);
  return r;
}

export async function receiveStock(id) {
  const p = (await loadProducts()).find((x) => x.id === id);
  if (!p || !p.incoming) return null;
  const stock = p.stock + p.incoming;
  const r = await updateProduct(id, { stock, incoming: 0 });
  if (r) await addEvents([{ type: 'receive', pid: id, q: p.incoming }]);
  return r;
}

// ============================================================
// FORECASTING — trend line + 7-day average, accuracy by backtest
// ============================================================
export function linReg(arr) {
  const n = arr.length;
  if (n < 2) return { slope: 0, intercept: arr[0] || 0, r2: 0 };
  let sx = 0,
    sy = 0,
    sxy = 0,
    sx2 = 0;
  arr.forEach((y, x) => {
    sx += x;
    sy += y;
    sxy += x * y;
    sx2 += x * x;
  });
  const slope = (n * sxy - sx * sy) / (n * sx2 - sx * sx) || 0;
  const intercept = (sy - slope * sx) / n;
  const ym = sy / n;
  const ssTot = arr.reduce((s, y) => s + (y - ym) ** 2, 0);
  const ssRes = arr.reduce(
    (s, y, x) => s + (y - (slope * x + intercept)) ** 2,
    0,
  );
  return {
    slope,
    intercept,
    r2: ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0,
  };
}

// Next-day forecast: 0.6 × trend + 0.4 × 7-day average; trend held within ±50% of the average.
function fcNext(h) {
  const n = h.length, ma = mean(h.slice(-7));
  if (n < 4) return ma;
  const reg = linReg(h);
  const lin = Math.min(Math.max(reg.intercept + reg.slope * n, ma * 0.5), ma * 1.5);
  return 0.6 * lin + 0.4 * ma;
}

// Runs on the censor-imputed history (a sold-out day counts as at least the planning demand).
// accuracy = 1 − WAPE when the last (up to) 7 logged days are forecast from the days
// before them, scoring only uncensored days; null under 3 scored. r2 (0–100) is trend fit, not accuracy.
export function forecastProduct(p) {
  const raw = Array.isArray(p.history) ? p.history : [];
  const c = Array.isArray(p.histCens) ? p.histCens : [];
  const n = raw.length, d = dOf(p);
  if (n < 2) return { forecast: Math.round(d), ci: Math.round(1.645 * demandSigma(p, d)), trend: 'flat', trendPct: 0, accuracy: null, r2: 0, ma7: Math.round(d), n };
  const h = raw.map((x, i) => (c[i] ? Math.max(x, d) : x));
  const k = Math.min(7, n - 4);
  let err = 0, sq = 0, act = 0, m = 0;
  for (let t = n - k; t < n; t++) {
    if (c[t]) continue;
    const e = h[t] - fcNext(h.slice(0, t));
    err += Math.abs(e);
    sq += e * e;
    act += h[t];
    m++;
  }
  const reg = linReg(h), ma7 = mean(h.slice(-7));
  const pct = ma7 > 0 ? Math.round((reg.slope * 7 / ma7) * 100) : 0;
  return {
    forecast: Math.max(0, Math.round(fcNext(h))),
    ci: Math.round(1.645 * (m >= 3 ? Math.sqrt(sq / m) : demandSigma(p, d))),
    trend: pct >= 5 ? 'up' : pct <= -5 ? 'down' : 'flat',
    trendPct: Math.abs(pct),
    accuracy: m >= 3 && act > 0 ? Math.max(0, Math.round((1 - err / act) * 100)) : null,
    r2: Math.round(reg.r2 * 100),
    ma7: Math.round(ma7),
    n,
  };
}

// ============================================================
// AGGREGATES — for Home and Dashboard
// ============================================================
export function aggregateKPIs(products) {
  if (!products.length) {
    return {
      monthlyRevenue: 0,
      monthlyProfit: 0,
      stockValue: 0,
      lowStockCount: 0,
      goodCount: 0,
      watchCount: 0,
      criticalCount: 0,
      healthPct: 0,
    };
  }
  const monthlyRevenue = products.reduce((s, p) => s + p.sell * dOf(p) * 30, 0);
  const monthlyProfit = products.reduce(
    (s, p) => s + (p.sell - p.cost) * dOf(p) * 30,
    0,
  );
  const stockValue = products.reduce((s, p) => s + p.stock * p.cost, 0);
  const goodCount = products.filter((p) => p.status === 'good').length;
  const watchCount = products.filter((p) => p.status === 'watch').length;
  const criticalCount = products.filter(
    (p) => p.status === 'critical' || p.status === 'order',
  ).length;
  const lowStockCount = watchCount + criticalCount;
  const healthPct = Math.round((goodCount / products.length) * 100);
  return {
    monthlyRevenue,
    monthlyProfit,
    stockValue,
    lowStockCount,
    goodCount,
    watchCount,
    criticalCount,
    healthPct,
  };
}

// ============================================================
// DEMO DATA
// ============================================================
export const DEMO_PRODUCTS = [
  { id: 1, name: 'Aashirvaad Atta 5kg', ico: '🌾', stock: 12, max: 200, rop: 30, eoq: 88, demand: 12, cost: 285, sell: 320, lead: 3, cls: 'A', supplier: 'ITC Distributor', phone: '98765 43210', incoming: 0, history: [9,14,11,13,15,10,14,13,15,16,14,18] },
  { id: 2, name: "Lay's Chips 26g", ico: '🍟', stock: 14, max: 250, rop: 83, eoq: 423, demand: 28, cost: 20, sell: 30, lead: 2, cls: 'A', supplier: 'PepsiCo Dist.', phone: '98712 34560', incoming: 200, history: [22,25,28,30,26,29,32,28,31,33,30,34] },
  { id: 3, name: 'Colgate Toothpaste', ico: '🪥', stock: 25, max: 100, rop: 35, eoq: 118, demand: 8, cost: 95, sell: 125, lead: 3, cls: 'A', supplier: 'Colgate Rep.', phone: '', incoming: 0, history: [7,9,8,6,9,8,7,8,9,7,8,9] },
  { id: 4, name: 'Lifebuoy Handwash', ico: '🧴', stock: 22, max: 80, rop: 28, eoq: 95, demand: 6, cost: 110, sell: 145, lead: 3, cls: 'A', supplier: 'HUL Dist.', phone: '', incoming: 48, history: [5,7,6,5,7,6,5,6,7,6,5,7] },
  { id: 5, name: 'Lux Soap', ico: '🧼', stock: 32, max: 100, rop: 41, eoq: 242, demand: 14, cost: 35, sell: 50, lead: 2, cls: 'B', supplier: 'HUL Dist.', phone: '', incoming: 0, history: [13,15,14,12,15,14,13,14,15,13,14,15] },
  { id: 6, name: 'Tata Salt 1kg', ico: '🧂', stock: 55, max: 120, rop: 49, eoq: 300, demand: 18, cost: 22, sell: 28, lead: 2, cls: 'B', supplier: 'Tata Consumer', phone: '', incoming: 0, history: [15,16,17,17,18,18,19,19,20,20,21,22] },
  { id: 7, name: 'Parle-G 100g', ico: '🍪', stock: 80, max: 200, rop: 53, eoq: 566, demand: 35, cost: 10, sell: 14, lead: 1, cls: 'C', supplier: 'Parle Products', phone: '', incoming: 0, history: [33,37,34,36,38,34,35,33,37,36,34,38] },
  { id: 8, name: 'Fortune Rice 1kg', ico: '🍚', stock: 60, max: 180, rop: 66, eoq: 223, demand: 22, cost: 65, sell: 80, lead: 2, cls: 'A', supplier: 'Adani Wilmar', phone: '', incoming: 0, history: [18,20,22,25,28,22,19,21,24,26,22,20] },
  { id: 9, name: 'Maggi Noodles 70g', ico: '🍜', stock: 50, max: 160, rop: 63, eoq: 396, demand: 20, cost: 14, sell: 20, lead: 2, cls: 'C', supplier: 'Nestle Dist.', phone: '', incoming: 96, history: [17,18,19,19,20,20,21,21,22,22,23,24] },
  { id: 10, name: 'Haldiram Namkeen', ico: '🥨', stock: 45, max: 160, rop: 67, eoq: 217, demand: 16, cost: 75, sell: 100, lead: 3, cls: 'A', supplier: 'Haldiram Dist.', phone: '', incoming: 0, history: [15,17,14,16,18,15,16,14,17,16,15,18] },
  { id: 11, name: 'Dettol Soap', ico: '🫧', stock: 22, max: 90, rop: 30, eoq: 181, demand: 10, cost: 45, sell: 65, lead: 2, cls: 'B', supplier: 'Reckitt Dist.', phone: '', incoming: 0, history: [9,11,10,9,11,10,9,10,11,9,10,11] },
  { id: 12, name: 'Shampoo Sachet', ico: '💆', stock: 120, max: 350, rop: 63, eoq: 907, demand: 45, cost: 4, sell: 6, lead: 1, cls: 'C', supplier: 'Local Wholesale', phone: '', incoming: 350, history: [36,40,45,52,58,46,38,42,48,54,46,37] },
];

export async function loadDemo() {
  const copy = JSON.parse(JSON.stringify(DEMO_PRODUCTS));
  await saveProducts(copy); // recomputes ROP/EOQ/ABC/status
  return copy;
}

// ============================================================
// CLEAR ALL
// ============================================================
export async function clearAllData() {
  const preserveDeviceId = await AsyncStorage.getItem(KEYS.DEVICE);
  const keysToClear = [
    KEYS.PRODS,
    KEYS.PRODS + '_ts',
    KEYS.SALES,
    KEYS.DISMISSED,
    KEYS.SYNC_HIST,
    KEYS.CLOUD,
    KEYS.LAST_SYNC,
    KEYS.EVENTS,
  ];
  await AsyncStorage.multiRemove(keysToClear);
  if (preserveDeviceId) {
    await AsyncStorage.setItem(KEYS.DEVICE, preserveDeviceId);
  }
}

// ============================================================
// SYNC HISTORY (for undo)
// ============================================================
export async function pushSyncSnapshot() {
  const products = await loadProducts();
  if (!products.length) return null;
  const raw = await AsyncStorage.getItem(KEYS.SYNC_HIST);
  const hist = raw ? JSON.parse(raw) : [];
  hist.push({
    ts: new Date().toISOString(),
    count: products.length,
    snapshot: JSON.parse(JSON.stringify(products)),
  });
  while (hist.length > 5) hist.shift();
  await AsyncStorage.setItem(KEYS.SYNC_HIST, JSON.stringify(hist));
  return hist;
}

export async function loadSyncHistory() {
  const raw = await AsyncStorage.getItem(KEYS.SYNC_HIST);
  return raw ? JSON.parse(raw) : [];
}

export async function restoreSnapshot(idx) {
  const hist = await loadSyncHistory();
  if (!hist[idx] || !hist[idx].snapshot) return null;
  const restored = hist[idx].snapshot.map((p) => ({ ...p }));
  await saveProducts(restored); // recomputes derived fields
  return restored;
}
