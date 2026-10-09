/**
 * InventoryIQ — Cloud Sync Client (talks to backend/, the Cloudflare Worker + D1).
 *
 * A store is { storeId, token } issued by POST /api/stores on first sync.
 * Another device joins with the link code `iq1:<storeId>:<token>` — treat it
 * like a password. 'iq_sync_base' keeps the last synced snapshot + version; if
 * another device saved first the server answers 409 and we do a three-way merge
 * against that base (same rules as iqMerge3 in docs/iq-core.js), then retry once.
 *
 * If API_BASE is empty, sync falls back to a local snapshot so the app is
 * fully usable offline / unconfigured.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { KEYS, loadProducts, saveProducts, loadSalesLog, pushSyncSnapshot, normalize, num, SYNC } from './storage';

// Your deployed backend URL, e.g. 'https://inventoryiq-llm-proxy.<you>.workers.dev'
export const API_BASE = '';
const STORE_KEY = 'iq_store';
const BASE_KEY = 'iq_sync_base';

export const isConfigured = () => !!API_BASE;

async function api(method, path, { token, body } = {}) {
  const res = await fetch(API_BASE.replace(/\/$/, '') + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
const fail = (r) => ({ ok: false, reason: r.status === 401 ? 'Link code not recognised' : r.data.error || `Server ${r.status}` });

async function getJSON(key) {
  const raw = await AsyncStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}
const setJSON = (key, v) => AsyncStorage.setItem(key, JSON.stringify(v));

export async function getLinkCode() {
  const s = await getJSON(STORE_KEY);
  return s ? `iq1:${s.storeId}:${s.token}` : null;
}

// ---- three-way merge (mirror of iqMerge3 / iqMergeSales in docs/iq-core.js) ----
const DERIVED = new Set(['status', 'planDemand', 'ss', 'rop', 'eoq', 'max', 'cls']);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameProduct = (a, b) => {
  const strip = (p) => Object.fromEntries(Object.keys(p).sort().filter((k) => !DERIVED.has(k)).map((k) => [k, p[k]]));
  return same(strip(a), strip(b));
};
// Unchanged on one side → take the other (adds, edits, deletes); delete vs edit → keep the edit;
// edited on both → stock/incoming add both sides' changes, history from the later logger,
// other fields: local where local changed, else remote.
// ponytail: same-day sales logged on both devices undercount that day in history; stock is exact.
export function mergeProducts(base, local, remote) {
  [base, local, remote] = [base, local, remote].map((l) => l.map(normalize));
  const B = new Map(base.map((p) => [p.id, p]));
  const L = new Map(local.map((p) => [p.id, p]));
  const R = new Map(remote.map((p) => [p.id, p]));
  const ids = [...new Set([...L.keys(), ...R.keys()])];
  const out = [];
  for (const id of ids) {
    const b = B.get(id), l = L.get(id), r = R.get(id);
    if (!b) { out.push(l || r); continue; }
    if (!l) { if (r && !sameProduct(r, b)) out.push(r); continue; }
    if (!r) { if (!sameProduct(l, b)) out.push(l); continue; }
    if (sameProduct(l, b)) { out.push(r); continue; }
    if (sameProduct(r, b)) { out.push(l); continue; }
    const m = { ...r };
    for (const k of Object.keys(l)) if (!DERIVED.has(k) && !same(l[k], b[k])) m[k] = l[k];
    for (const k of ['stock', 'incoming']) m[k] = Math.max(0, num(b[k]) + (num(l[k]) - num(b[k])) + (num(r[k]) - num(b[k])));
    const src = String(l.histDay || '') >= String(r.histDay || '') ? l : r;
    for (const k of ['history', 'histCens', 'histDay']) m[k] = src[k];
    out.push(m);
  }
  return out;
}
export function mergeSales(local, remote) {
  const seen = new Set();
  const key = (e) => e.id || `${e.date}:${e.totalUnits}`;
  return [...remote, ...local]
    .filter((e) => e && !seen.has(key(e)) && seen.add(key(e)))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-365);
}

// Writes products + sales locally; throws if the products didn't persist, so a sync or
// restore never reports success (or advances the version) on a failed write.
async function applyLocal(products, sales) {
  if (!(await saveProducts(products, { fromSync: true }))) throw new Error('Could not save on this device');
  await AsyncStorage.setItem(KEYS.SALES, JSON.stringify(sales || []));
}

// ============================================================
// PUSH
// ============================================================
export async function syncToCloud() {
  if (SYNC.busy) return { ok: false, reason: 'A sync is already running' };
  const products = await loadProducts();
  const store0 = await getJSON(STORE_KEY);
  if (!products.length && !store0) return { ok: false, reason: 'No products to sync' };
  await pushSyncSnapshot(); // powers Undo Last Sync
  const sales = await loadSalesLog();

  if (!isConfigured()) {
    await AsyncStorage.setItem(KEYS.CLOUD, JSON.stringify({ data: products, sales, timestamp: Date.now() }));
    await AsyncStorage.setItem(KEYS.LAST_SYNC, Date.now().toString());
    return { ok: true, mode: 'local', count: products.length };
  }

  SYNC.busy = true; // saves are refused until we finish, so nothing lands between capture and apply
  try {
    let store = store0;
    let base = (await getJSON(BASE_KEY)) || { version: 0, products: [], sales: [] };
    if (!store) {
      const r = await api('POST', '/api/stores');
      if (r.status !== 201) return fail(r);
      store = r.data;
      base = { version: 0, products: [], sales: [] };
      await setJSON(STORE_KEY, store);
    }
    const path = `/api/stores/${store.storeId}/snapshot`;
    let out = { products, sales };
    let r = await api('PUT', path, { token: store.token, body: { baseVersion: base.version, ...out } });
    let merged = false;
    if (r.status === 409) {
      const g = await api('GET', path, { token: store.token });
      if (g.status !== 200) return fail(g);
      out = { products: mergeProducts(base.products, products, g.data.products || []), sales: mergeSales(sales, g.data.sales || []) };
      merged = true;
      r = await api('PUT', path, { token: store.token, body: { baseVersion: g.data.version, ...out } });
    }
    if (r.status !== 200) return fail(r);
    if (merged) await applyLocal(out.products, out.sales);
    await setJSON(BASE_KEY, { version: r.data.version, products: out.products, sales: out.sales });
    await AsyncStorage.setItem(KEYS.LAST_SYNC, Date.now().toString());
    return { ok: true, mode: 'cloud', merged, count: out.products.length };
  } catch (e) {
    return { ok: false, reason: e.message };
  } finally {
    SYNC.busy = false;
  }
}

// ============================================================
// PULL — this store's latest, or join another store via its link code
// ============================================================
export async function restoreFromCloud(linkCode) {
  if (!isConfigured()) {
    const snap = await getJSON(KEYS.CLOUD);
    if (!snap) return { ok: false, reason: 'No local snapshot found' };
    try {
      await applyLocal((snap.data || []).map(normalize), snap.sales);
    } catch (e) {
      return { ok: false, reason: e.message };
    }
    return { ok: true, mode: 'local', count: (snap.data || []).length, timestamp: snap.timestamp };
  }

  let store = await getJSON(STORE_KEY);
  const code = (linkCode || '').trim();
  if (code) {
    const [tag, storeId, token] = code.split(':');
    if (tag !== 'iq1' || !storeId || !token) return { ok: false, reason: 'Invalid link code' };
    store = { storeId, token };
  }
  if (!store) return { ok: false, reason: 'This device has not synced yet — enter a link code' };

  try {
    const r = await api('GET', `/api/stores/${store.storeId}/snapshot`, { token: store.token });
    if (r.status !== 200) return fail(r);
    if (!r.data.version) return { ok: false, reason: 'Nothing saved to this store yet' };
    const products = (r.data.products || []).map(normalize);
    await applyLocal(products, r.data.sales); // throws before we link to the store if it can't persist
    await setJSON(STORE_KEY, store);
    await setJSON(BASE_KEY, { version: r.data.version, products, sales: r.data.sales || [] });
    return { ok: true, mode: 'cloud', count: products.length, timestamp: r.data.updatedAt };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

export async function getLastSyncTime() {
  const t = await AsyncStorage.getItem(KEYS.LAST_SYNC);
  return t ? parseInt(t) : null;
}
