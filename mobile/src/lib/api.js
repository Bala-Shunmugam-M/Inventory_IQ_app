// API client for InventoryIQ backend
import Constants from 'expo-constants';

const API_BASE = (Constants?.expoConfig?.extra?.apiBaseUrl || 'https://inventory-ai-51.preview.emergentagent.com');

async function handle(res) {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const api = {
  base: API_BASE,
  health: () => fetch(`${API_BASE}/api/health`).then(handle),
  calculate: (body) => fetch(`${API_BASE}/api/calculate`, {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
  }).then(handle),
  forecast: (body) => fetch(`${API_BASE}/api/forecast`, {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
  }).then(handle),
  syncSkus: (client_id, skus) => fetch(`${API_BASE}/api/sync/skus`, {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ client_id, skus })
  }).then(handle),
  getSkus: (client_id) => fetch(`${API_BASE}/api/sync/skus?client_id=${encodeURIComponent(client_id)}`).then(handle),
  recordSale: (client_id, sku_id, units_sold) => fetch(`${API_BASE}/api/sales`, {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ client_id, sku_id, units_sold })
  }).then(handle),
  getAbc: (client_id) => fetch(`${API_BASE}/api/abc/${encodeURIComponent(client_id)}`).then(handle),
};
