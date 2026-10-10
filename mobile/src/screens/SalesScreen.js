/**
 * Sales Screen
 *
 * Daily sales entry. Increment quantity per product with + / − buttons.
 * Save button persists, decrements stock, recomputes statuses, and writes
 * to the sales log so the dashboard's reports are populated.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { loadProducts, recordSales, completeDay, localDay } from '../lib/storage';
import { COLORS, STATUS_COLORS } from '../lib/theme';

export default function SalesScreen({ navigation }) {
  const [products, setProducts] = useState([]);
  const [qty, setQty] = useState({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

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
    if (savingRef.current) return;
    const p = products.find((x) => x.id === id);
    if (!p || p.stock === 0) return;
    const cur = qty[id] || 0;
    const next = Math.max(0, Math.min(p.stock, cur + delta));
    setQty({ ...qty, [id]: next });
  };

  const setQuick = (id, n) => {
    if (savingRef.current) return;
    const p = products.find((x) => x.id === id);
    if (!p || p.stock === 0) return;
    setQty({ ...qty, [id]: Math.min(n, p.stock) });
  };

  const reset = () => { if (!savingRef.current) setQty({}); };

  const save = async () => {
    if (savingRef.current) return;
    const entered = products.filter((p) => (qty[p.id] || 0) > 0);
    if (!entered.length) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const entry = await recordSales(qty);
      if (!entry) return;
      setQty({});
      await refresh();
      Alert.alert('✅ Saved', `Updated ${entry.items} products · ${entry.totalUnits} units · ₹${Math.round(entry.totalProfit)} profit`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const finishDay = () => {
    if (savingRef.current || !products.length) return;
    if (products.some((p) => (qty[p.id] || 0) > 0)) {
      Alert.alert('Save your entries first', 'Save the quantities you entered, then finish the day.');
      return;
    }
    Alert.alert('Finished for today?', 'Products with no sales saved today will be recorded as zero sales. Use this only after entering all of today’s sales.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Finish today', onPress: async () => {
        if (savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        try {
          const count = await completeDay();
          if (count === null) return;
          await refresh();
          Alert.alert('Today is complete', `${count} products recorded with zero sales.`);
        } finally {
          savingRef.current = false;
          setSaving(false);
        }
      } },
    ]);
  };

  const finished = products.length > 0 && products.every((p) => p.histDay === localDay());

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

  // Keep products in a stable position while the merchant enters quantities.
  const sorted = products;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Today's Sales</Text>
          <Text style={styles.headerSub}>Tap + or − to record units sold</Text>
        </View>
        <TouchableOpacity style={styles.resetBtn} onPress={reset}>
          <Text style={styles.resetBtnText}>↺ Reset</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 260 }}>
        <Text style={styles.entryNote}>Save sales as you go. Other products stay unlogged. When all today's sales are saved, tap “Finished entering today's sales” — even on a day with no sales.</Text>
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
                      accessibilityRole="button"
                      accessibilityLabel={`One fewer ${p.name} sold`}
                      disabled={q === 0}
                    >
                      <Text style={styles.ctrlMinusText}>−</Text>
                    </TouchableOpacity>
                    <View style={styles.qtyDisplay} accessible accessibilityLabel={`${q} units of ${p.name} sold`} accessibilityLiveRegion="polite">
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
                      accessibilityRole="button"
                      accessibilityLabel={`One more ${p.name} sold`}
                      disabled={q >= p.stock}
                    >
                      <Text style={styles.ctrlPlusText}>+</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.quickRow}>
                    {[5, 10, 20].filter((n, i, ns) => i === 0 || Math.min(n, p.stock) !== Math.min(ns[i - 1], p.stock)).map((n) => (
                      <TouchableOpacity
                        key={n}
                        style={[
                          styles.quickBtn,
                          q === Math.min(n, p.stock) && styles.quickBtnActive,
                        ]}
                        onPress={() => setQuick(p.id, n)}
                        accessibilityRole="button"
                        accessibilityLabel={`Set ${p.name} sales to ${Math.min(n, p.stock)}`}
                      >
                        <Text
                          style={[
                            styles.quickBtnText,
                            q === Math.min(n, p.stock) && { color: '#fff' },
                          ]}
                        >
                          Set {Math.min(n, p.stock)}
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
        <View>
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
            (totals.items === 0 || saving) && styles.saveBtnDisabled,
          ]}
          onPress={save}
          disabled={totals.items === 0 || saving}
        >
          <Text style={styles.saveBtnText}>
            {totals.items > 0
              ? `✅ Save ${totals.items}`
              : 'Save & Update Stock'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.finishBtn, (saving || (finished && totals.items === 0)) && { opacity: 0.6 }]}
          accessibilityRole="button"
          disabled={saving || (finished && totals.items === 0)}
          onPress={finishDay}
        >
          <Text style={styles.finishBtnText}>{finished && totals.items === 0 ? "✓ Today's sales are complete" : "Finished entering today's sales"}</Text>
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
    fontSize: 15,
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
  headerTitle: { fontSize: 22, fontWeight: '800', color: COLORS.ink },
  headerSub: { fontSize: 14, color: COLORS.muted, fontWeight: '600' },
  entryNote: { fontSize: 14, lineHeight: 21, color: COLORS.muted, marginBottom: 14 },
  resetBtn: {
    minHeight: 44,
    justifyContent: 'center',
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
  name: { fontSize: 17, fontWeight: '700', color: COLORS.ink },
  stockText: { fontSize: 14, fontWeight: '600', marginTop: 2 },
  ctrlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  ctrlBtn: {
    width: 56,
    height: 56,
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
  qtyUnit: { fontSize: 14, fontWeight: '600', color: COLORS.muted },
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
    minHeight: 44,
    justifyContent: 'center',
    flex: 1,
    backgroundColor: COLORS.surface,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: 'center',
  },
  quickBtnActive: { backgroundColor: COLORS.green },
  quickBtnText: { fontSize: 15, fontWeight: '700', color: COLORS.ink2 },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  summaryEntered: { fontSize: 14, fontWeight: '700', color: COLORS.green },
  summaryProfit: { fontSize: 13, fontWeight: '600', color: COLORS.muted },
  saveBanner: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    alignItems: 'stretch',
    padding: 14,
    paddingBottom: 22,
    gap: 12,
  },
  saveBannerLabel: { fontSize: 14, fontWeight: '700', color: COLORS.ink2 },
  saveBannerProfit: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.green,
    marginTop: 2,
  },
  saveBtn: {
    minHeight: 52,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.ink,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 10,
  },
  saveBtnDisabled: { backgroundColor: COLORS.light },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  finishBtn: { minHeight: 48, padding: 12, borderRadius: 10, backgroundColor: COLORS.surface, justifyContent: 'center', alignItems: 'center' },
  finishBtnText: { fontSize: 14, fontWeight: '700', color: COLORS.ink2, textAlign: 'center' },
});
