// Exercise the real UI handlers without requiring a native emulator.
// Rendering and touch layout still need browser/device checks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const core = createRequire(import.meta.url)('../docs/iq-core.js');
const read = (file) => readFileSync(new URL('../' + file, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'UI handler boundaries must exist');
  return source.slice(a, b);
}
function load(code, scope, names) {
  return new Function(...Object.keys(scope), code + '\nreturn {' + names + '};')(...Object.values(scope));
}
const html = read('docs/index.html');
const webCode = between(html, 'function finishSalesDay(){', '/* ══════════════════════════════════════════\n   DETAIL');
const catalog = () => [{ id: 1, stock: 10, cost: 2, sell: 3 }, { id: 2, stock: 4, cost: 1, sell: 2 }, { id: 3, stock: 0, cost: 1, sell: 2 }];
function web(products, qty) {
  const messages = [], confirmations = [], logs = [];
  let saves = 0;
  const scope = { ...core, PRODS: products, QTY: qty, iqUid: () => 'test-sale',
    toast: (...args) => messages.push(args), iqUiConfirm: (...args) => confirmations.push(args),
    recomputeAllStatus() {}, saveProds() { saves++; }, renderSales() {},
    saveSalesLog: (e) => logs.push(e), document: { getElementById: () => ({}) }, setTimeout() {} };
  return { ...load(webCode, scope, 'finishSalesDay,doSave'), confirmations, messages, logs, saves: () => saves };
}
{
  const ps = catalog(), ui = web(ps, { 1: 2 });
  ui.finishSalesDay();
  assert.equal(ui.confirmations.length, 0, 'cannot close over unsaved quantities');
  assert.equal(ui.saves(), 0);
  ui.doSave(); ui.doSave();
  assert.equal(ps[0].stock, 8, 'double submission does not deduct the same draft twice');
  assert.equal(ui.logs.length, 1);
  assert.equal(ps[1].histDay, undefined, 'partial save leaves other products unlogged');
  ui.finishSalesDay();
  assert.equal(ps[1].histDay, undefined, 'opening/cancelling confirmation does not record zeros');
  ui.confirmations.at(-1)[3]();
  assert.deepEqual(ps.map((p) => p.stock), [8, 4, 0]);
  assert.deepEqual(ps.map((p) => p.history.at(-1)), [2, 0, 0]);
  assert.equal(ps[2].histCens.at(-1), 1, 'empty shelves remain censored');
}
{
  const ps = catalog(), ui = web(ps, {});
  ui.finishSalesDay(); ui.confirmations[0][3]();
  assert.deepEqual(ps.map((p) => p.history.at(-1)), [0, 0, 0], 'zero-sales day can be finished');
}

const nativeSales = between(read('mobile/src/screens/SalesScreen.js'), '  const save = async', '  const finished =');
function native(qty = {}, overrides = {}) {
  const alerts = [], drafts = [], saving = [];
  let completions = 0;
  const ref = { current: false };
  const scope = { products: catalog(), qty, savingRef: ref, setSaving: (v) => saving.push(v),
    setQty: (v) => drafts.push(v), refresh: async () => {}, Alert: { alert: (...args) => alerts.push(args) },
    recordSales: async () => null, completeDay: async () => { completions++; return 3; }, ...overrides };
  return { ...load(nativeSales, scope, 'save,finishDay'), alerts, drafts, saving, ref, completions: () => completions };
}
{
  const ui = native({ 1: 2 }); ui.finishDay();
  assert.equal(ui.alerts[0][0], 'Save your entries first');
  assert.equal(ui.completions(), 0);
}
{
  const ui = native(); ui.finishDay();
  assert.equal(ui.completions(), 0, 'native confirmation does not save before acceptance');
  await ui.alerts[0][2].find((b) => b.text === 'Finish today').onPress();
  assert.equal(ui.completions(), 1);
  assert.equal(ui.alerts.at(-1)[0], 'Today is complete');
}
{
  const ui = native({}, { completeDay: async () => null }); ui.finishDay();
  await ui.alerts[0][2].find((b) => b.text === 'Finish today').onPress();
  assert.equal(ui.alerts.length, 1, 'refused completion must not claim success');
  assert.equal(ui.ref.current, false);
}
{
  let resolve, calls = 0;
  const pending = new Promise((r) => { resolve = r; });
  const ui = native({ 1: 2 }, { recordSales: () => { calls++; return pending; } });
  const first = ui.save(); await ui.save(); ui.finishDay();
  assert.equal(calls, 1, 'native save is guarded during async storage');
  resolve(null); await first;
  assert.equal(ui.drafts.length, 0, 'refused sale keeps the entered quantities');
  assert.equal(ui.ref.current, false);
}

const syncCode = between(read('mobile/src/screens/MoreScreen.js'), '  const doSync = async', '  const doRestore =');
{
  const alerts = [];
  const ui = load(syncCode, { syncToCloud: async () => ({ ok: true, mode: 'cloud', count: 2,
    conflicts: [{ name: 'Rice', kept: 18 }, { name: 'Soap', kept: 7 }] }),
    Alert: { alert: (...args) => alerts.push(args) }, refresh: async () => {} }, 'doSync');
  await ui.doSync();
  assert.equal(alerts.length, 1);
  assert.match(alerts[0][1], /Rice.*kept 18, please recount/);
  assert.match(alerts[0][1], /Soap.*kept 7, please recount/);
}
const crudCode = between(read('mobile/src/screens/ProductsScreen.js'), '  const submit = async', '  const filtered =');
for (const editingId of [null, 1]) {
  let closes = 0;
  const alerts = [];
  const ui = load(crudCode, { editingId, form: { name: 'Rice', cost: '2', sell: '3' }, products: catalog(),
    buildProduct: (x) => x, addProduct: async () => null, updateProduct: async () => null,
    deleteProduct: async () => null, refresh: async () => {}, close: () => { closes++; },
    Alert: { alert: (...args) => alerts.push(args) } }, 'submit,remove');
  await ui.submit();
  assert.equal(closes, 0, 'a refused add/edit must keep the form open');
  if (editingId) {
    await ui.remove(); await alerts[0][2].find((b) => b.text === 'Delete').onPress();
    assert.equal(closes, 0, 'a refused delete must keep the form open');
  }
}
console.log('UI workflows: all checks passed');
