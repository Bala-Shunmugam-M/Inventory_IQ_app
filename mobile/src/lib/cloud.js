/**
 * InventoryIQ — Cloud Sync Client (talks to backend/, the Cloudflare Worker + D1).
 *
 * A store is { storeId, token } issued by POST /api/stores on first sync.
 * Another device joins with the link code `iq1:<storeId>:<token>` — treat it
 * like a password. 'iq_sync_base' keeps the last synced snapshot + version; if
 * another device saved first the server answers 409 and we merge against that base
 * (same rules as iqMergeSnap in docs/iq-core.js: field-level three-way merge, then
 * stock/incoming/history rebuilt by replaying the event log), then retry once.
 *
 * If API_BASE is empty, sync falls back to a local snapshot so the app is
 * fully usable offline / unconfigured.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { KEYS, loadProducts, saveProducts, loadSalesLog, pushSyncSnapshot, normalize, num, SYNC, loadEvents, saveEvents, trimEvents, logDailySale, localDay, uid } from './storage';

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
// edited on both → local where local changed, else remote. Stock, incoming and history are
// then rebuilt by event replay (mergeSnapshots).
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
    out.push(m);
  }
  return out;
}

// ---- event replay (mirror of iqFresh / iqReplay / iqAdjusts / iqMergeSnap) ----
// Replay order: calendar day, then time, then id.
const evOrder = (a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const union = (lists) => {
  const seen = new Set();
  return lists.flat().filter((e) => e && typeof e.id === 'string' && !seen.has(e.id) && seen.add(e.id));
};
// Events not yet reflected in a base whose events are bev; older than the base's oldest = already applied.
export function freshEvents(bev, evs) {
  const seen = new Set(bev.map((e) => e.id));
  const floor = bev.length ? Math.min(...bev.map((e) => e.t)) : 0;
  return evs.filter((e) => e && typeof e.id === 'string' && !seen.has(e.id) && e.t >= floor).sort(evOrder);
}
// Stock, incoming and history of base product b after the events. A receive takes at most what's incoming.
export function replay(b, evs) {
  let p = { stock: num(b.stock), incoming: num(b.incoming), history: b.history || [], histCens: b.histCens || [], histDay: b.histDay };
  for (const e of evs) {
    if (e.type === 'close') {
      if (p.histDay !== e.day) p = { ...p, ...logDailySale(p, 0, e.day, !(p.stock > 0)) };
      continue;
    }
    if (e.pid !== b.id) continue;
    let q = num(e.q);
    if (e.type === 'sale') p = { ...p, stock: Math.max(0, p.stock - q), ...logDailySale(p, q, e.day, !!e.cens) };
    else if (e.type === 'order') p.incoming += q;
    else if (e.type === 'receive') { q = Math.min(q, p.incoming); p.stock += q; p.incoming -= q; }
    else if (e.type === 'adjust') { p.stock = num(e.stock); p.incoming = num(e.incoming); }
  }
  return p;
}
// Stock edits no event explains (edit form, restore, older clients) become absolute adjust events at time t.
export function adjustEvents(baseProds, ps, fresh, t) {
  const B = new Map(baseProds.map(normalize).map((b) => [b.id, b]));
  const out = [];
  for (const p of ps) {
    const b = B.get(p.id);
    if (!b) continue;
    const r = replay(b, fresh), stock = num(p.stock), incoming = num(p.incoming);
    if (r.stock !== stock || r.incoming !== incoming) out.push({ id: uid(), t, day: localDay(new Date(t)), type: 'adjust', pid: p.id, stock, incoming });
  }
  return out;
}
// Merge after a 409 (same rules as iqMergeSnap): field edits/adds/deletes by mergeProducts, then
// stock/incoming/history by replaying every event the base hadn't seen. Differing stock
// corrections on both sides: the later wins and is listed in conflicts [{ name, kept }].
export function mergeSnapshots(base, local, remote, rt) {
  const bev = base.events || remote.events || []; // base from before events existed: treat the server's as applied
  const radj = adjustEvents(base.products, remote.products, freshEvents(bev, remote.events), rt);
  const events = trimEvents(union([bev, remote.events, radj, local.events]));
  const fresh = freshEvents(bev, events);
  const B = new Map(base.products.map(normalize).map((b) => [b.id, b]));
  const mine = new Set(local.events.map((e) => e.id));
  const conflicts = [];
  const products = mergeProducts(base.products, local.products, remote.products).map((p) => {
    const b = B.get(p.id);
    if (!b) return p;
    const r = replay(b, fresh);
    const m = { ...p, stock: r.stock, history: r.history, histCens: r.histCens };
    if (r.incoming || 'incoming' in p) m.incoming = r.incoming; // don't add fields: unchanged must stay identical to base
    if (r.histDay != null) m.histDay = r.histDay;
    const adj = fresh.filter((e) => e.type === 'adjust' && e.pid === p.id);
    const sides = new Set(adj.map((e) => (mine.has(e.id) ? 'l' : 'r')));
    if (sides.size === 2 && new Set(adj.map((e) => `${e.stock}/${e.incoming}`)).size > 1) conflicts.push({ name: p.name, kept: adj[adj.length - 1].stock });
    return m;
  });
  return { products, events, conflicts };
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
// Resolves { ok, mode, merged, conflicts, count } or { ok: false, reason }.
// conflicts: products whose stock was corrected differently on two devices ([{ name, kept }]).
export async function syncToCloud() {
  if (SYNC.busy) return { ok: false, reason: 'A sync is already running' };
  SYNC.busy = true; // before loading: saves are refused until we finish, so nothing lands between capture and apply
  try {
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
    // Stock edits no event explains become adjust events before anything is sent, so a retry carries the same ids.
    let events = await loadEvents();
    const adj = adjustEvents(base.products, products, freshEvents(base.events || [], events), Date.now());
    if (adj.length) events = await saveEvents([...events, ...adj]);
    let out = { products, sales, events };
    let r = await api('PUT', path, { token: store.token, body: { baseVersion: base.version, ...out } });
    let merged = false, conflicts = [];
    if (r.status === 409) {
      const g = await api('GET', path, { token: store.token });
      if (g.status !== 200) return fail(g);
      const remote = { products: g.data.products || [], events: g.data.events || [] };
      const m = mergeSnapshots(base, { products, events }, remote, Date.parse(g.data.updatedAt) || Date.now());
      out = { products: m.products, sales: mergeSales(sales, g.data.sales || []), events: m.events };
      merged = true;
      conflicts = m.conflicts;
      r = await api('PUT', path, { token: store.token, body: { baseVersion: g.data.version, ...out } });
    }
    if (r.status !== 200) return fail(r);
    if (merged) {
      await applyLocal(out.products, out.sales);
      await saveEvents(out.events);
    }
    await setJSON(BASE_KEY, { version: r.data.version, products: out.products, sales: out.sales, events: out.events });
    await AsyncStorage.setItem(KEYS.LAST_SYNC, Date.now().toString());
    return { ok: true, mode: 'cloud', merged, conflicts, count: out.products.length };
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
    if (!r.data.version) return { ok: false, reason: 'Nothing saved to this store yet' }; // a saved empty catalog still restores
    const products = (r.data.products || []).map(normalize);
    const events = r.data.events || [];
    await applyLocal(products, r.data.sales); // throws before we link to the store if it can't persist
    await saveEvents(events);
    await setJSON(STORE_KEY, store);
    await setJSON(BASE_KEY, { version: r.data.version, products, sales: r.data.sales || [], events });
    return { ok: true, mode: 'cloud', count: products.length, timestamp: r.data.updatedAt };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

export async function getLastSyncTime() {
  const t = await AsyncStorage.getItem(KEYS.LAST_SYNC);
  return t ? parseInt(t) : null;
}
