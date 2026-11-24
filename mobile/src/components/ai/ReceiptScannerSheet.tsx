import React, { useState } from 'react';
import { View } from 'react-native';
import { Text } from '../Typography';
import { Btn, C, Chip, ErrorBox, Field, Icon, Sheet, s } from '../ui';
import { pickAttachment } from '../../lib/attachments';
import { api } from '../../lib/api';
import { currencies, type Attachment, type Trip } from '../../lib/types';

export type ExtractedItem = {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  assignedTo: string[];
};

export type ReceiptScanResult = {
  status: string;
  message?: string;
  fileHash?: string;
  merchant: string;
  date: string;
  currency: string;
  category: string;
  items: ExtractedItem[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  mathValidation?: { valid: boolean; expectedTotal?: number; discrepancy: number; warnings: string[] };
  confidence: number;
};

export function ReceiptScannerSheet({
  trip,
  isDemo,
  onClose,
  onApply,
}: {
  trip: Trip;
  isDemo: boolean;
  onClose: () => void;
  onApply: (payload: {
    title: string;
    amount: string;
    date: string;
    category: string;
    mode: 'equal' | 'exact';
    shares: { memberId: string; value: string }[];
    attachment?: Attachment;
    receiptAnalysis: ReceiptScanResult;
  }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [file, setFile] = useState<Attachment | null>(null);
  const [scan, setScan] = useState<ReceiptScanResult | null>(null);
  const [merchant, setMerchant] = useState('');
  const [date, setDate] = useState('');
  const [totalStr, setTotalStr] = useState('');
  const [items, setItems] = useState<ExtractedItem[]>([]);

  const handlePickAndScan = async () => {
    setError('');
    try {
      const picked = await pickAttachment(true);
      if (!picked || !picked.data) return;
      setFile(picked);
      setBusy(true);
      const res = await api<ReceiptScanResult>(`/trips/${trip.id}/ai/scan-receipt`, 'POST', {
        name: picked.name,
        mime: picked.mime,
        data: picked.data,
      });
      setScan(res);
      setMerchant(res.merchant || '');
      setDate(res.date || new Date().toISOString().slice(0, 10));
      setTotalStr(res.total > 0 ? String(res.total) : '');
      setItems(res.items || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleItemMember = (itemId: string, memberId: string) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        const exists = it.assignedTo.includes(memberId);
        return {
          ...it,
          assignedTo: exists
            ? it.assignedTo.filter((id) => id !== memberId)
            : [...it.assignedTo, memberId],
        };
      }),
    );
  };

  const applyExtracted = () => {
    const decimals = currencies[trip.currency] ?? 2;
    const finalTotal = Number(totalStr) || 0;
    if (finalTotal <= 0) {
      setError('Enter or verify a valid total amount before applying.');
      return;
    }

    if (items.length > 0) {
      const weights: Record<string, number> = Object.fromEntries(trip.members.map((m) => [m.id, 0]));
      let assignedSum = 0;
      for (const it of items) {
        if (!it.assignedTo.length) continue;
        const each = it.totalPrice / it.assignedTo.length;
        for (const mId of it.assignedTo) weights[mId] += each;
        assignedSum += it.totalPrice;
      }
      if (assignedSum > 0) {
        const scaleFactor = finalTotal / assignedSum;
        const rawShares = trip.members
          .map((m) => ({
            memberId: m.id,
            raw: Number((weights[m.id] * scaleFactor).toFixed(decimals)),
          }))
          .filter((s) => s.raw > 0);
        const sumRounded = Number(rawShares.reduce((a, b) => a + b.raw, 0).toFixed(decimals));
        const diff = Number((finalTotal - sumRounded).toFixed(decimals));
        if (rawShares.length > 0 && diff !== 0) {
          rawShares[0].raw = Number((rawShares[0].raw + diff).toFixed(decimals));
        }
        onApply({
          title: merchant.trim() || 'Scanned receipt',
          amount: finalTotal.toFixed(decimals),
          date,
          category: scan?.category || 'Other',
          mode: 'exact',
          shares: rawShares.map((s) => ({ memberId: s.memberId, value: s.raw.toFixed(decimals) })),
          attachment: file || undefined,
          receiptAnalysis: { ...scan!, merchant, date, total: finalTotal, items },
        });
        onClose();
        return;
      }
    }

    onApply({
      title: merchant.trim() || 'Scanned receipt',
      amount: finalTotal.toFixed(decimals),
      date,
      category: scan?.category || 'Other',
      mode: 'equal',
      shares: trip.members.map((m) => ({ memberId: m.id, value: '0' })),
      attachment: file || undefined,
      receiptAnalysis: { ...scan!, merchant, date, total: finalTotal, items },
    });
    onClose();
  };

  return (
    <Sheet visible title="AI Receipt & Bill Scanner" onClose={onClose}>
      <Text style={s.muted}>
        Upload a bill photo, screenshot, or PDF. AI extracts line items, taxes, and discounts so you can assign items per person.
      </Text>

      <Btn
        title={file ? `Rescan (${file.name})` : 'Upload receipt image or PDF'}
        icon="scan-outline"
        busy={busy}
        onPress={handlePickAndScan}
      />

      {scan?.message && (
        <View style={{ backgroundColor: C.pale, padding: 14, borderRadius: 16 }}>
          <Text style={{ fontSize: 12, color: C.dark }}>{scan.message}</Text>
        </View>
      )}

      {scan?.mathValidation?.warnings?.map((w, i) => (
        <View key={i} style={{ backgroundColor: '#FDF3E6', padding: 14, borderRadius: 16, flexDirection: 'row', gap: 8 }}>
          <Icon name="warning-outline" size={18} color="#B4691E" />
          <Text style={{ fontSize: 12, color: '#7A4510', flex: 1 }}>{w}</Text>
        </View>
      ))}

      {scan && (
        <View style={{ gap: 16 }}>
          <View style={s.between}>
            <Text style={s.eyebrow}>EXTRACTED PREVIEW (EDITABLE)</Text>
            {scan.confidence > 0 && (
              <Text style={{ fontSize: 11, fontWeight: '700', color: C.accent }}>
                {Math.round(scan.confidence * 100)}% confidence
              </Text>
            )}
          </View>

          <Field label="Merchant / Title" value={merchant} onChangeText={setMerchant} />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Field label={`Total (${trip.currency})`} value={totalStr} onChangeText={setTotalStr} keyboardType="decimal-pad" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
            </View>
          </View>

          {items.length > 0 && (
            <View style={{ gap: 10 }}>
              <Text style={s.label}>Assign line items to group members</Text>
              {items.map((item) => (
                <View key={item.id} style={[s.card, { padding: 14, gap: 10 }]}>
                  <View style={s.between}>
                    <Text style={{ fontWeight: '700', color: C.dark, flex: 1 }}>
                      {item.quantity > 1 ? `${item.quantity}× ` : ''}{item.name}
                    </Text>
                    <Text style={{ fontWeight: '800', color: C.accent }}>
                      {trip.currency} {item.totalPrice.toFixed(2)}
                    </Text>
                  </View>
                  <View style={s.wrap}>
                    {trip.members.map((m) => (
                      <Chip
                        key={m.id}
                        title={m.name.split(' ')[0]}
                        active={item.assignedTo.includes(m.id)}
                        onPress={() => toggleItemMember(item.id, m.id)}
                      />
                    ))}
                  </View>
                </View>
              ))}
            </View>
          )}

          <Btn title="Apply to bill form" icon="checkmark-circle-outline" onPress={applyExtracted} />
        </View>
      )}

      <ErrorBox text={error} />
    </Sheet>
  );
}
