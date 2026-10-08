/**
 * InventoryIQ — Cloud Sync Client (talks to backend/, the Cloudflare Worker + D1).
 *
 * A store is { storeId, token } issued by POST /api/stores on first sync.
 * Another device joins with the link code `iq1:<storeId>:<token>` — treat it
 * like a password. Saves are versioned: if another device saved first the
 * server answers 409, we merge and retry once.
 *
 * If API_BASE is empty, sync falls back to a local snapshot so the app is
 * fully usable offline / unconfigured.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { KEYS, loadProducts, saveProducts, loadSalesLog, pushSyncSnapshot, computeStatus } from './storage';

// Your deployed backend URL, e.g. 'https://inventoryiq-llm-proxy.<you>.workers.dev'
export const API_BASE = '';
const STORE_KEY = 'iq_store';

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

async function getStore() {
  const raw = await AsyncStorage.getItem(STORE_KEY);
  return raw ? JSON.parse(raw) : null;
}
const setStore = (s) => AsyncStorage.setItem(STORE_KEY, JSON.stringify(s));

export async function getLinkCode() {
  const s = await getStore();
  return s ? `iq1:${s.storeId}:${s.token}` : null;
}

// Union by product id (this device wins on clashes) and by sale timestamp.
// ponytail: whole-product last-writer-wins; field-level merge if two devices edit the same product often.
export function mergeSnapshots(local, remote) {
  const byId = new Map(remote.products.map((p) => [p.id, p]));
  local.products.forEach((p) => byId.set(p.id, p));
  const seen = new Set();
  const sales = [...remote.sales, ...local.sales]
    .filter((e) => e && !seen.has(e.date) && seen.add(e.date))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-365);
  return { products: [...byId.values()], sales };
}

async function applyRemote(products, sales) {
  await saveProducts(products.map((p) => ({ ...p, status: computeStatus(p) })));
  await AsyncStorage.setItem(KEYS.SALES, JSON.stringify(sales || []));
}

// ============================================================
// PUSH
// ============================================================
export async function syncToCloud() {
  const products = await loadProducts();
  if (!products.length) return { ok: false, reason: 'No products to sync' };
  await pushSyncSnapshot(); // powers Undo Last Sync
  const sales = await loadSalesLog();

  if (!isConfigured()) {
    await AsyncStorage.setItem(KEYS.CLOUD, JSON.stringify({ data: products, sales, timestamp: Date.now() }));
    await AsyncStorage.setItem(KEYS.LAST_SYNC, Date.now().toString());
    return { ok: true, mode: 'local', count: products.length };
  }

  try {
    let store = await getStore();
    if (!store) {
      const r = await api('POST', '/api/stores');
      if (r.status !== 201) return { ok: false, reason: r.data.error || `Server ${r.status}` };
      store = { ...r.data, version: 0 };
      await setStore(store);
    }
    const path = `/api/stores/${store.storeId}/snapshot`;
    let payload = { products, sales };
    let r = await api('PUT', path, { token: store.token, body: { baseVersion: store.version, ...payload } });
    if (r.status === 409) {
      const remote = await api('GET', path, { token: store.token });
      if (remote.status !== 200) return { ok: false, reason: remote.data.error || `Server ${remote.status}` };
      payload = mergeSnapshots(payload, remote.data);
      r = await api('PUT', path, { token: store.token, body: { baseVersion: remote.data.version, ...payload } });
      if (r.status === 200) await applyRemote(payload.products, payload.sales);
    }
    if (r.status !== 200) return { ok: false, reason: r.data.error || `Server ${r.status}` };
    await setStore({ ...store, version: r.data.version });
    await AsyncStorage.setItem(KEYS.LAST_SYNC, Date.now().toString());
    return { ok: true, mode: 'cloud', count: payload.products.length };
  } catch (e) {
    return { ok: false, reason: 'Network error — ' + e.message };
  }
}

// ============================================================
// PULL — this store's latest, or join another store via its link code
// ============================================================
export async function restoreFromCloud(linkCode) {
  if (!isConfigured()) {
    const raw = await AsyncStorage.getItem(KEYS.CLOUD);
    if (!raw) return { ok: false, reason: 'No local snapshot found' };
    const snap = JSON.parse(raw);
    await applyRemote(snap.data || [], snap.sales);
    return { ok: true, mode: 'local', count: (snap.data || []).length, timestamp: snap.timestamp };
  }

  let store = await getStore();
  const code = (linkCode || '').trim();
  if (code) {
    const [tag, storeId, token] = code.split(':');
    if (tag !== 'iq1' || !storeId || !token) return { ok: false, reason: 'Invalid link code' };
    store = { storeId, token, version: 0 };
  }
  if (!store) return { ok: false, reason: 'This device has not synced yet — enter a link code' };

  try {
    const r = await api('GET', `/api/stores/${store.storeId}/snapshot`, { token: store.token });
    if (r.status === 401) return { ok: false, reason: 'Link code not recognised' };
    if (r.status !== 200) return { ok: false, reason: r.data.error || `Server ${r.status}` };
    if (!r.data.version) return { ok: false, reason: 'Nothing saved to this store yet' };
    await applyRemote(r.data.products, r.data.sales);
    await setStore({ ...store, version: r.data.version });
    return { ok: true, mode: 'cloud', count: r.data.products.length, timestamp: r.data.updatedAt };
  } catch (e) {
    return { ok: false, reason: 'Network error — ' + e.message };
  }
}

export async function getLastSyncTime() {
  const t = await AsyncStorage.getItem(KEYS.LAST_SYNC);
  return t ? parseInt(t) : null;
}
