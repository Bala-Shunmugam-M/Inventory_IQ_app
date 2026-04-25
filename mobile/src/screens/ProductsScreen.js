/**
 * Products Screen
 *
 * Full CRUD list. Filter by status (All / Urgent / Watch / Good).
 * Tap a card to edit, tap ＋ to add. Add modal computes ROP, EOQ
 * and ABC class automatically from inputs.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  loadProducts,
  addProduct,
  updateProduct,
  deleteProduct,
  buildProduct,
  loadDemo,
} from '../lib/storage';
import { COLORS, STATUS_LABEL, STATUS_COLORS } from '../lib/theme';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'urgent', label: '🔴 Urgent' },
  { key: 'watch', label: '🟡 Watch' },
  { key: 'good', label: '✅ Good' },
];

const LEAD_OPTIONS = [
  { v: 1, label: 'Same day' },
  { v: 3, label: '2–3 days' },
  { v: 7, label: '1 week' },
  { v: 14, label: '2 weeks' },
];

const blankForm = () => ({
  name: '',
  ico: '',
  stock: '',
  demand: '',
  cost: '',
  sell: '',
  supplier: '',
  lead: 3,
});

export default function ProductsScreen({ navigation, route }) {
  const [products, setProducts] = useState([]);
  const [filter, setFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(blankForm());

  const refresh = useCallback(async () => {
    const list = await loadProducts();
    setProducts(list);
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener('focus', refresh);
    refresh();
    return unsub;
  }, [navigation, refresh]);

  // Auto-open edit if navigated with focusId
  useEffect(() => {
    const focusId = route.params?.focusId;
    if (focusId && products.length > 0) {
      const p = products.find((x) => x.id === focusId);
      if (p) openEdit(p);
      navigation.setParams({ focusId: undefined });
    }
  }, [route.params?.focusId, products]);

  const openAdd = () => {
    setEditingId(null);
    setForm(blankForm());
    setModalOpen(true);
  };

  const openEdit = (p) => {
    setEditingId(p.id);
    setForm({
      name: p.name || '',
      ico: p.ico || '',
      stock: String(p.stock ?? ''),
      demand: String(p.demand ?? ''),
      cost: String(p.cost ?? ''),
      sell: String(p.sell ?? ''),
      supplier: p.supplier === '—' ? '' : p.supplier || '',
      lead: p.lead || 3,
    });
    setModalOpen(true);
  };

  const close = () => {
    setModalOpen(false);
    setEditingId(null);
  };

  const submit = async () => {
    if (!form.name.trim()) {
      Alert.alert('Missing field', 'Please enter a product name.');
      return;
    }
    const cost = parseFloat(form.cost) || 0;
    const sell = parseFloat(form.sell) || 0;
    if (cost <= 0) {
      Alert.alert('Invalid cost', 'Cost must be greater than 0.');
      return;
    }
    if (sell <= 0) {
      Alert.alert('Invalid sell price', 'Sell price must be greater than 0.');
      return;
    }
    if (editingId) {
      const built = buildProduct({ ...form, id: editingId });
      await updateProduct(editingId, {
        name: built.name,
        ico: built.ico,
        stock: built.stock,
        demand: built.demand,
        cost: built.cost,
        sell: built.sell,
        lead: built.lead,
        cls: built.cls,
        supplier: built.supplier,
        rop: built.rop,
        eoq: built.eoq,
        max: built.max,
      });
    } else {
      await addProduct(form);
    }
    await refresh();
    close();
  };

  const remove = async () => {
    if (!editingId) return;
    const p = products.find((x) => x.id === editingId);
    Alert.alert('Delete product?', `Remove "${p?.name}" — this cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteProduct(editingId);
          await refresh();
          close();
        },
      },
    ]);
  };

  const filtered = products.filter((p) => {
    if (filter === 'all') return true;
    if (filter === 'urgent') return p.status === 'critical' || p.status === 'order';
    if (filter === 'watch') return p.status === 'watch';
    if (filter === 'good') return p.status === 'good';
    return true;
  });

  const counts = {
    all: products.length,
    urgent: products.filter((p) => p.status === 'critical' || p.status === 'order').length,
    watch: products.filter((p) => p.status === 'watch').length,
    good: products.filter((p) => p.status === 'good').length,
  };

  if (!products.length) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>📦</Text>
        <Text style={styles.emptyTitle}>No products yet</Text>
        <Text style={styles.emptySub}>
          Add your first product or load 12 demo items to explore.
        </Text>
        <View style={styles.emptyBtnRow}>
          <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={openAdd}>
            <Text style={styles.btnPrimaryText}>＋ Add Product</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnSecondary]}
            onPress={async () => {
              await loadDemo();
              refresh();
            }}
          >
            <Text style={styles.btnSecondaryText}>🎮 Try Demo</Text>
          </TouchableOpacity>
        </View>
        {renderModal()}
      </View>
    );
  }

  function renderModal() {
    return (
      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={close}>
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ width: '100%' }}
          >
            <View style={styles.modal}>
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.modalTitle}>
                  {editingId ? '✏️ Edit Product' : '＋ Add New Product'}
                </Text>
                <Text style={styles.modalSub}>
                  Reorder point and EOQ are computed automatically.
                </Text>

                <Text style={styles.fieldLabel}>Product Name *</Text>
                <TextInput
                  style={styles.field}
                  value={form.name}
                  onChangeText={(v) => setForm({ ...form, name: v })}
                  placeholder="e.g. Aashirvaad Atta 5kg"
                />

                <View style={styles.fieldRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Icon (emoji)</Text>
                    <TextInput
                      style={styles.field}
                      value={form.ico}
                      onChangeText={(v) => setForm({ ...form, ico: v })}
                      placeholder="📦"
                      maxLength={2}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Current Stock *</Text>
                    <TextInput
                      style={styles.field}
                      value={form.stock}
                      onChangeText={(v) => setForm({ ...form, stock: v })}
                      placeholder="0"
                      keyboardType="numeric"
                    />
                  </View>
                </View>

                <View style={styles.fieldRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Daily Demand</Text>
                    <TextInput
                      style={styles.field}
                      value={form.demand}
                      onChangeText={(v) => setForm({ ...form, demand: v })}
                      placeholder="auto"
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Cost Price (₹) *</Text>
                    <TextInput
                      style={styles.field}
                      value={form.cost}
                      onChangeText={(v) => setForm({ ...form, cost: v })}
                      placeholder="0"
                      keyboardType="numeric"
                    />
                  </View>
                </View>

                <View style={styles.fieldRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Sell Price (₹) *</Text>
                    <TextInput
                      style={styles.field}
                      value={form.sell}
                      onChangeText={(v) => setForm({ ...form, sell: v })}
                      placeholder="0"
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Supplier</Text>
                    <TextInput
                      style={styles.field}
                      value={form.supplier}
                      onChangeText={(v) => setForm({ ...form, supplier: v })}
                      placeholder="optional"
                    />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>Delivery Lead Time</Text>
                <View style={styles.leadRow}>
                  {LEAD_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt.v}
                      style={[
                        styles.leadBtn,
                        form.lead === opt.v && styles.leadBtnActive,
                      ]}
                      onPress={() => setForm({ ...form, lead: opt.v })}
                    >
                      <Text
                        style={[
                          styles.leadBtnText,
                          form.lead === opt.v && { color: COLORS.blue },
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={styles.modalFooter}>
                  <TouchableOpacity style={styles.modalCancel} onPress={close}>
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  {editingId && (
                    <TouchableOpacity style={styles.modalDelete} onPress={remove}>
                      <Text style={styles.modalDeleteText}>🗑 Delete</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.modalSave} onPress={submit}>
                    <Text style={styles.modalSaveText}>
                      {editingId ? 'Save' : '✓ Save Product'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Products</Text>
        <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
          <Text style={styles.addBtnText}>＋</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsRow}
        contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 10 }}
      >
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.tab, filter === f.key && styles.tabActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.tabText, filter === f.key && { color: COLORS.blue }]}>
              {f.label} ({counts[f.key] || 0})
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
        {filtered.length === 0 && (
          <View style={styles.noMatch}>
            <Text style={styles.noMatchText}>No products in this category</Text>
          </View>
        )}
        {filtered.map((p) => {
          const sc = STATUS_COLORS[p.status] || STATUS_COLORS.good;
          const pct = Math.max(3, Math.min(100, Math.round((p.stock / p.max) * 100)));
          return (
            <TouchableOpacity
              key={p.id}
              style={styles.card}
              onPress={() => openEdit(p)}
              activeOpacity={0.7}
            >
              <View style={styles.cardTop}>
                <Text style={styles.cardIcon}>{p.ico || '📦'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardName}>{p.name}</Text>
                  <View style={styles.cardMeta}>
                    <View style={styles.classBadge}>
                      <Text style={styles.classBadgeText}>{p.cls || 'C'}</Text>
                    </View>
                    <Text style={styles.cardSupplier}>{p.supplier}</Text>
                  </View>
                </View>
                <View style={[styles.cardStatus, { backgroundColor: sc.bg }]}>
                  <Text style={[styles.cardStatusText, { color: sc.fg }]}>
                    {STATUS_LABEL[p.status]}
                  </Text>
                </View>
              </View>

              <View style={styles.stockRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stockNumber}>
                    <Text style={styles.stockCur}>{p.stock}</Text>
                    <Text style={styles.stockSep}> / </Text>
                    <Text style={styles.stockMax}>{p.max}</Text>
                  </Text>
                  <View style={styles.bar}>
                    <View
                      style={[
                        styles.barFill,
                        { width: `${pct}%`, backgroundColor: sc.fg },
                      ]}
                    />
                  </View>
                </View>
                <View style={styles.eoqBox}>
                  <Text style={styles.eoqLabel}>EOQ</Text>
                  <Text style={styles.eoqValue}>{p.eoq}</Text>
                </View>
              </View>

              {p.incoming > 0 && (
                <Text style={styles.incoming}>📦 +{p.incoming} arriving</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {renderModal()}
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
  emptyBtnRow: { flexDirection: 'row', gap: 10 },
  btn: { paddingVertical: 11, paddingHorizontal: 16, borderRadius: 10 },
  btnPrimary: { backgroundColor: COLORS.ink },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  btnSecondary: { backgroundColor: COLORS.surface },
  btnSecondaryText: { color: COLORS.ink2, fontWeight: '700', fontSize: 13 },
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
  headerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.ink },
  addBtn: {
    backgroundColor: COLORS.ink,
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addBtnText: { color: '#fff', fontSize: 20, fontWeight: '800' },
  tabsRow: {
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    flexGrow: 0,
  },
  tab: {
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 6,
  },
  tabActive: { backgroundColor: COLORS.blueLight },
  tabText: { fontSize: 11, fontWeight: '700', color: COLORS.ink2 },
  noMatch: { padding: 30, alignItems: 'center' },
  noMatchText: { fontSize: 12, fontWeight: '600', color: COLORS.muted },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginBottom: 8,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: { fontSize: 28 },
  cardName: { fontSize: 13, fontWeight: '700', color: COLORS.ink },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
  classBadge: {
    backgroundColor: COLORS.blueLight,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  classBadgeText: { fontSize: 9, fontWeight: '800', color: COLORS.blue },
  cardSupplier: { fontSize: 10, color: COLORS.muted, fontWeight: '600' },
  cardStatus: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  cardStatusText: { fontSize: 9, fontWeight: '700' },
  stockRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  stockNumber: { fontSize: 14 },
  stockCur: { fontWeight: '800', color: COLORS.ink, fontSize: 16 },
  stockSep: { color: COLORS.light, fontWeight: '600' },
  stockMax: { color: COLORS.muted, fontSize: 13, fontWeight: '600' },
  bar: { height: 5, backgroundColor: COLORS.surface, borderRadius: 3, marginTop: 4 },
  barFill: { height: '100%', borderRadius: 3 },
  eoqBox: {
    backgroundColor: COLORS.surface,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: 'center',
  },
  eoqLabel: { fontSize: 8, fontWeight: '700', color: COLORS.muted },
  eoqValue: { fontSize: 13, fontWeight: '800', color: COLORS.ink },
  incoming: {
    fontSize: 10,
    color: COLORS.blue,
    fontWeight: '700',
    marginTop: 6,
    backgroundColor: COLORS.blueLight,
    padding: 5,
    borderRadius: 5,
    alignSelf: 'flex-start',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(13,18,38,0.55)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    maxHeight: '88%',
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: COLORS.ink },
  modalSub: { fontSize: 11, color: COLORS.muted, marginTop: 2, marginBottom: 14 },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.ink2,
    marginBottom: 4,
    marginTop: 8,
  },
  field: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 11,
    fontSize: 13,
    backgroundColor: COLORS.bg,
    color: COLORS.ink,
  },
  fieldRow: { flexDirection: 'row', gap: 10 },
  leadRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  leadBtn: {
    flex: 1,
    minWidth: 70,
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  leadBtnActive: { backgroundColor: COLORS.blueLight, borderColor: COLORS.blue },
  leadBtnText: { fontSize: 11, fontWeight: '700', color: COLORS.ink2 },
  modalFooter: { flexDirection: 'row', gap: 8, marginTop: 18 },
  modalCancel: {
    flex: 1,
    backgroundColor: COLORS.surface,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalCancelText: { color: COLORS.ink2, fontWeight: '700', fontSize: 13 },
  modalDelete: {
    flex: 1,
    backgroundColor: COLORS.redLight,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalDeleteText: { color: COLORS.red, fontWeight: '700', fontSize: 13 },
  modalSave: {
    flex: 1.4,
    backgroundColor: COLORS.ink,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalSaveText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
