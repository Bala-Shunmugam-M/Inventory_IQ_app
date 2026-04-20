import React, { useCallback, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { loadSkus, calcSS, calcROP, getStatus, abcClass, Z } from '../lib/storage';

export default function DashboardScreen() {
  const [skus, setSkus] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const data = await loadSkus();
    setSkus(data);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const alerts = skus.filter(s => {
    const st = getStatus(s, skus);
    return st.key === 'reorder' || st.key === 'critical' || st.key === 'stockout';
  });
  const totalValue = skus.reduce((a, s) => a + s.stock * s.cost, 0);
  const inStock = skus.filter(s => getStatus(s, skus).key === 'good').length;

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#3B82F6" />}
      contentContainerStyle={{ paddingBottom: 30 }}
    >
      <View style={styles.header}>
        <Text style={styles.h1}>Inventory Health</Text>
        <Text style={styles.sub}>Real-time stock status across all SKUs</Text>
      </View>

      <View style={styles.kpiRow}>
        <View style={[styles.kpi, { borderLeftColor: '#10B981' }]}>
          <Text style={styles.kpiLabel}>In Stock</Text>
          <Text style={styles.kpiVal}>{inStock}</Text>
          <Text style={styles.kpiMeta}>of {skus.length} SKUs</Text>
        </View>
        <View style={[styles.kpi, { borderLeftColor: '#F59E0B' }]}>
          <Text style={styles.kpiLabel}>Alerts</Text>
          <Text style={styles.kpiVal}>{alerts.length}</Text>
          <Text style={styles.kpiMeta}>Action needed</Text>
        </View>
      </View>
      <View style={styles.kpiRow}>
        <View style={[styles.kpi, { borderLeftColor: '#3B82F6', flex: 1 }]}>
          <Text style={styles.kpiLabel}>Inventory Value</Text>
          <Text style={styles.kpiVal}>₹{(totalValue / 1000).toFixed(1)}K</Text>
          <Text style={styles.kpiMeta}>At cost</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Active Alerts</Text>
      {alerts.length === 0 && (
        <View style={styles.empty}><Text style={styles.emptyText}>✓ All SKUs healthy — no alerts</Text></View>
      )}
      {alerts.map(s => {
        const st = getStatus(s, skus);
        const cls = abcClass(s, skus);
        const ss = calcSS(s, Z[cls]);
        const rop = calcROP(s, ss);
        return (
          <View key={s.id} style={[styles.alertCard, { borderLeftColor: st.color }]}>
            <View style={styles.alertHead}>
              <Text style={styles.skuName}>{s.name}</Text>
              <View style={[styles.tag, { backgroundColor: st.color + '30', borderColor: st.color }]}>
                <Text style={[styles.tagText, { color: st.color }]}>{st.label}</Text>
              </View>
            </View>
            <Text style={styles.alertBody}>Stock: {s.stock} · ROP: {rop} · SS: {ss}</Text>
            <Text style={styles.alertMeta}>Class {cls} · Lead time: {s.leadtime}d · Daily demand: {s.demand}</Text>
          </View>
        );
      })}

      <Text style={styles.sectionTitle}>All SKUs</Text>
      {skus.map(s => {
        const st = getStatus(s, skus);
        const cls = abcClass(s, skus);
        return (
          <View key={s.id} style={styles.skuRow}>
            <View style={[styles.dot, { backgroundColor: st.color }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.skuTitle}>{s.name}</Text>
              <Text style={styles.skuSub}>Stock {s.stock} · {s.demand}/day · Class {cls}</Text>
            </View>
            <Text style={[styles.statusPill, { color: st.color }]}>{st.label}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F1A', padding: 16 },
  header: { marginBottom: 16 },
  h1: { color: '#E2E8F0', fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  sub: { color: '#64748B', fontSize: 13, marginTop: 4 },
  kpiRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  kpi: { flex: 1, backgroundColor: '#121829', padding: 14, borderRadius: 10, borderLeftWidth: 3 },
  kpiLabel: { color: '#94A3B8', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 },
  kpiVal: { color: '#E2E8F0', fontSize: 24, fontWeight: '800', marginTop: 4 },
  kpiMeta: { color: '#64748B', fontSize: 10, marginTop: 2 },
  sectionTitle: { color: '#E2E8F0', fontSize: 15, fontWeight: '700', marginTop: 22, marginBottom: 10 },
  empty: { backgroundColor: '#121829', padding: 18, borderRadius: 10, alignItems: 'center' },
  emptyText: { color: '#10B981', fontSize: 13 },
  alertCard: { backgroundColor: '#121829', padding: 14, borderRadius: 10, borderLeftWidth: 3, marginBottom: 8 },
  alertHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  skuName: { color: '#E2E8F0', fontWeight: '700', fontSize: 14, flex: 1 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5, borderWidth: 1 },
  tagText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  alertBody: { color: '#CBD5E1', fontSize: 12 },
  alertMeta: { color: '#64748B', fontSize: 11, marginTop: 3 },
  skuRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#121829', padding: 12, borderRadius: 8, marginBottom: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  skuTitle: { color: '#E2E8F0', fontSize: 13, fontWeight: '600' },
  skuSub: { color: '#64748B', fontSize: 11, marginTop: 2 },
  statusPill: { fontSize: 10, fontWeight: '700' },
});
