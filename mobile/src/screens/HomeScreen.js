/**
 * Home Screen
 *
 * The daily action list. Shows products needing attention (critical / order /
 * watch) with quick-action buttons, plus three KPIs: Today's Profit, Stock
 * Value, Health %. Dismiss any card by swiping or tapping ✓ Marked Ordered.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadProducts,
  aggregateKPIs,
  loadDemo,
  KEYS,
} from '../lib/storage';
import { COLORS, STATUS_LABEL, STATUS_COLORS } from '../lib/theme';

export default function HomeScreen({ navigation }) {
  const [products, setProducts] = useState([]);
  const [dismissed, setDismissed] = useState({});
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const list = await loadProducts();
    setProducts(list);
    const dRaw = await AsyncStorage.getItem(KEYS.DISMISSED);
    setDismissed(dRaw ? JSON.parse(dRaw) : {});
    setRefreshing(false);
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener('focus', refresh);
    refresh();
    return unsub;
  }, [navigation, refresh]);

  const dismiss = async (id) => {
    const next = { ...dismissed, [id]: true };
    setDismissed(next);
    await AsyncStorage.setItem(KEYS.DISMISSED, JSON.stringify(next));
  };

  const handleLoadDemo = async () => {
    await loadDemo();
    await refresh();
  };

  const kpi = aggregateKPIs(products);
  const urgent = products.filter(
    (p) => p.status !== 'good' && !dismissed[p.id],
  );
  const sortedUrgent = urgent.sort((a, b) => {
    const order = { critical: 0, order: 1, watch: 2 };
    return (order[a.status] || 3) - (order[b.status] || 3);
  });

  if (!products.length) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>📦</Text>
        <Text style={styles.emptyTitle}>Welcome to InventoryIQ</Text>
        <Text style={styles.emptySub}>
          Add your first product or load demo data to get started
        </Text>
        <View style={styles.emptyBtnRow}>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary]}
            onPress={() => navigation.navigate('Products')}
          >
            <Text style={styles.btnPrimaryText}>＋ Add Product</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnSecondary]}
            onPress={handleLoadDemo}
          >
            <Text style={styles.btnSecondaryText}>🎮 Try Demo</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} />
      }
    >
      {/* Health summary card */}
      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>Today's Health</Text>
        <Text style={styles.heroValue}>{kpi.healthPct}%</Text>
        <View style={styles.heroBar}>
          <View
            style={[
              styles.heroBarFill,
              {
                width: `${kpi.healthPct}%`,
                backgroundColor:
                  kpi.healthPct > 75
                    ? COLORS.green
                    : kpi.healthPct > 50
                    ? COLORS.amber
                    : COLORS.red,
              },
            ]}
          />
        </View>
        <View style={styles.heroStats}>
          <Text style={styles.heroStat}>
            <Text style={{ color: COLORS.green }}>●</Text> {kpi.goodCount} good
          </Text>
          <Text style={styles.heroStat}>
            <Text style={{ color: COLORS.amber }}>●</Text> {kpi.watchCount} watch
          </Text>
          <Text style={styles.heroStat}>
            <Text style={{ color: COLORS.red }}>●</Text> {kpi.criticalCount}{' '}
            critical
          </Text>
        </View>
      </View>

      {/* KPI strip */}
      <View style={styles.kpiRow}>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>Monthly Profit</Text>
          <Text style={styles.kpiValue}>
            ₹{Math.round(kpi.monthlyProfit / 1000)}K
          </Text>
        </View>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>Stock Value</Text>
          <Text style={styles.kpiValue}>
            ₹{Math.round(kpi.stockValue / 1000)}K
          </Text>
        </View>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>Action</Text>
          <Text style={[styles.kpiValue, kpi.lowStockCount > 0 && { color: COLORS.red }]}>
            {kpi.lowStockCount}
          </Text>
        </View>
      </View>

      {/* Action cards */}
      <Text style={styles.sectionTitle}>
        {sortedUrgent.length > 0
          ? `🔴 ${sortedUrgent.length} need attention`
          : '🎉 All clear'}
      </Text>

      {sortedUrgent.length === 0 && (
        <View style={styles.allClearCard}>
          <Text style={styles.allClearText}>
            No urgent reorders today. Check back tomorrow.
          </Text>
        </View>
      )}

      {sortedUrgent.map((p) => (
        <View key={p.id} style={styles.actionCard}>
          <View style={styles.actionTop}>
            <Text style={styles.actionIcon}>{p.ico || '📦'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionName}>{p.name}</Text>
              <Text style={styles.actionMeta}>
                Stock: {p.stock} · ROP: {p.rop} · Order {p.eoq} units
              </Text>
            </View>
            <View
              style={[
                styles.statusPill,
                { backgroundColor: STATUS_COLORS[p.status]?.bg },
              ]}
            >
              <Text
                style={[
                  styles.statusPillText,
                  { color: STATUS_COLORS[p.status]?.fg },
                ]}
              >
                {STATUS_LABEL[p.status]}
              </Text>
            </View>
          </View>
          <View style={styles.actionBtnRow}>
            <TouchableOpacity
              style={styles.actionDismiss}
              onPress={() => dismiss(p.id)}
            >
              <Text style={styles.actionDismissText}>✓ Marked Ordered</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionView}
              onPress={() =>
                navigation.navigate('Products', { focusId: p.id })
              }
            >
              <Text style={styles.actionViewText}>View →</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </ScrollView>
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
  emptyBtnRow: { flexDirection: 'row', gap: 10 },
  btn: { paddingVertical: 11, paddingHorizontal: 16, borderRadius: 10 },
  btnPrimary: { backgroundColor: COLORS.ink },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  btnSecondary: { backgroundColor: COLORS.surface },
  btnSecondaryText: { color: COLORS.ink2, fontWeight: '700', fontSize: 13 },
  heroCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    marginBottom: 12,
  },
  heroLabel: {
    fontSize: 10,
    color: COLORS.muted,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  heroValue: {
    fontSize: 32,
    fontWeight: '800',
    color: COLORS.ink,
    marginVertical: 4,
  },
  heroBar: {
    height: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 4,
    overflow: 'hidden',
    marginVertical: 6,
  },
  heroBarFill: { height: '100%', borderRadius: 4 },
  heroStats: { flexDirection: 'row', gap: 14, marginTop: 4 },
  heroStat: { fontSize: 11, fontWeight: '600', color: COLORS.ink2 },
  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  kpiCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
  },
  kpiLabel: {
    fontSize: 9,
    color: COLORS.muted,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  kpiValue: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.ink,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.ink,
    marginBottom: 10,
    marginTop: 4,
  },
  allClearCard: {
    backgroundColor: COLORS.greenLight,
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
  },
  allClearText: { fontSize: 12, fontWeight: '600', color: COLORS.green },
  actionCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 8,
  },
  actionTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  actionIcon: { fontSize: 26 },
  actionName: { fontSize: 13, fontWeight: '700', color: COLORS.ink },
  actionMeta: { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusPillText: { fontSize: 10, fontWeight: '700' },
  actionBtnRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionDismiss: {
    flex: 1,
    backgroundColor: COLORS.greenLight,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionDismissText: { color: COLORS.green, fontWeight: '700', fontSize: 12 },
  actionView: {
    flex: 1,
    backgroundColor: COLORS.ink,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionViewText: { color: '#fff', fontWeight: '700', fontSize: 12 },
});
