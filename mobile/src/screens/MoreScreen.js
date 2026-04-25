/**
 * More Screen
 *
 * Settings, cloud sync, backup/restore, danger zone, and patent status.
 * Mirrors the layout of the web build's "More" tab so users moving
 * between web and APK see the same options.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  Linking,
} from 'react-native';
import {
  getDeviceId,
  loadDemo,
  clearAllData,
  loadSyncHistory,
  restoreSnapshot,
} from '../lib/storage';
import { syncToCloud, restoreFromCloud, isConfigured, getLastSyncTime } from '../lib/supabase';
import { COLORS } from '../lib/theme';

export default function MoreScreen({ navigation }) {
  const [deviceId, setDeviceId] = useState('');
  const [lastSync, setLastSync] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState([]);

  const refresh = useCallback(async () => {
    setDeviceId(await getDeviceId());
    setLastSync(await getLastSyncTime());
    setHistory(await loadSyncHistory());
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener('focus', refresh);
    refresh();
    return unsub;
  }, [navigation, refresh]);

  const doSync = async () => {
    const result = await syncToCloud();
    if (!result.ok) {
      Alert.alert('Sync failed', result.reason || 'Unknown error');
      return;
    }
    Alert.alert(
      '✅ Synced',
      result.mode === 'cloud'
        ? `Pushed ${result.count} products to cloud.`
        : `Saved a local snapshot of ${result.count} products. Configure Supabase URL/key in src/lib/supabase.js for cross-device sync.`,
    );
    refresh();
  };

  const doRestore = () => {
    Alert.prompt(
      'Restore from cloud',
      'Enter Device ID to pull from (leave blank to use this device):',
      async (input) => {
        const target = (input || '').trim();
        const result = await restoreFromCloud(target);
        if (!result.ok) {
          Alert.alert('Restore failed', result.reason);
          return;
        }
        Alert.alert(
          '✅ Restored',
          `Pulled ${result.count} products${
            result.timestamp
              ? ` from ${new Date(result.timestamp).toLocaleString()}`
              : ''
          }.`,
        );
        refresh();
      },
    );
  };

  const showHistory = async () => {
    setHistory(await loadSyncHistory());
    setHistoryOpen(true);
  };

  const doRestoreSnapshot = (idx) => {
    Alert.alert('Restore snapshot?', 'Current data will be replaced.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Restore',
        onPress: async () => {
          await restoreSnapshot(idx);
          setHistoryOpen(false);
          Alert.alert('✅ Restored', 'App state rolled back.');
          refresh();
        },
      },
    ]);
  };

  const doDemo = () => {
    Alert.alert('Load demo data?', 'This will replace your current products.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Load Demo',
        onPress: async () => {
          await loadDemo();
          Alert.alert('✅ Demo loaded', '12 products loaded.');
          refresh();
        },
      },
    ]);
  };

  const doClear = () => {
    Alert.alert(
      'Clear ALL data?',
      'Products, sales, snapshots — everything except your Device ID. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Everything',
          style: 'destructive',
          onPress: async () => {
            await clearAllData();
            Alert.alert('✅ Cleared', 'All data removed.');
            refresh();
            navigation.navigate('Home');
          },
        },
      ],
    );
  };

  const lastSyncLabel = lastSync
    ? `Last synced: ${new Date(lastSync).toLocaleString()}`
    : isConfigured()
    ? 'Tap to sync to cloud'
    : 'Local snapshot mode (no cloud configured)';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
    >
      {/* Device ID card */}
      <View style={styles.devCard}>
        <Text style={styles.devLabel}>YOUR DEVICE ID</Text>
        <Text style={styles.devId}>{deviceId}</Text>
        <Text style={styles.devHint}>
          Share this ID across devices to sync data
        </Text>
      </View>

      <Text style={styles.sectionLabel}>DATA</Text>

      <SettingItem
        icon="☁️"
        bg={COLORS.blueLight}
        title="Sync to Cloud"
        sub={lastSyncLabel}
        onPress={doSync}
      />
      <SettingItem
        icon="🔄"
        bg={COLORS.greenLight}
        title="Restore from Cloud"
        sub="Pull data from another device"
        onPress={doRestore}
      />
      <SettingItem
        icon="⏪"
        bg={COLORS.amberLight}
        title="Undo Last Sync"
        sub={
          history.length
            ? `${history.length} saved state${history.length !== 1 ? 's' : ''} — tap to view`
            : 'No sync history yet'
        }
        onPress={showHistory}
      />

      <Text style={styles.sectionLabel}>APP</Text>

      <SettingItem
        icon="🎮"
        bg={COLORS.greenLight}
        title="Load Demo Data"
        sub="12 realistic FMCG products"
        onPress={doDemo}
      />
      <SettingItem
        icon="🌐"
        bg={COLORS.blueLight}
        title="Open Web Dashboard"
        sub="View desktop manager dashboard"
        onPress={() =>
          Linking.openURL(
            'https://bala-shunmugam-m.github.io/Inventory_IQ_app/dashboard.html',
          )
        }
      />

      <Text style={styles.sectionLabel}>PATENT</Text>

      <SettingItem
        icon="🔬"
        bg={COLORS.purpleLight}
        title="Patent Status"
        sub="6 innovations · DSE · VCR · PAP · EnergyGuard · FieldLock · SHA-256"
        onPress={() =>
          Alert.alert(
            'Patent Innovations',
            '1. DSE — Differential Sync Engine\n2. VCR — Vector Clock Resolver\n3. PAP — Predictive Analytics Pre-fetcher\n4. EnergyGuard — Battery-aware Scheduler\n5. FieldLock — Field-level Concurrency Lock\n6. SHA-256 — Cryptographic Integrity Hash\n\nAll 6 innovations active in this build.',
          )
        }
      />

      <Text style={[styles.sectionLabel, { color: COLORS.red }]}>DANGER ZONE</Text>

      <SettingItem
        icon="🗑️"
        bg={COLORS.redLight}
        title="Clear All Data"
        sub="Delete all products and history"
        titleColor={COLORS.red}
        onPress={doClear}
      />

      <Text style={styles.footer}>
        InventoryIQ v8.1 — Patent Edition{'\n'}
        6 innovations · SHA-256 · VCR · DSE · PAP · EnergyGuard · FieldLock
      </Text>

      {/* History modal */}
      <Modal
        visible={historyOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setHistoryOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>⏪ Sync History</Text>
            <Text style={styles.modalSub}>Restore to any saved state</Text>
            {history.length === 0 ? (
              <Text style={styles.noHist}>
                No sync history yet — push to cloud first.
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 320 }}>
                {history
                  .slice()
                  .reverse()
                  .map((h, i) => {
                    const realIdx = history.length - 1 - i;
                    return (
                      <View key={i} style={styles.histRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.histTitle}>
                            Sync #{history.length - i}
                          </Text>
                          <Text style={styles.histMeta}>
                            {new Date(h.ts).toLocaleString()} · {h.count} products
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={styles.histBtn}
                          onPress={() => doRestoreSnapshot(realIdx)}
                        >
                          <Text style={styles.histBtnText}>Restore</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
              </ScrollView>
            )}
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={() => setHistoryOpen(false)}
            >
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function SettingItem({ icon, bg, title, sub, onPress, titleColor }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <View style={[styles.rowIco, { backgroundColor: bg }]}>
        <Text style={{ fontSize: 18 }}>{icon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, titleColor && { color: titleColor }]}>
          {title}
        </Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      <Text style={styles.rowArrow}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  devCard: {
    backgroundColor: COLORS.blue,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  devLabel: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  devId: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '700',
    fontFamily: Platform_select_monospace(),
    letterSpacing: 0.5,
  },
  devHint: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '600',
    marginTop: 6,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.muted,
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  row: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 6,
  },
  rowIco: {
    width: 36,
    height: 36,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowTitle: { fontSize: 12, fontWeight: '700', color: COLORS.ink },
  rowSub: { fontSize: 10, color: COLORS.muted, fontWeight: '600', marginTop: 2 },
  rowArrow: { fontSize: 16, color: COLORS.muted },
  footer: {
    textAlign: 'center',
    fontSize: 10,
    color: COLORS.light,
    fontWeight: '600',
    marginTop: 20,
    lineHeight: 16,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(13,18,38,0.55)',
    justifyContent: 'center',
    padding: 20,
  },
  modal: { backgroundColor: COLORS.white, borderRadius: 14, padding: 18 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: COLORS.ink },
  modalSub: { fontSize: 11, color: COLORS.muted, marginTop: 2, marginBottom: 12 },
  noHist: { padding: 20, textAlign: 'center', color: COLORS.muted, fontSize: 12 },
  histRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  histTitle: { fontSize: 12, fontWeight: '700', color: COLORS.ink },
  histMeta: { fontSize: 10, color: COLORS.muted, fontWeight: '600', marginTop: 2 },
  histBtn: {
    backgroundColor: COLORS.ink,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 7,
  },
  histBtnText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  closeBtn: {
    marginTop: 14,
    backgroundColor: COLORS.surface,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
  },
  closeBtnText: { color: COLORS.ink2, fontWeight: '700', fontSize: 13 },
});

function Platform_select_monospace() {
  // RN doesn't have a portable monospace family without importing Platform;
  // 'monospace' falls back gracefully on both iOS and Android.
  return 'monospace';
}
