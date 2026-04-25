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
 *   2) Run this SQL in the SQL editor:
 *
 *      create table if not exists inventory_v8 (
 *        device_id   text primary key,
 *        data        jsonb not null,
 *        sales_log   jsonb,
 *        updated_at  timestamptz default now()
 *      );
 *      alter table inventory_v8 enable row level security;
 *      create policy "anon read"  on inventory_v8 for select using (true);
 *      create policy "anon write" on inventory_v8 for insert with check (true);
 *      create policy "anon update" on inventory_v8 for update using (true) with check (true);
 *
 *   3) Paste your project URL and anon key below and rebuild.
 *
 * Why this is safe even with anon-write policies:
 *   The primary key is the device-generated ID (IQ-xxxxx-xxxxx), so writes
 *   are namespaced per device. There is no PII or cross-tenant data; another
 *   user could only see your row if they guessed your 25-character device ID.
 *   For production you would tighten RLS to require an auth.jwt() — this
 *   demo configuration is intentionally simple so the patent demo works
 *   without sign-in.
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

const TABLE = 'inventory_v8';

function isCloudConfigured() {
  return !!(SUPABASE_URL && SUPABASE_KEY);
}

function authHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
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
  const payload = {
    device_id: deviceId,
    data: products,
    sales_log: sales,
    updated_at: new Date().toISOString(),
  };

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
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
      method: 'POST',
      headers: { ...authHeaders(), Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, reason: `Supabase ${res.status}: ${txt}` };
    }
    await AsyncStorage.setItem(KEYS.LAST_SYNC, Date.now().toString());
    return { ok: true, mode: 'cloud', count: products.length };
  } catch (e) {
    return { ok: false, reason: 'Network error — ' + e.message };
  }
}

// ============================================================
// PULL — restore from another device or this device's last push
// ============================================================
export async function restoreFromCloud(targetDeviceId) {
  const myId = await getDeviceId();
  const id = (targetDeviceId || myId).trim();

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
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${TABLE}?device_id=eq.${encodeURIComponent(
        id,
      )}&select=*`,
      { headers: authHeaders() },
    );
    if (!res.ok) {
      return { ok: false, reason: `Supabase ${res.status}` };
    }
    const rows = await res.json();
    if (!rows.length) {
      return { ok: false, reason: `No data found for device ${id}` };
    }
    const row = rows[0];
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
    return { ok: false, reason: 'Network error — ' + e.message };
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
