/**
 * Sales Screen
 *
 * Daily sales entry. Increment quantity per product with + / − buttons.
 * Save button persists, decrements stock, recomputes statuses, and writes
 * to the sales log so the dashboard's reports are populated.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { loadProducts, recordSales } from '../lib/storage';
import { COLORS, STATUS_COLORS } from '../lib/theme';

export default function SalesScreen({ navigation }) {
  const [products, setProducts] = useState([]);
  const [qty, setQty] = useState({});

  const refresh = useCallback(async () => {
    const list = await loadProducts();
    setProducts(list);
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener('focus', refresh);
    refresh();
    return unsub;
  }, [navigation, refresh]);

  const adjust = (id, delta) => {
    const p = products.find((x) => x.id === id);
    if (!p || p.stock === 0) return;
    const cur = qty[id] || 0;
    const next = Math.max(0, Math.min(p.stock, cur + delta));
    setQty({ ...qty, [id]: next });
  };

  const setQuick = (id, n) => {
    const p = products.find((x) => x.id === id);
    if (!p || p.stock === 0) return;
    setQty({ ...qty, [id]: Math.min(n, p.stock) });
  };

  const reset = () => setQty({});

  const save = async () => {
    const entered = products.filter((p) => (qty[p.id] || 0) > 0);
    if (!entered.length) return;
    const entry = await recordSales(qty);
    if (!entry) return;
    Alert.alert(
      '✅ Saved',
      `Updated ${entry.items} products · ${entry.totalUnits} units · ₹${Math.round(
        entry.totalProfit,
      )} profit`,
      [{ text: 'OK', onPress: () => { setQty({}); refresh(); } }],
    );
  };

  const totals = (() => {
    let units = 0,
      profit = 0,
      items = 0;
    products.forEach((p) => {
      const q = qty[p.id] || 0;
      if (q > 0) {
        items++;
        units += q;
        profit += q * (p.sell - p.cost);
      }
    });
    return { units, profit, items };
  })();

  if (!products.length) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>📝</Text>
        <Text style={styles.emptyTitle}>No products yet</Text>
        <Text style={styles.emptySub}>
          Add products first, then come back here every evening to log
          today's sales.
        </Text>
        <TouchableOpacity
          style={styles.emptyBtn}
          onPress={() => navigation.navigate('Products')}
        >
          <Text style={styles.emptyBtnText}>＋ Add Product</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Sort: those with quantity entered first, then by status priority
  const sorted = [...products].sort((a, b) => {
    const qa = qty[a.id] || 0;
    const qb = qty[b.id] || 0;
    if (qa > 0 && qb === 0) return -1;
    if (qb > 0 && qa === 0) return 1;
    const o = { critical: 0, order: 1, watch: 2, good: 3 };
    return (o[a.status] || 3) - (o[b.status] || 3);
  });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Today's Sales</Text>
          <Text style={styles.headerSub}>Tap + or − to record units sold</Text>
        </View>
        <TouchableOpacity style={styles.resetBtn} onPress={reset}>
          <Text style={styles.resetBtnText}>↺ Reset</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 120 }}>
        {sorted.map((p) => {
          const q = qty[p.id] || 0;
          const isOut = p.stock === 0;
          return (
            <View
              key={p.id}
              style={[styles.card, q > 0 && styles.cardActive]}
            >
              <View style={styles.cardTop}>
                <Text style={styles.icon}>{p.ico || '📦'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{p.name}</Text>
                  <Text
                    style={[
                      styles.stockText,
                      { color: STATUS_COLORS[p.status]?.fg },
                    ]}
                  >
                    {isOut ? 'Out of stock' : `Stock: ${p.stock}`}
                  </Text>
                </View>
              </View>

              {!isOut && (
                <>
                  <View style={styles.ctrlRow}>
                    <TouchableOpacity
                      style={[styles.ctrlBtn, styles.ctrlMinus]}
                      onPress={() => adjust(p.id, -1)}
                    >
                      <Text style={styles.ctrlMinusText}>−</Text>
                    </TouchableOpacity>
                    <View style={styles.qtyDisplay}>
                      <Text
                        style={[
                          styles.qtyValue,
                          q > 0 && { color: COLORS.green },
                        ]}
                      >
                        {q}
                      </Text>
                      <Text style={styles.qtyUnit}>units sold</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.ctrlBtn, styles.ctrlPlus]}
                      onPress={() => adjust(p.id, 1)}
                    >
                      <Text style={styles.ctrlPlusText}>+</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.quickRow}>
                    <Text style={styles.quickLabel}>Quick</Text>
                    {[5, 10, 20].map((n) => (
                      <TouchableOpacity
                        key={n}
                        style={[
                          styles.quickBtn,
                          q === n && styles.quickBtnActive,
                        ]}
                        onPress={() => setQuick(p.id, n)}
                      >
                        <Text
                          style={[
                            styles.quickBtnText,
                            q === n && { color: '#fff' },
                          ]}
                        >
                          +{n}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {q > 0 && (
                    <View style={styles.summary}>
                      <Text style={styles.summaryEntered}>✓ {q} entered</Text>
                      <Text style={styles.summaryProfit}>
                        → ₹{q * (p.sell - p.cost)} profit
                      </Text>
                    </View>
                  )}
                </>
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* Save banner */}
      <View style={styles.saveBanner}>
        <View style={{ flex: 1 }}>
          <Text style={styles.saveBannerLabel}>
            {totals.items > 0
              ? `${totals.items} entered · ${totals.units} units`
              : 'Enter units sold for each product'}
          </Text>
          {totals.profit > 0 && (
            <Text style={styles.saveBannerProfit}>
              +₹{totals.profit} profit
            </Text>
          )}
        </View>
        <TouchableOpacity
          style={[
            styles.saveBtn,
            totals.items === 0 && styles.saveBtnDisabled,
          ]}
          onPress={save}
          disabled={totals.items === 0}
        >
          <Text style={styles.saveBtnText}>
            {totals.items > 0
              ? `✅ Save ${totals.items}`
              : 'Save & Update Stock'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  empty: {
    flex: 1,
    backgroundColor: COLORS.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  emptyIcon: { fontSize: 56, marginBottom: 12 },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.ink,
    marginBottom: 6,
  },
  emptySub: {
    fontSize: 13,
    color: COLORS.muted,
    textAlign: 'center',
    marginBottom: 20,
  },
  emptyBtn: {
    backgroundColor: COLORS.ink,
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  header: {
    backgroundColor: COLORS.white,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { fontSize: 16, fontWeight: '800', color: COLORS.ink },
  headerSub: { fontSize: 11, color: COLORS.muted, fontWeight: '600' },
  resetBtn: {
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  resetBtnText: { fontSize: 12, fontWeight: '700', color: COLORS.ink2 },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginBottom: 8,
  },
  cardActive: { borderColor: COLORS.green, borderWidth: 2 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { fontSize: 24 },
  name: { fontSize: 13, fontWeight: '700', color: COLORS.ink },
  stockText: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  ctrlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  ctrlBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ctrlMinus: { backgroundColor: COLORS.surface },
  ctrlMinusText: { fontSize: 22, fontWeight: '800', color: COLORS.ink2 },
  ctrlPlus: { backgroundColor: COLORS.ink },
  ctrlPlusText: { fontSize: 22, fontWeight: '800', color: '#fff' },
  qtyDisplay: { flex: 1, alignItems: 'center' },
  qtyValue: { fontSize: 28, fontWeight: '800', color: COLORS.ink },
  qtyUnit: { fontSize: 10, fontWeight: '600', color: COLORS.muted },
  quickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  quickLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.muted,
    marginRight: 4,
  },
  quickBtn: {
    flex: 1,
    backgroundColor: COLORS.surface,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: 'center',
  },
  quickBtnActive: { backgroundColor: COLORS.green },
  quickBtnText: { fontSize: 12, fontWeight: '700', color: COLORS.ink2 },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  summaryEntered: { fontSize: 11, fontWeight: '700', color: COLORS.green },
  summaryProfit: { fontSize: 10, fontWeight: '600', color: COLORS.muted },
  saveBanner: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    paddingBottom: 22,
    gap: 12,
  },
  saveBannerLabel: { fontSize: 12, fontWeight: '700', color: COLORS.ink2 },
  saveBannerProfit: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.green,
    marginTop: 2,
  },
  saveBtn: {
    backgroundColor: COLORS.ink,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 10,
  },
  saveBtnDisabled: { backgroundColor: COLORS.light },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
