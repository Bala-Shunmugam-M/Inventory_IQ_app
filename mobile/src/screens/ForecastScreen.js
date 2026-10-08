/**
 * Forecast Screen
 *
 * Per-product demand prediction: a trend line over recent sales history
 * blended with a 7-day moving average:
 *   forecast = 0.6 × Trend(next) + 0.4 × MA7
 *
 * Shows forecast accuracy (backtest: 1 − WAPE on the last 7 logged days),
 * a 90% range, trend per week, and a recommendation for the next order.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { loadProducts, forecastProduct, loadDemo } from '../lib/storage';
import { COLORS } from '../lib/theme';

export default function ForecastScreen({ navigation }) {
  const [products, setProducts] = useState([]);

  const refresh = useCallback(async () => {
    setProducts(await loadProducts());
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener('focus', refresh);
    refresh();
    return unsub;
  }, [navigation, refresh]);

  if (!products.length) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>📈</Text>
        <Text style={styles.emptyTitle}>No forecast available</Text>
        <Text style={styles.emptySub}>
          Add products and log a few days of sales to see ML-based predictions.
        </Text>
        <TouchableOpacity
          style={styles.demoBtn}
          onPress={async () => {
            await loadDemo();
            refresh();
          }}
        >
          <Text style={styles.demoBtnText}>🎮 Load Demo Data</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
    >
      <View style={styles.headerCard}>
        <Text style={styles.headerTitle}>📈 Demand Forecast</Text>
        <Text style={styles.headerSub}>
          Trend + 7-day moving average · 90% range
        </Text>
      </View>

      {products.map((p) => {
        const f = forecastProduct(p);
        const trendColor =
          f.trend === 'up'
            ? COLORS.red
            : f.trend === 'down'
            ? COLORS.green
            : COLORS.ink2;
        const trendIcon =
          f.trend === 'up' ? '📈' : f.trend === 'down' ? '📉' : '➡️';
        const trendLabel =
          f.trend === 'up' ? 'Rising' : f.trend === 'down' ? 'Falling' : 'Stable';
        const rec =
          f.trend === 'up'
            ? 'Increase next order — demand growing'
            : f.trend === 'down'
            ? 'Reduce next order — demand falling'
            : 'Maintain current order quantity';

        return (
          <View key={p.id} style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.icon}>{p.ico || '📦'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{p.name}</Text>
                <Text style={styles.subText}>
                  {p.history?.length || 0} days of history
                </Text>
              </View>
              <Text style={[styles.trendBadge, { color: trendColor }]}>
                {trendIcon} {trendLabel}
              </Text>
            </View>

            <View style={styles.statsGrid}>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Next Day</Text>
                <Text style={[styles.statValue, { color: COLORS.purple }]}>
                  {f.forecast}
                </Text>
                <Text style={styles.statHint}>±{f.ci} units</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Accuracy</Text>
                <Text
                  style={[
                    styles.statValue,
                    {
                      color:
                        f.accuracy == null
                          ? COLORS.ink2
                          : f.accuracy >= 80
                          ? COLORS.green
                          : f.accuracy >= 60
                          ? COLORS.amber
                          : COLORS.red,
                    },
                  ]}
                >
                  {f.accuracy == null ? '—' : `${f.accuracy}%`}
                </Text>
                <Text style={styles.statHint}>
                  {f.accuracy == null
                    ? 'Needs 7 days of sales'
                    : 'Last 7 days tested'}
                </Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>7-day Avg</Text>
                <Text style={[styles.statValue, { color: COLORS.blue }]}>
                  {f.ma7}
                </Text>
                <Text style={styles.statHint}>units/day</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Trend %</Text>
                <Text style={[styles.statValue, { color: trendColor }]}>
                  {f.trend === 'up' ? '+' : f.trend === 'down' ? '−' : ''}
                  {f.trendPct}%
                </Text>
                <Text style={styles.statHint}>per week</Text>
              </View>
            </View>

            <View style={styles.recBox}>
              <Text style={styles.recLabel}>Recommendation</Text>
              <Text style={styles.recText}>{rec}</Text>
            </View>
          </View>
        );
      })}

      <Text style={styles.footnote}>
        Forecasts improve with more sales history. Log sales daily for best
        results. The model blends a least-squares trend with a 7-day moving
        average (60/40). Accuracy = 1 − average % error when each of the last 7
        logged days is forecast from the days before it.
      </Text>
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
  demoBtn: {
    backgroundColor: COLORS.surface,
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  demoBtnText: { color: COLORS.ink2, fontWeight: '700', fontSize: 13 },
  headerCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 12,
  },
  headerTitle: { fontSize: 14, fontWeight: '800', color: COLORS.ink },
  headerSub: {
    fontSize: 11,
    color: COLORS.muted,
    fontWeight: '600',
    marginTop: 4,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { fontSize: 26 },
  name: { fontSize: 13, fontWeight: '700', color: COLORS.ink },
  subText: { fontSize: 10, color: COLORS.muted, fontWeight: '600', marginTop: 2 },
  trendBadge: { fontSize: 11, fontWeight: '700' },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
    gap: 8,
  },
  stat: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: COLORS.bg,
    padding: 10,
    borderRadius: 8,
  },
  statLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: COLORS.muted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  statValue: { fontSize: 22, fontWeight: '800', marginTop: 2 },
  statHint: { fontSize: 9, color: COLORS.muted, fontWeight: '600', marginTop: 2 },
  recBox: {
    marginTop: 12,
    backgroundColor: COLORS.blueLight,
    padding: 10,
    borderRadius: 8,
  },
  recLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: COLORS.blue,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  recText: { fontSize: 12, fontWeight: '700', color: COLORS.ink },
  footnote: {
    fontSize: 10,
    color: COLORS.muted,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 16,
  },
});
