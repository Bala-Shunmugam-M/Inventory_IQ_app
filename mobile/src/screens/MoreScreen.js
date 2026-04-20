import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadSkus, saveSkus, defaultSkus, getClientId } from '../lib/storage';
import { api } from '../lib/api';

export default function MoreScreen() {
  const [clientId, setClientId] = useState('');
  const [backendStatus, setBackendStatus] = useState('checking...');
  const [syncStatus, setSyncStatus] = useState('');

  useEffect(() => {
    (async () => {
      setClientId(await getClientId());
      try {
        const h = await api.health();
        setBackendStatus(h.status === 'healthy' ? '✓ Connected' : '⚠ Degraded');
      } catch (e) {
        setBackendStatus('✗ Offline');
      }
    })();
  }, []);

  const syncNow = async () => {
    setSyncStatus('Syncing...');
    try {
      const skus = await loadSkus();
      const r = await api.syncSkus(clientId, skus);
      setSyncStatus(`✓ Synced ${r.synced} SKUs to cloud`);
    } catch (e) {
      setSyncStatus('✗ Sync failed: ' + e.message);
    }
  };

  const restoreCloud = async () => {
    setSyncStatus('Restoring...');
    try {
      const r = await api.getSkus(clientId);
      if (r.count === 0) { setSyncStatus('No cloud data found for this device.'); return; }
      await saveSkus(r.skus);
      setSyncStatus(`✓ Restored ${r.count} SKUs from cloud`);
    } catch (e) {
      setSyncStatus('✗ Restore failed: ' + e.message);
    }
  };

  const resetLocal = async () => {
    Alert.alert('Reset data?', 'This will restore default SKUs and erase local edits.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: async () => {
          await saveSkus(JSON.parse(JSON.stringify(defaultSkus)));
          Alert.alert('✓ Reset', 'Default data restored.');
      }},
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={styles.h1}>Settings & More</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Device & Sync</Text>
        <InfoRow label="Device ID" value={clientId.slice(0, 22) + '…'} />
        <InfoRow label="Backend" value={backendStatus} valueColor={backendStatus.startsWith('✓') ? '#10B981' : '#F59E0B'} />
        <InfoRow label="API Base" value={api.base.replace('https://', '')} small />
        {syncStatus ? <Text style={styles.status}>{syncStatus}</Text> : null}
        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.btn} onPress={syncNow}>
            <Text style={styles.btnText}>☁️ Backup to Cloud</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={restoreCloud}>
            <Text style={[styles.btnText, { color: '#3B82F6' }]}>↓ Restore</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Data Management</Text>
        <Text style={styles.desc}>All inventory data is stored locally on your device via AsyncStorage. Optional cloud backup uses your Device ID as the sync key (no login required).</Text>
        <TouchableOpacity style={[styles.btn, styles.btnDanger]} onPress={resetLocal}>
          <Text style={[styles.btnText, { color: '#EF4444' }]}>⚠ Reset to Defaults</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>About InventoryIQ Mobile</Text>
        <Text style={styles.desc}>
          v4.0 — A companion mobile app to the InventoryIQ web system. Implements the full EOQ + ROP + Safety Stock + ABC framework with offline-first storage and optional cloud sync.
        </Text>
        <View style={{ marginTop: 8 }}>
          <Text style={styles.feature}>✓ Real-time inventory dashboard</Text>
          <Text style={styles.feature}>✓ ABC-adjusted safety stock</Text>
          <Text style={styles.feature}>✓ Daily sales entry → auto history</Text>
          <Text style={styles.feature}>✓ Server-side AI forecast (MA + trend)</Text>
          <Text style={styles.feature}>✓ Offline-first, cloud backup optional</Text>
        </View>
      </View>
    </ScrollView>
  );
}

function InfoRow({ label, value, valueColor, small }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoVal, valueColor && { color: valueColor }, small && { fontSize: 11 }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F1A', padding: 16 },
  h1: { color: '#E2E8F0', fontSize: 22, fontWeight: '800', marginBottom: 16 },
  card: { backgroundColor: '#121829', padding: 14, borderRadius: 10, marginBottom: 12, borderWidth: 1, borderColor: '#1E293B' },
  cardTitle: { color: '#E2E8F0', fontSize: 14, fontWeight: '700', marginBottom: 10 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomColor: '#1E293B', borderBottomWidth: 1 },
  infoLabel: { color: '#64748B', fontSize: 12 },
  infoVal: { color: '#E2E8F0', fontSize: 12.5, fontWeight: '600' },
  desc: { color: '#94A3B8', fontSize: 12, lineHeight: 18 },
  feature: { color: '#CBD5E1', fontSize: 12, marginTop: 2 },
  status: { color: '#3B82F6', fontSize: 12, marginTop: 8, fontFamily: 'Courier' },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btn: { flex: 1, backgroundColor: '#3B82F6', padding: 11, borderRadius: 8, alignItems: 'center' },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#3B82F6' },
  btnDanger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#EF4444', marginTop: 10 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
});
