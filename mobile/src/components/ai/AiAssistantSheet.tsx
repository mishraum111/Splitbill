import React, { useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Text } from '../Typography';
import { Btn, C, Chip, ErrorBox, Field, Sheet, s } from '../ui';
import { api } from '../../lib/api';
import { useApp } from '../../lib/context';
import { type BillInput, type Trip } from '../../lib/types';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  draftExpense?: BillInput | null;
  saved?: boolean;
};

type ProactiveSuggestion = {
  type: string;
  expenseId?: string;
  title: string;
  reason: string;
  requiresConfirmation: boolean;
};

export function AiAssistantSheet({
  trip,
  visible,
  onClose,
}: {
  trip: Trip;
  visible: boolean;
  onClose: () => void;
}) {
  const { addBill, mutate } = useApp();
  const nextId = useRef(1);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<ProactiveSuggestion[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: `Hi! Ask me anything about "${trip.name}" or give a command like: "Add ₹1,500 dinner expense and split it between everyone."`,
    },
  ]);

  const sendMessage = async (overrideText?: string) => {
    const query = (overrideText ?? input).trim();
    if (!query || busy) return;
    setError('');
    if (!overrideText) setInput('');
    const userMsg: ChatMessage = { id: `u_${nextId.current++}`, role: 'user', text: query };
    setMessages((prev) => [...prev, userMsg]);
    setBusy(true);
    try {
      const res = await api<{
        reply: string;
        requiresConfirmation: boolean;
        draftExpense?: BillInput | null;
        proactiveSuggestions?: ProactiveSuggestion[];
      }>(`/trips/${trip.id}/ai/assistant`, 'POST', {
        message: query,
        history: messages.slice(-6).map((m) => ({ role: m.role, text: m.text })),
      });
      if (res.proactiveSuggestions) setSuggestions(res.proactiveSuggestions);
      setMessages((prev) => [
        ...prev,
        {
          id: `a_${nextId.current++}`,
          role: 'assistant',
          text: res.reply,
          draftExpense: res.requiresConfirmation ? res.draftExpense : null,
        },
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const startVoiceInput = () => {
    setError('');
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const SpeechRec = (window as unknown as Record<string, unknown>).SpeechRecognition ||
        (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
      if (typeof SpeechRec === 'function') {
        const recognition = new (SpeechRec as any)();
        recognition.lang = 'en-IN';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        setListening(true);
        recognition.onresult = (event: any) => {
          const transcript = event.results?.[0]?.[0]?.transcript || '';
          setListening(false);
          if (transcript) {
            setInput(transcript);
            void sendMessage(transcript);
          }
        };
        recognition.onerror = () => {
          setListening(false);
          setError('Voice capture failed or microphone permission was denied.');
        };
        recognition.onend = () => setListening(false);
        recognition.start();
        return;
      }
    }
    setError('Tap the microphone icon on your device keyboard to dictate directly into the message box.');
  };

  const confirmDraft = async (msgId: string, draft: BillInput) => {
    setBusy(true);
    setError('');
    try {
      await addBill(trip.id, draft);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? { ...m, saved: true, text: `${m.text}\n\n✓ Confirmed and saved to ${trip.name}.` }
            : m,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} title="SplitBill AI Assistant" onClose={onClose}>
      <View style={s.wrap}>
        {[
          'Who has the highest outstanding balance?',
          'Generate a summary of our expenses',
          'Add 1500 dinner split equally',
        ].map((prompt) => (
          <Chip key={prompt} title={prompt} onPress={() => void sendMessage(prompt)} />
        ))}
      </View>

      {suggestions.length > 0 && (
        <View style={{ backgroundColor: C.pale, padding: 14, borderRadius: 18, gap: 8 }}>
          <Text style={s.eyebrow}>AGENT RECOMMENDATIONS</Text>
          {suggestions.map((sg, i) => (
            <View key={i} style={{ gap: 4 }}>
              <Text style={{ fontWeight: '700', fontSize: 12, color: C.forest }}>{sg.title}</Text>
              <Text style={{ fontSize: 11, color: C.muted }}>{sg.reason}</Text>
              {sg.type === 'recategorize' && sg.expenseId && (
                <Pressable
                  onPress={async () => {
                    const exp = trip.expenses.find((e) => e.id === sg.expenseId);
                    if (!exp) return;
                    const nextCat = sg.title.split(' to ')[1] || 'Other';
                    await mutate(`/trips/${trip.id}/expenses/${exp.id}`, 'PATCH', {
                      ...exp,
                      amount: String(exp.originalAmount / 100),
                      category: nextCat,
                    });
                    setSuggestions((prev) => prev.filter((_, idx) => idx !== i));
                  }}
                >
                  <Text style={s.link}>Confirm & apply category →</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}

      <View style={{ gap: 12 }}>
        {messages.map((m) => (
          <View
            key={m.id}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '88%',
              backgroundColor: m.role === 'user' ? C.forest : C.white,
              borderWidth: m.role === 'user' ? 0 : 1,
              borderColor: C.line,
              borderRadius: 20,
              padding: 15,
              gap: 10,
            }}
          >
            <Text style={{ color: m.role === 'user' ? '#F7FAEE' : C.dark, fontSize: 13, lineHeight: 20 }}>
              {m.text}
            </Text>
            {m.draftExpense && !m.saved && (
              <View style={{ backgroundColor: C.pale, padding: 12, borderRadius: 14, gap: 8 }}>
                <Text style={{ fontWeight: '800', fontSize: 13, color: C.forest }}>
                  Draft: {m.draftExpense.title} · {m.draftExpense.currency} {m.draftExpense.amount}
                </Text>
                <Text style={{ fontSize: 11, color: C.muted }}>
                  Category: {m.draftExpense.category} · {m.draftExpense.shares.length} participants
                </Text>
                <Btn
                  title="Confirm & save expense"
                  small
                  busy={busy}
                  onPress={() => void confirmDraft(m.id, m.draftExpense!)}
                />
              </View>
            )}
          </View>
        ))}
      </View>

      <ErrorBox text={error} />

      <View style={{ gap: 10 }}>
        <Field
          label="Ask or command in natural language"
          value={input}
          onChangeText={setInput}
          placeholder='e.g. "How much does Rahul owe me?"'
          onSubmitEditing={() => void sendMessage()}
        />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Btn
              title={listening ? 'Listening…' : 'Voice input'}
              icon={listening ? 'radio-outline' : 'mic-outline'}
              secondary
              onPress={startVoiceInput}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Btn title="Send" icon="send-outline" busy={busy} onPress={() => void sendMessage()} />
          </View>
        </View>
      </View>
    </Sheet>
  );
}
