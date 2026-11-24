import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text } from './Typography';
import { C, Icon, s } from './ui';
import { categoryInfo } from '../lib/categories';
import { api } from '../lib/api';
import { useApp } from '../lib/context';
import { currencies, money, type Trip } from '../lib/types';

type ForecastData = {
  currency: string;
  currentMonth: string;
  spentThisMonth: number;
  predictedMonthTotal: number;
  historicalMonthlyAverage: number;
  confidence: number;
  categoryInsights: {
    category: string;
    spentToDate: number;
    projectedMonthly: number;
    budgetLimit: number | null;
    overBudgetRisk: boolean;
    explanation: string;
  }[];
  recommendations: string[];
};

export function Analytics({ trip }: { trip: Trip }) {
  const { mode } = useApp();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'breakdown' | 'forecast'>('breakdown');
  const [forecast, setForecast] = useState<ForecastData | null>(null);
  const [loadedKey, setLoadedKey] = useState('');
  const forecastKey = `${trip.id}:${trip.expenses.length}`;
  const loading = open && view === 'forecast' && mode !== 'child' && loadedKey !== forecastKey;

  useEffect(() => {
    if (!open || view !== 'forecast' || mode === 'child') return;
    let alive = true;
    api<ForecastData>(`/trips/${trip.id}/ai/forecast`)
      .then((res) => {
        if (alive) {
          setForecast(res);
          setLoadedKey(forecastKey);
        }
      })
      .catch(() => {
        if (alive) setLoadedKey(forecastKey);
      });
    return () => { alive = false; };
  }, [open, view, trip.id, trip.expenses.length, mode, forecastKey]);

  const totals: Record<string, number> = {};
  for (const expense of trip.expenses)
    totals[expense.category] = (totals[expense.category] || 0) + expense.amount;
  const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const scale = 10 ** (currencies[trip.currency] ?? 2);

  return (
    <View style={[s.card, { padding: 18, gap: 18 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Graphs and AI spending intelligence"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={s.between}
      >
        <View style={s.row}>
          <Icon name="bar-chart-outline" color={C.accent} size={19} />
          <Text style={{ fontWeight: '700', color: C.dark }}>Where it went & AI Forecast</Text>
        </View>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} color={C.muted} />
      </Pressable>

      {open && (
        <>
          {mode !== 'child' && (
            <View style={{ flexDirection: 'row', backgroundColor: C.pale, borderRadius: 14, padding: 4, gap: 4 }}>
              {[
                { id: 'breakdown', label: 'Category Split' },
                { id: 'forecast', label: 'AI Forecast' },
              ].map((tab) => (
                <Pressable
                  key={tab.id}
                  onPress={() => setView(tab.id as 'breakdown' | 'forecast')}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    borderRadius: 10,
                    alignItems: 'center',
                    backgroundColor: view === tab.id ? C.white : 'transparent',
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: view === tab.id ? C.accent : C.muted }}>
                    {tab.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {view === 'breakdown' ? (
            <>
              <Text style={s.muted}>Confirmed expenses by category. Transfers are excluded.</Text>
              {!rows.length && <Text style={s.body}>Your first bill starts the story.</Text>}
              {rows.map(([category, amount]) => {
                const info = categoryInfo(category);
                return (
                  <View key={category} style={{ gap: 9 }}>
                    <View style={s.between}>
                      <Text style={{ color: C.dark, fontSize: 12 }}>{info.label}</Text>
                      <Text style={{ color: C.accent, fontWeight: '700', fontSize: 12 }}>
                        {money(amount, trip.currency)} · {Math.round((amount / Math.max(1, trip.total)) * 100)}%
                      </Text>
                    </View>
                    <View style={{ height: 9, borderRadius: 5, backgroundColor: C.pale, overflow: 'hidden' }}>
                      <View
                        style={{
                          height: 9,
                          borderRadius: 5,
                          width: `${(amount / Math.max(1, trip.total)) * 100}%`,
                          backgroundColor: info.color,
                        }}
                      />
                    </View>
                  </View>
                );
              })}
              <Text style={[s.label, { marginTop: 8 }]}>Each person’s share</Text>
              {trip.balances.map((member) => (
                <View key={member.id} style={s.between}>
                  <Text style={s.muted}>{member.name}</Text>
                  <Text style={s.label}>{money(member.spent, trip.currency)}</Text>
                </View>
              ))}
            </>
          ) : loading ? (
            <ActivityIndicator color={C.accent} />
          ) : forecast ? (
            <View style={{ gap: 14 }}>
              <View style={{ backgroundColor: C.pale, padding: 14, borderRadius: 16, gap: 6 }}>
                <View style={s.between}>
                  <Text style={s.eyebrow}>PREDICTED MONTHLY TOTAL</Text>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: C.accent }}>
                    {Math.round(forecast.confidence * 100)}% confidence
                  </Text>
                </View>
                <Text style={{ fontSize: 22, fontWeight: '800', color: C.forest }}>
                  {money(Math.round(forecast.predictedMonthTotal * scale), trip.currency)}
                </Text>
                <Text style={{ fontSize: 11, color: C.muted }}>
                  Spent this month: {money(Math.round(forecast.spentThisMonth * scale), trip.currency)}
                </Text>
              </View>

              {forecast.categoryInsights.map((ins) => (
                <View key={ins.category} style={{ gap: 6 }}>
                  <View style={s.between}>
                    <Text style={{ fontWeight: '700', fontSize: 12, color: C.dark }}>{ins.category}</Text>
                    <Text style={{ fontWeight: '700', fontSize: 12, color: ins.overBudgetRisk ? C.red : C.accent }}>
                      Est. {money(Math.round(ins.projectedMonthly * scale), trip.currency)}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 11, color: C.muted, lineHeight: 17 }}>{ins.explanation}</Text>
                </View>
              ))}

              {forecast.recommendations.length > 0 && (
                <View style={{ gap: 6, paddingTop: 6, borderTopWidth: 1, borderColor: C.line }}>
                  <Text style={s.label}>SAVING RECOMMENDATIONS</Text>
                  {forecast.recommendations.map((rec, i) => (
                    <Text key={i} style={{ fontSize: 12, color: C.dark, lineHeight: 18 }}>
                      • {rec}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          ) : (
            <Text style={s.muted}>Add bills to generate predictive spending insights.</Text>
          )}
        </>
      )}
    </View>
  );
}
