/* Presentation helpers only. Inventory calculations and persistence stay in the existing engine. */
function iqUiNode(tag, cls, text) {
  var el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}
function iqUiButton(label, action, secondary) {
  var b = iqUiNode('button', 'merchant-button' + (secondary ? ' secondary' : ''), label);
  b.type = 'button';
  b.addEventListener('click', action);
  return b;
}
function iqUiOrder(id) {
  var p = PRODS.find(function (x) { return x.id === id; });
  if (!p || !iqOrderQty(p)) return;
  if (confirm('Record an order for ' + iqOrderQty(p) + ' units of ' + p.name + '?\n\nUse this after you have ordered from your supplier. This does not send an order.')) markOrdered(id);
}
function iqUiReceive(id) {
  var p = PRODS.find(function (x) { return x.id === id; });
  if (!p || !p.incoming) return;
  if (confirm('Have all ' + p.incoming + ' units of ' + p.name + ' arrived?\n\nConfirm only after checking the delivery.')) receiveStock(id);
}
function iqUiArrivals() {
  nav('prods');
  filterProds('incoming', document.getElementById('filter-incoming'));
}
function iqUiProductCard(p, home) {
  var card = iqUiNode('article', 'merchant-product');
  var top = iqUiNode('div', 'merchant-product-top');
  var icon = iqUiNode('span', 'merchant-product-icon', p.ico || '📦');
  icon.setAttribute('aria-hidden', 'true');
  top.appendChild(icon);
  var heading = iqUiNode('div', 'merchant-product-heading');
  heading.appendChild(iqUiNode('h3', '', p.name || 'Unnamed product'));
  heading.appendChild(iqUiNode('p', '', p.supplier && p.supplier !== '—' ? p.supplier : 'No supplier added'));
  top.appendChild(heading);
  card.appendChild(top);
  var labels = { critical: '⚠ Stock running low', order: '↗ Time to buy', watch: '◷ Check soon', good: '✓ Stock looks good' };
  card.appendChild(iqUiNode('div', 'merchant-status ' + (['critical','order','watch','good'].indexOf(p.status) >= 0 ? p.status : 'good'), labels[p.status] || labels.good));
  var figures = iqUiNode('div', 'merchant-figures');
  [['On the shelf', p.stock || 0], ['Suggested purchase', iqOrderQty(p)]].forEach(function (entry) {
    var figure = iqUiNode('div');
    figure.appendChild(iqUiNode('span', '', entry[0]));
    figure.appendChild(iqUiNode('strong', '', entry[1] + ' units'));
    figures.appendChild(figure);
  });
  card.appendChild(figures);
  if (p.incoming > 0) card.appendChild(iqUiNode('p', 'merchant-arrival', '📦 ' + p.incoming + ' units ordered · waiting to arrive'));
  var actions = iqUiNode('div', 'merchant-actions');
  if (iqOrderQty(p) > 0) actions.appendChild(iqUiButton('✓ I placed this order', function () { iqUiOrder(p.id); }));
  if (p.incoming > 0) actions.appendChild(iqUiButton('📥 Stock arrived', function () { iqUiReceive(p.id); }));
  actions.appendChild(iqUiButton('Edit product', function () { openEditProd(p.id); }, true));
  card.appendChild(actions);
  if (!home) {
    var details = iqUiNode('details', 'merchant-details');
    details.appendChild(iqUiNode('summary', '', 'Prices & planning details'));
    details.appendChild(iqUiNode('p', '', 'Buy ₹' + (p.cost || 0) + ' · Sell ₹' + (p.sell || 0) + ' per unit'));
    details.appendChild(iqUiNode('p', '', 'Reorder level: ' + p.rop + ' · Economic batch: ' + p.eoq + ' · Class ' + p.cls));
    card.appendChild(details);
  }
  return card;
}
