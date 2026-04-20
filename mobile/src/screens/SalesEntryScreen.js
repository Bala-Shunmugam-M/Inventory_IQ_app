import React, { useCallback, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, TextInput, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { loadSkus, saveSkus, getStatus } from '../lib/storage';
import { api } from '../lib/api';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function SalesEntryScreen() {
  const [skus, setSkus] = useState([]);
  const [entries, setEntries] = useState({});
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setSkus(await loadSkus());
    setEntries({});
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const saveAll = async () => {
    const keys = Object.keys(entries).filter(k => entries[k] !== '');
    if (keys.length === 0) { Alert.alert('No data', 'Enter at least one sales value.'); return; }
    setSaving(true);
    let clientId = await AsyncStorage.getItem('iq_mobile_client_id');
    if (!clientId) {
      clientId = 'mobile-' + Math.random().toString(36).slice(2, 10);
      await AsyncStorage.setItem('iq_mobile_client_id', clientId);
    }
    const updated = skus.map(s => {
      const sold = parseInt(entries[s.id], 10);
      if (isNaN(sold) || sold < 0) return s;
      const hist = [...(s.history || []), sold];
      if (hist.length > 180) hist.shift();
      return { ...s, stock: Math.max(0, s.stock - sold), history: hist };
    });
    setSkus(updated);
    await saveSkus(updated);
    // Fire-and-forget: also push to backend (optional)
    for (const k of keys) {
      const sold = parseInt(entries[k], 10);
      if (!isNaN(sold) && sold >= 0) {
        api.recordSale(clientId, parseInt(k, 10), sold).catch(() => {});
      }
    }
    setEntries({});
    setSaving(false);
    Alert.alert('✓ Saved', `${keys.length} entries recorded. Backend sync queued.`);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={styles.h1}>Daily Sales Entry</Text>
      <Text style={styles.sub}>Record today's units sold → feeds ML models</Text>

      {skus.map(s => {
        const st = getStatus(s, skus);
        const last7 = (s.history || []).slice(-7);
        const max = Math.max(1, ...last7, s.demand * 1.5);
        return (
          <View key={s.id} style={styles.row}>
            <View style={[styles.statusDot, { backgroundColor: st.color }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{s.name}</Text>
              <Text style={styles.meta}>Avg {s.demand}/day · Stock {s.stock}</Text>
              {/* Spark bar */}
              {last7.length > 0 && (
                <View style={styles.spark}>
                  {last7.map((v, i) => (
                    <View key={i} style={[styles.sparkBar, { height: Math.max(3, (v / max) * 18) }]} />
                  ))}
                </View>
              )}
            </View>
            <TextInput
              keyboardType="numeric"
              placeholder="units"
              placeholderTextColor="#475569"
              value={entries[s.id] || ''}
              onChangeText={(t) => setEntries(e => ({ ...e, [s.id]: t }))}
              style={styles.input}
            />
          </View>
        );
      })}

      <TouchableOpacity
        style={[styles.saveBtn, saving && { opacity: 0.6 }]}
        onPress={saveAll}
        disabled={saving}
      >
        <Text style={styles.saveBtnText}>{saving ? 'Saving...' : '✓ Save All & Retrain'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F1A', padding: 16 },
  h1: { color: '#E2E8F0', fontSize: 22, fontWeight: '800' },
  sub: { color: '#64748B', fontSize: 12, marginTop: 2, marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#121829', padding: 12, borderRadius: 10, marginBottom: 8, gap: 10 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  name: { color: '#E2E8F0', fontWeight: '600', fontSize: 13 },
  meta: { color: '#64748B', fontSize: 10, marginTop: 2 },
  spark: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, marginTop: 5, height: 20 },
  sparkBar: { flex: 1, backgroundColor: '#3B82F6AA', borderRadius: 1 },
  input: { width: 70, backgroundColor: '#0B0F1A', borderColor: '#1E293B', borderWidth: 1, borderRadius: 6, padding: 8, color: '#E2E8F0', textAlign: 'center', fontWeight: '700' },
  saveBtn: { backgroundColor: '#3B82F6', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 16 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
