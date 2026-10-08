/**
 * InventoryIQ — Cloud Sync Client
 *
 * Uses plain Supabase REST API (no SDK dependency) so the bundle stays small
 * and the contract is easy to inspect. If SUPABASE_URL is not configured,
 * sync falls back to a local snapshot stored in AsyncStorage — same behaviour
 * as the web build, so the app is fully usable offline / unconfigured.
 *
 * Setup:
 *   1) Create a Supabase project at supabase.com (free tier is fine)
 *   2) Run ../../../supabase/schema.sql in the SQL editor
 *   3) Paste your project URL and anon/publishable key below and rebuild.
 *
 * The anon key is safe to ship: the schema blocks direct table access and
 * only exposes iq_push / iq_pull, keyed by an exact Device ID. The Device ID
 * is therefore the password to a store's data — don't share it publicly.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  KEYS,
  loadProducts,
  saveProducts,
  loadSalesLog,
  getDeviceId,
  pushSyncSnapshot,
  computeStatus,
} from './storage';

// ──────────────────────────────────────────
// Fill these in to enable real cloud sync.
// Leave empty strings to use local snapshot mode.
// ──────────────────────────────────────────
export const SUPABASE_URL = '';
export const SUPABASE_KEY = '';

function isCloudConfigured() {
  return !!(SUPABASE_URL && SUPABASE_KEY);
}

async function rpc(fn, body) {
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${txt.slice(0, 120)}`);
  return txt ? JSON.parse(txt) : null;
}

// ============================================================
// PUSH — upload current state
// ============================================================
export async function syncToCloud() {
  const products = await loadProducts();
  if (!products.length) {
    return { ok: false, reason: 'No products to sync' };
  }

  // Always snapshot locally first (powers Undo Last Sync)
  await pushSyncSnapshot();

  const deviceId = await getDeviceId();
  const sales = await loadSalesLog();
  if (!isCloudConfigured()) {
    // Fallback: store the snapshot in AsyncStorage as a "local cloud"
    await AsyncStorage.setItem(
      KEYS.CLOUD,
      JSON.stringify({
        data: products,
        sales,
        timestamp: Date.now(),
        deviceId,
      }),
    );
    await AsyncStorage.setItem(KEYS.LAST_SYNC, Date.now().toString());
    return {
      ok: true,
      mode: 'local',
      count: products.length,
      message:
        'Saved a local snapshot. Configure Supabase URL/key in src/lib/supabase.js for cross-device sync.',
    };
  }

  try {
    await rpc('iq_push', { p_device_id: deviceId, p_data: products, p_sales: sales });
    await AsyncStorage.setItem(KEYS.LAST_SYNC, Date.now().toString());
    return { ok: true, mode: 'cloud', count: products.length };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// ============================================================
// PULL — restore from another device or this device's last push
// ============================================================
export async function restoreFromCloud(targetDeviceId) {
  const myId = await getDeviceId();
  const id = (targetDeviceId || myId).trim().toUpperCase();

  if (!isCloudConfigured()) {
    // Fallback: restore from local snapshot
    const raw = await AsyncStorage.getItem(KEYS.CLOUD);
    if (!raw) return { ok: false, reason: 'No local snapshot found' };
    try {
      const snap = JSON.parse(raw);
      const restored = (snap.data || []).map((p) => ({
        ...p,
        status: computeStatus(p),
      }));
      await saveProducts(restored);
      if (Array.isArray(snap.sales)) {
        await AsyncStorage.setItem(KEYS.SALES, JSON.stringify(snap.sales));
      }
      return {
        ok: true,
        mode: 'local',
        count: restored.length,
        timestamp: snap.timestamp,
      };
    } catch (e) {
      return { ok: false, reason: 'Local snapshot corrupt' };
    }
  }

  try {
    const row = await rpc('iq_pull', { p_device_id: id });
    if (!row || !Array.isArray(row.data)) {
      return { ok: false, reason: `No data found for device ${id}` };
    }
    const restored = (row.data || []).map((p) => ({
      ...p,
      status: computeStatus(p),
    }));
    await saveProducts(restored);
    if (Array.isArray(row.sales_log)) {
      await AsyncStorage.setItem(KEYS.SALES, JSON.stringify(row.sales_log));
    }
    return {
      ok: true,
      mode: 'cloud',
      count: restored.length,
      timestamp: row.updated_at,
    };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// ============================================================
// STATUS HELPERS
// ============================================================
export async function getLastSyncTime() {
  const t = await AsyncStorage.getItem(KEYS.LAST_SYNC);
  return t ? parseInt(t) : null;
}

export function isConfigured() {
  return isCloudConfigured();
}
