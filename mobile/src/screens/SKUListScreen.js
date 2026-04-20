import React, { useCallback, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, TextInput, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { loadSkus, saveSkus, calcSS, calcROP, calcEOQ, abcClass, Z } from '../lib/storage';

export default function SKUListScreen() {
  const [skus, setSkus] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [stockEdit, setStockEdit] = useState('');

  const refresh = useCallback(async () => {
    setSkus(await loadSkus());
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const startEdit = (sku) => {
    setEditingId(sku.id);
    setStockEdit(String(sku.stock));
  };

  const saveStock = async (sku) => {
    const n = parseInt(stockEdit, 10);
    if (isNaN(n) || n < 0) { Alert.alert('Invalid', 'Enter a non-negative number'); return; }
    const updated = skus.map(s => s.id === sku.id ? { ...s, stock: n } : s);
    setSkus(updated);
    await saveSkus(updated);
    setEditingId(null);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={styles.h1}>SKU Manager</Text>
      <Text style={styles.sub}>{skus.length} products · Tap stock value to edit</Text>

      {skus.map(s => {
        const cls = abcClass(s, skus);
        const ss = calcSS(s, Z[cls]);
        const rop = calcROP(s, ss);
        const eoq = calcEOQ(s);
        return (
          <View key={s.id} style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.title}>{s.name}</Text>
              <View style={[styles.classBadge, {
                backgroundColor: cls === 'A' ? '#EF444430' : cls === 'B' ? '#F59E0B30' : '#64748B30',
                borderColor: cls === 'A' ? '#EF4444' : cls === 'B' ? '#F59E0B' : '#64748B',
              }]}>
                <Text style={{ color: cls === 'A' ? '#EF4444' : cls === 'B' ? '#F59E0B' : '#94A3B8', fontWeight: '700', fontSize: 10 }}>
                  Class {cls}
                </Text>
              </View>
            </View>
            <Text style={styles.subtle}>{s.category} · ₹{s.cost} cost · ₹{s.sellprice} sell</Text>

            <View style={styles.metricGrid}>
              <Metric label="Stock" value={
                editingId === s.id ? (
                  <TextInput
                    value={stockEdit}
                    onChangeText={setStockEdit}
                    keyboardType="numeric"
                    style={styles.stockInput}
                    onBlur={() => saveStock(s)}
                    autoFocus
                  />
                ) : (
                  <TouchableOpacity onPress={() => startEdit(s)}>
                    <Text style={styles.metricVal}>{s.stock}</Text>
                  </TouchableOpacity>
                )
              } />
              <Metric label="Demand/day" value={<Text style={styles.metricVal}>{s.demand}</Text>} />
              <Metric label="Safety Stk" value={<Text style={styles.metricVal}>{ss}</Text>} />
              <Metric label="ROP" value={<Text style={styles.metricVal}>{rop}</Text>} />
              <Metric label="EOQ" value={<Text style={styles.metricVal}>{eoq}</Text>} />
              <Metric label="Lead time" value={<Text style={styles.metricVal}>{s.leadtime}d</Text>} />
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

function Metric({ label, value }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <View>{value}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F1A', padding: 16 },
  h1: { color: '#E2E8F0', fontSize: 22, fontWeight: '800' },
  sub: { color: '#64748B', fontSize: 12, marginTop: 2, marginBottom: 16 },
  card: { backgroundColor: '#121829', padding: 14, borderRadius: 10, marginBottom: 10, borderWidth: 1, borderColor: '#1E293B' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: '#E2E8F0', fontWeight: '700', fontSize: 14, flex: 1, marginRight: 8 },
  subtle: { color: '#64748B', fontSize: 11, marginTop: 2, marginBottom: 10 },
  classBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: { width: '31%', backgroundColor: '#0B0F1A', padding: 8, borderRadius: 6 },
  metricLabel: { color: '#64748B', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 },
  metricVal: { color: '#E2E8F0', fontSize: 16, fontWeight: '700', marginTop: 2 },
  stockInput: { color: '#3B82F6', fontSize: 16, fontWeight: '700', marginTop: 2, borderBottomColor: '#3B82F6', borderBottomWidth: 1, padding: 0 },
});
