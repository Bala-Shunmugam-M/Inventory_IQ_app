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
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export const KEYS = {
  PRODS: 'inventoryiq_v8_data',
  SALES: 'inventoryiq_v8_sales',
  DISMISSED: 'inventoryiq_v8_dismissed',
  SYNC_HIST: 'inventoryiq_v8_synchist',
  DEVICE: 'iq_device_id',
  CLOUD: 'iq_cloud_snapshot',
  LAST_SYNC: 'iq_last_sync',
  ONBOARDED: 'iq_onboarded',
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
export async function loadProducts() {
  try {
    const raw = await AsyncStorage.getItem(KEYS.PRODS);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return recomputeAll(arr.filter((p) => p && typeof p === 'object'));
  } catch (e) {
    console.warn('loadProducts failed', e);
    return [];
  }
}

// Derived fields (ROP, EOQ, ABC, max, status) are recomputed for the whole catalog on every save.
export async function saveProducts(products) {
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
  await saveProducts(products);
  return newP;
}

export async function updateProduct(id, patch) {
  const products = await loadProducts();
  const idx = products.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const merged = { ...products[idx], ...patch };
  products[idx] = merged;
  await saveProducts(products); // recomputes merged's ROP/EOQ/ABC/status in place
  return merged;
}

export async function deleteProduct(id) {
  const products = await loadProducts();
  const filtered = products.filter((p) => p.id !== id);
  await saveProducts(filtered);
  return filtered;
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
  minHistory: 7, // logged days before sales fully replace the typed daily demand
  window: 14, // most recent logged days used for the planning demand and its variability
  abcCut: [0.8, 0.95], // ABC: first 80% of annual revenue = A, next 15% = B, rest = C
  watchBand: 1.4, // "watch" while stock is less than 40% above the reorder point
  defaultLead: 3, // days
};

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
export const leadOf = (p) => (p.lead > 0 ? p.lead : IQ_PARAMS.defaultLead);

// Planning demand (units/day): average of recent logged sales, blended with the
// typed estimate until there are minHistory days of history.
export function planDemand(p) {
  const h = Array.isArray(p.history) ? p.history : [];
  const typed = Math.max(0, Number(p.demand) || 0);
  if (!h.length) return typed;
  const w = typed ? Math.min(1, h.length / IQ_PARAMS.minHistory) : 1;
  return w * mean(h.slice(-IQ_PARAMS.window)) + (1 - w) * typed;
}
const dOf = (p) => (typeof p.planDemand === 'number' ? p.planDemand : planDemand(p));

// σ of daily demand; cvFallback on short history, never below √mean.
export function demandSigma(p, d) {
  const h = Array.isArray(p.history) ? p.history.slice(-IQ_PARAMS.window) : [];
  if (h.length < IQ_PARAMS.minHistory) return IQ_PARAMS.cvFallback * d;
  const m = mean(h);
  const sd = Math.sqrt(h.reduce((s, x) => s + (x - m) ** 2, 0) / (h.length - 1));
  return Math.max(sd, Math.sqrt(d));
}
// Safety stock = z × σ × √L ; ROP = d × L + safety stock.
export const safetyStock = (sigma, lead, cls) => (IQ_PARAMS.z[cls] || IQ_PARAMS.z.C) * sigma * Math.sqrt(lead);
export const reorderPoint = (d, sigma, lead, cls) => Math.max(1, Math.ceil(d * lead + safetyStock(sigma, lead, cls)));
// EOQ = √(2·D·S / H): D = annual demand (units/yr), S = ₹/order, H = ₹ to hold one unit a year.
export function eoqOf(d, cost) {
  const H = Math.max(0.1, IQ_PARAMS.holdRate * (cost || 0));
  return Math.max(1, Math.ceil(Math.sqrt((2 * d * 365 * IQ_PARAMS.orderCost) / H)));
}

// Recompute planning demand, Pareto ABC (needs the whole catalog), safety stock,
// ROP, EOQ, max and status. Mutates and returns ps.
export function recomputeAll(ps) {
  ps.forEach((p) => { p.planDemand = Math.round(planDemand(p) * 10) / 10; });
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
  if (!p) return 'good';
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

export async function recordSales(qtyMap) {
  // qtyMap = { [productId]: unitsSold }
  const products = await loadProducts();
  let totalUnits = 0,
    totalRevenue = 0,
    totalProfit = 0;
  const lines = [];
  const today = localDay();
  const updated = products.map((p) => {
    const q = qtyMap[p.id] || 0;
    if (q <= 0) return p;
    const sold = Math.min(q, p.stock);
    totalUnits += sold;
    totalRevenue += sold * p.sell;
    totalProfit += sold * (p.sell - p.cost);
    lines.push({
      id: p.id,
      name: p.name,
      qty: sold,
      revenue: sold * p.sell,
      profit: sold * (p.sell - p.cost),
    });
    return { ...p, stock: Math.max(0, p.stock - sold), ...logDailySale(p, sold, today) };
  });
  await saveProducts(updated); // logged sales feed planning demand → ROP/EOQ/ABC
  if (lines.length === 0) return null;

  const entry = {
    date: new Date().toISOString(),
    items: lines.length,
    totalUnits,
    totalRevenue,
    totalProfit,
    lines,
  };
  const log = await loadSalesLog();
  log.push(entry);
  if (log.length > 365) log.splice(0, log.length - 365);
  await AsyncStorage.setItem(KEYS.SALES, JSON.stringify(log));
  return entry;
}

// history[] feeds the forecast as units per DAY, so a second save on the same
// day adds to today's bucket instead of looking like a new day.
// ponytail: unlogged days are skipped, not zero-filled — a forgotten entry shouldn't read as zero demand.
export function localDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function logDailySale(p, qty, today) {
  const history = Array.isArray(p.history) ? [...p.history] : [];
  if (p.histDay === today && history.length) history[history.length - 1] += qty;
  else history.push(qty);
  return { history: history.slice(-60), histDay: today };
}

// ============================================================
// ORDERING — decide on inventory position (on hand + already ordered)
// ============================================================
export function needsAction(p) {
  return p.status !== 'good' && p.stock + (p.incoming || 0) <= p.rop * IQ_PARAMS.watchBand;
}
export const shouldOrder = (p) => p.stock + (p.incoming || 0) <= p.rop;
// How much to order: back up to ROP + EOQ from the current position, never less than one EOQ.
export const orderQty = (p) =>
  Math.max(p.eoq || 1, Math.ceil((p.rop || 0) + (p.eoq || 0) - p.stock - (p.incoming || 0)));

export async function markOrdered(id) {
  const p = (await loadProducts()).find((x) => x.id === id);
  if (!p) return null;
  return updateProduct(id, { incoming: (p.incoming || 0) + orderQty(p) });
}

export async function receiveStock(id) {
  const p = (await loadProducts()).find((x) => x.id === id);
  if (!p || !p.incoming) return null;
  const stock = p.stock + p.incoming;
  return updateProduct(id, { stock, incoming: 0 });
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

// accuracy = 1 − WAPE when the last (up to) 7 logged days are forecast from the days
// before them; null until 7 days. r2 (0–100) is trend fit, not accuracy.
export function forecastProduct(p) {
  const h = Array.isArray(p.history) ? p.history : [];
  const n = h.length, d = dOf(p);
  if (n < 2) return { forecast: Math.round(d), ci: Math.round(1.645 * demandSigma(p, d)), trend: 'flat', trendPct: 0, accuracy: null, r2: 0, ma7: Math.round(d), n };
  const k = Math.min(7, n - 4);
  let err = 0, sq = 0, act = 0;
  for (let t = n - k; t < n; t++) {
    const e = h[t] - fcNext(h.slice(0, t));
    err += Math.abs(e);
    sq += e * e;
    act += h[t];
  }
  const reg = linReg(h), ma7 = mean(h.slice(-7));
  const pct = ma7 > 0 ? Math.round((reg.slope * 7 / ma7) * 100) : 0;
  return {
    forecast: Math.max(0, Math.round(fcNext(h))),
    ci: Math.round(1.645 * (k >= 3 ? Math.sqrt(sq / k) : demandSigma(p, d))),
    trend: pct >= 5 ? 'up' : pct <= -5 ? 'down' : 'flat',
    trendPct: Math.abs(pct),
    accuracy: k >= 3 && act > 0 ? Math.max(0, Math.round((1 - err / act) * 100)) : null,
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
