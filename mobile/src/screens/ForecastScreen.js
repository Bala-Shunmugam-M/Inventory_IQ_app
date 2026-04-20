import React, { useCallback, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Dimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { LineChart } from 'react-native-chart-kit';
import { loadSkus } from '../lib/storage';
import { api } from '../lib/api';

const W = Dimensions.get('window').width;

export default function ForecastScreen() {
  const [skus, setSkus] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const data = await loadSkus();
    setSkus(data);
    if (data.length && !selectedId) setSelectedId(data[0].id);
  }, [selectedId]);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const runForecast = async () => {
    const sku = skus.find(s => s.id === selectedId);
    if (!sku || !sku.history || sku.history.length < 3) {
      setForecast({ error: 'Need at least 3 days of history. Enter daily sales first.' });
      return;
    }
    setLoading(true);
    try {
      const res = await api.forecast({ history: sku.history, days: 14 });
      setForecast(res);
    } catch (e) {
      setForecast({ error: 'Backend unreachable: ' + e.message });
    }
    setLoading(false);
  };

  const selected = skus.find(s => s.id === selectedId);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={styles.h1}>AI Forecast</Text>
      <Text style={styles.sub}>7-day MA + linear trend · 90% CI · Server-computed</Text>

      <Text style={styles.label}>Select SKU</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
        {skus.map(s => (
          <TouchableOpacity
            key={s.id}
            style={[styles.chip, selectedId === s.id && styles.chipActive]}
            onPress={() => { setSelectedId(s.id); setForecast(null); }}
          >
            <Text style={[styles.chipText, selectedId === s.id && { color: '#fff' }]}>
              {s.name.split(' ').slice(0, 2).join(' ')}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <TouchableOpacity style={styles.runBtn} onPress={runForecast} disabled={loading}>
        <Text style={styles.runBtnText}>{loading ? 'Computing...' : '🤖 Generate 14-day forecast'}</Text>
      </TouchableOpacity>

      {loading && <ActivityIndicator size="large" color="#3B82F6" style={{ marginTop: 20 }} />}

      {forecast?.error && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{forecast.error}</Text>
        </View>
      )}

      {forecast && !forecast.error && (
        <>
          <View style={styles.statRow}>
            <Stat label="7-day MA" value={forecast.moving_avg} />
            <Stat label="Trend slope" value={forecast.trend_slope.toFixed(3)} />
            <Stat label="History" value={forecast.history_size + 'd'} />
          </View>

          <Text style={styles.chartTitle}>Next 14 Days</Text>
          <LineChart
            data={{
              labels: forecast.forecast.map((f, i) => (i % 3 === 0 ? 'D' + f.day : '')),
              datasets: [
                { data: forecast.forecast.map(f => f.predicted), color: () => '#3B82F6', strokeWidth: 2 },
                { data: forecast.forecast.map(f => f.upper_90), color: () => 'rgba(59,130,246,0.3)', strokeWidth: 1 },
                { data: forecast.forecast.map(f => f.lower_90), color: () => 'rgba(59,130,246,0.3)', strokeWidth: 1 },
              ],
            }}
            width={W - 32}
            height={200}
            chartConfig={{
              backgroundColor: '#121829',
              backgroundGradientFrom: '#121829',
              backgroundGradientTo: '#121829',
              decimalPlaces: 1,
              color: (o = 1) => `rgba(148,163,184,${o})`,
              labelColor: () => '#64748B',
              propsForDots: { r: '2.5' },
              propsForBackgroundLines: { stroke: '#1E293B' },
            }}
            bezier
            style={{ borderRadius: 10, marginVertical: 8 }}
          />

          <Text style={styles.chartTitle}>Forecast Table</Text>
          {forecast.forecast.slice(0, 7).map(f => (
            <View key={f.day} style={styles.frow}>
              <Text style={styles.fday}>Day {f.day}</Text>
              <Text style={styles.fval}>{f.predicted}</Text>
              <Text style={styles.fci}>CI: {f.lower_90}–{f.upper_90}</Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function Stat({ label, value }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statVal}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F1A', padding: 16 },
  h1: { color: '#E2E8F0', fontSize: 22, fontWeight: '800' },
  sub: { color: '#64748B', fontSize: 12, marginTop: 2, marginBottom: 16 },
  label: { color: '#94A3B8', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  chip: { backgroundColor: '#121829', borderWidth: 1, borderColor: '#1E293B', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginRight: 8 },
  chipActive: { backgroundColor: '#3B82F6', borderColor: '#3B82F6' },
  chipText: { color: '#94A3B8', fontSize: 12, fontWeight: '600' },
  runBtn: { backgroundColor: '#3B82F6', padding: 13, borderRadius: 10, alignItems: 'center' },
  runBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  errorCard: { backgroundColor: '#F59E0B20', borderWidth: 1, borderColor: '#F59E0B', padding: 12, borderRadius: 8, marginTop: 14 },
  errorText: { color: '#F59E0B', fontSize: 12.5 },
  statRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  stat: { flex: 1, backgroundColor: '#121829', padding: 10, borderRadius: 8 },
  statLabel: { color: '#64748B', fontSize: 10, textTransform: 'uppercase' },
  statVal: { color: '#E2E8F0', fontSize: 17, fontWeight: '700', marginTop: 2 },
  chartTitle: { color: '#E2E8F0', fontSize: 14, fontWeight: '700', marginTop: 18, marginBottom: 6 },
  frow: { flexDirection: 'row', backgroundColor: '#121829', padding: 10, borderRadius: 6, marginBottom: 4, alignItems: 'center' },
  fday: { color: '#94A3B8', width: 60, fontSize: 12 },
  fval: { color: '#E2E8F0', fontWeight: '700', width: 50, fontSize: 13 },
  fci: { color: '#64748B', flex: 1, textAlign: 'right', fontSize: 11 },
});
