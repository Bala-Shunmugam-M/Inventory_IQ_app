// Local persistence + inventory math (mirrors the web app logic)
import AsyncStorage from '@react-native-async-storage/async-storage';

export const defaultSkus = [
  { id:1, name:'Aashirvaad Atta 5kg', category:'FMCG', demand:11, stddev:3, leadtime:7, ltstddev:1, cost:275, sellprice:310, ordercost:150, stock:55, moq:10, pattern:'stable', shortage:15, history:[10,11,12,11,13,12,10,11,12,14,13,11,12,10,12,11,13,14,12,11,10,12,13,11,12,14,13,12,11,12,13,14,11,12,13,12,11,10,12,13,14,12,11,13,12,11,12,13,11,12] },
  { id:2, name:'Fortune Rice 1kg', category:'FMCG', demand:14, stddev:4, leadtime:5, ltstddev:1, cost:85, sellprice:98, ordercost:120, stock:60, moq:25, pattern:'stable', shortage:8, history:[14,15,13,14,16,12,14,15,13,14,15,16,14,13,15,14,15,14,13,16,14,15,13,14,15,14,13,15,14,16,15,14,13,14,15,14,15,13,14,15,14,15,16,14,13,15,14,15,14,13] },
  { id:3, name:'Tata Salt 1kg', category:'FMCG', demand:8, stddev:2, leadtime:4, ltstddev:0.5, cost:28, sellprice:32, ordercost:80, stock:40, moq:50, pattern:'stable', shortage:3, history:[8,9,7,8,9,7,8,9,8,7,8,9,8,7,9,8,7,8,9,8,7,8,9,7,8,9,8,7,8,9,8,7,9,8,7,8,9,8,7,8,9,7,8,9,8,7,8,9,8,7] },
];

const KEY_SKUS = 'iq_mobile_skus';
const KEY_CLIENT = 'iq_mobile_client_id';

export async function getClientId() {
  let cid = await AsyncStorage.getItem(KEY_CLIENT);
  if (!cid) {
    cid = 'mobile-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now();
    await AsyncStorage.setItem(KEY_CLIENT, cid);
  }
  return cid;
}

export async function loadSkus() {
  try {
    const raw = await AsyncStorage.getItem(KEY_SKUS);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return JSON.parse(JSON.stringify(defaultSkus));
}

export async function saveSkus(skus) {
  await AsyncStorage.setItem(KEY_SKUS, JSON.stringify(skus));
}

// ── INVENTORY MATH ──
export const Z = { A: 2.33, B: 1.65, C: 1.28 };

export function abcClass(sku, allSkus) {
  const values = allSkus.map(s => ({ id: s.id, v: s.demand * 365 * s.cost }));
  values.sort((a, b) => b.v - a.v);
  const total = values.reduce((a, b) => a + b.v, 0) || 1;
  let cum = 0;
  for (const it of values) {
    cum += it.v;
    const pct = (cum / total) * 100;
    if (it.id === sku.id) return pct <= 70 ? 'A' : pct <= 90 ? 'B' : 'C';
  }
  return 'C';
}

export function calcSS(sku, z) {
  const zz = z || 1.65;
  const demandPart = zz * sku.stddev * Math.sqrt(sku.leadtime);
  const ltPart = zz * (sku.ltstddev || 0) * sku.demand;
  return Math.ceil(Math.sqrt(demandPart * demandPart + ltPart * ltPart));
}

export function calcROP(sku, ss) {
  return Math.ceil(sku.demand * sku.leadtime + ss);
}

export function calcEOQ(sku) {
  const D = sku.demand * 365, S = sku.ordercost || 100, H = sku.cost * 0.2;
  if (H <= 0) return sku.moq || 1;
  return Math.max(Math.ceil(Math.sqrt((2 * D * S) / H)), sku.moq || 1);
}

export function getStatus(sku, allSkus) {
  const cls = abcClass(sku, allSkus);
  const z = Z[cls] || 1.65;
  const ss = calcSS(sku, z);
  const rop = calcROP(sku, ss);
  if (sku.stock <= 0) return { key: 'stockout', label: 'STOCKOUT', color: '#EF4444' };
  if (sku.stock < ss) return { key: 'critical', label: 'CRITICAL', color: '#F59E0B' };
  if (sku.stock <= rop) return { key: 'reorder', label: 'REORDER', color: '#EAB308' };
  return { key: 'good', label: 'GOOD', color: '#10B981' };
}
