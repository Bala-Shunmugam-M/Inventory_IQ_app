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
    const r = () => Math.random().toString(36).slice(2, 7).toUpperCase();
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
    return arr.map((p) => ({ ...p, status: computeStatus(p) }));
  } catch (e) {
    console.warn('loadProducts failed', e);
    return [];
  }
}

export async function saveProducts(products) {
  try {
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
  // Re-derive computed fields if inputs changed
  if (patch.demand != null || patch.lead != null || patch.cost != null) {
    const recomputed = recomputeFormulas(merged);
    Object.assign(merged, recomputed);
  }
  merged.status = computeStatus(merged);
  products[idx] = merged;
  await saveProducts(products);
  return merged;
}

export async function deleteProduct(id) {
  const products = await loadProducts();
  const filtered = products.filter((p) => p.id !== id);
  await saveProducts(filtered);
  return filtered;
}

// ============================================================
// PRODUCT BUILDER — auto-computes ROP, EOQ, ABC class, status
// ============================================================
export function buildProduct(input) {
  const stock = parseInt(input.stock) || 0;
  const demand =
    parseInt(input.demand) || Math.max(1, Math.round(stock * 0.1));
  const cost = parseFloat(input.cost) || 0;
  const sell = parseFloat(input.sell) || 0;
  const lead = parseInt(input.lead) || 3;

  const rop = Math.max(1, Math.ceil(demand * lead * 1.3));
  // EOQ = sqrt(2 * D * S / H)  with S=50 setup, H=20% of cost holding
  const D = demand * 365;
  const S = 50;
  const H = Math.max(0.1, cost * 0.2);
  const eoq = Math.max(1, Math.ceil(Math.sqrt((2 * D * S) / H)));

  // ABC class by daily revenue contribution
  const revPerDay = sell * demand;
  const cls =
    input.cls && /^[ABC]$/i.test(input.cls)
      ? input.cls.toUpperCase()
      : revPerDay > 500
      ? 'A'
      : revPerDay > 100
      ? 'B'
      : 'C';

  const product = {
    id: input.id || Date.now() + Math.floor(Math.random() * 1000),
    name: (input.name || '').trim(),
    ico: input.ico || '📦',
    stock,
    max: Math.max(stock * 2, rop * 3, 100),
    rop,
    eoq,
    demand,
    cost,
    sell,
    lead,
    cls,
    supplier: (input.supplier || '').trim() || '—',
    phone: input.phone || '',
    incoming: 0,
    history: Array.isArray(input.history) ? input.history : [],
  };
  product.status = computeStatus(product);
  return product;
}

function recomputeFormulas(p) {
  const demand = Math.max(1, p.demand || 1);
  const lead = p.lead || 3;
  const cost = p.cost || 0;
  const rop = Math.max(1, Math.ceil(demand * lead * 1.3));
  const D = demand * 365;
  const S = 50;
  const H = Math.max(0.1, cost * 0.2);
  const eoq = Math.max(1, Math.ceil(Math.sqrt((2 * D * S) / H)));
  const max = Math.max(p.max || 100, p.stock * 2, rop * 3, 100);
  return { rop, eoq, max };
}

// ============================================================
// STATUS LOGIC
// ============================================================
export function computeStatus(p) {
  if (!p) return 'good';
  if (p.stock === 0) return 'critical';
  if (p.stock <= p.rop * 0.5) return 'critical';
  if (p.stock <= p.rop) return 'order';
  if (p.stock <= p.rop * 1.4) return 'watch';
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
    const history = Array.isArray(p.history) ? [...p.history, sold] : [sold];
    if (history.length > 60) history.splice(0, history.length - 60);
    const next = { ...p, stock: Math.max(0, p.stock - sold), history };
    next.status = computeStatus(next);
    return next;
  });
  await saveProducts(updated);
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

// ============================================================
// FORECASTING — Linear regression + 7-day MA blend
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

export function forecastProduct(p) {
  const hist = Array.isArray(p.history) && p.history.length
    ? p.history
    : [p.demand || 0];
  const n = hist.length;
  const reg = linReg(hist);
  const ma7 =
    hist.slice(-7).reduce((a, b) => a + b, 0) / Math.min(7, n || 1);
  const nextV = reg.intercept + reg.slope * n;
  let forecast = n < 2 ? p.demand || 0 : Math.max(0, Math.round(nextV * 0.6 + ma7 * 0.4));
  const resid = hist.map((y, x) => y - (reg.slope * x + reg.intercept));
  const stdErr =
    n >= 2
      ? Math.sqrt(resid.reduce((s, r) => s + r * r, 0) / Math.max(1, n - 2))
      : 0;
  const ci = Math.max(1, Math.round(1.65 * stdErr));
  const trend = reg.slope > 0.3 ? 'up' : reg.slope < -0.3 ? 'down' : 'flat';
  const trendPct = Math.abs(Math.round((reg.slope * 100) / (ma7 || 1)));
  return {
    forecast,
    ci,
    trend,
    trendPct,
    r2: reg.r2,
    accuracy: Math.round(reg.r2 * 100),
    ma7: Math.round(ma7),
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
  const monthlyRevenue = products.reduce((s, p) => s + p.sell * p.demand * 30, 0);
  const monthlyProfit = products.reduce(
    (s, p) => s + (p.sell - p.cost) * p.demand * 30,
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
  copy.forEach((p) => (p.status = computeStatus(p)));
  await saveProducts(copy);
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
  const restored = hist[idx].snapshot.map((p) => ({
    ...p,
    status: computeStatus(p),
  }));
  await saveProducts(restored);
  return restored;
}
