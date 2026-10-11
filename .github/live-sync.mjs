// Daily cloud-sync round trip against the live Worker, run by .github/workflows/ai-health.yml.
// Reuses one fixed test store (HEALTH_STORE_ID / HEALTH_STORE_TOKEN secrets) so the DB doesn't grow.
import assert from 'node:assert/strict';

const W = 'https://inventoryiq-llm-proxy.balashunmugamruthran.workers.dev';
const { HEALTH_STORE_ID: id, HEALTH_STORE_TOKEN: token } = process.env;
assert.ok(id && token, 'HEALTH_STORE_ID and HEALTH_STORE_TOKEN secrets must be set');

const call = async (method, body) => {
  const r = await fetch(`${W}/api/stores/${id}/snapshot`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body && JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
};

const before = await call('GET');
assert.equal(before.status, 200, JSON.stringify(before.json));
const v = before.json.version;

// A fresh marker each run proves this run's write is what comes back, not yesterday's.
const marker = new Date().toISOString();
const snap = {
  baseVersion: v,
  products: [{ id: 1, name: 'Health check item', stock: 1, histDay: marker }],
  sales: [{ date: marker.slice(0, 10) }],
  events: [{ id: 'health-' + marker }],
};
const put = await call('PUT', snap);
assert.equal(put.status, 200, JSON.stringify(put.json));
assert.equal(put.json.version, v + 1);

const after = await call('GET');
assert.equal(after.status, 200, JSON.stringify(after.json));
assert.equal(after.json.version, v + 1);
assert.deepEqual(after.json.products, snap.products);
assert.deepEqual(after.json.events, snap.events);

const stale = await call('PUT', snap);
assert.equal(stale.status, 409, JSON.stringify(stale.json));

console.log(`sync round trip OK: version ${v} -> ${v + 1}, stale write rejected`);
