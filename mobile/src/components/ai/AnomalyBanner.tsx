import React from 'react';
import { View } from 'react-native';
import { Text } from '../Typography';
import { Btn, C, Icon, s } from '../ui';

export type AnomalyReport = {
  flagged: boolean;
  confidence: number;
  level: 'none' | 'medium' | 'high';
  summary: string;
  flags: { code: string; severity: string; reason: string }[];
};

export function AnomalyBanner({
  report,
  onProceed,
  onDismiss,
}: {
  report: AnomalyReport | null;
  onProceed: () => void;
  onDismiss: () => void;
}) {
  if (!report || !report.flagged) return null;
  const isHigh = report.level === 'high';
  return (
    <View
      style={{
        backgroundColor: isHigh ? '#FDF0EC' : '#FDF6E7',
        borderWidth: 1,
        borderColor: isHigh ? '#E8B8AC' : '#E8D2A6',
        borderRadius: 18,
        padding: 16,
        gap: 12,
      }}
    >
      <View style={s.between}>
        <View style={[s.row, { gap: 8, flex: 1 }]}>
          <Icon name="shield-checkmark-outline" size={20} color={isHigh ? C.red : '#9A6715'} />
          <Text style={{ fontWeight: '800', fontSize: 13, color: isHigh ? C.red : '#7D510D', flex: 1 }}>
            Verification Check · {Math.round(report.confidence * 100)}% anomaly confidence
          </Text>
        </View>
      </View>
      <Text style={{ fontSize: 12, color: C.dark }}>{report.summary}</Text>
      {report.flags.map((f, idx) => (
        <Text key={idx} style={{ fontSize: 12, color: C.muted, lineHeight: 18 }}>
          • {f.reason}
        </Text>
      ))}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Btn title="Review bill" secondary small onPress={onDismiss} />
        </View>
        <View style={{ flex: 1 }}>
          <Btn title="Confirm & save" small onPress={onProceed} />
        </View>
      </View>
    </View>
  );
}
