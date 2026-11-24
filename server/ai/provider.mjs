import { assert } from '../finance.mjs';

export function getAiConfig(env = process.env) {
  const geminiKey = String(env.GEMINI_API_KEY || '').trim();
  const openaiKey = String(env.OPENAI_API_KEY || '').trim();
  const geminiModel = String(env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
  const openaiModel = String(env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  const openaiBaseUrl = String(env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
  const timeoutMs = Math.max(5000, Math.min(60000, Number(env.AI_TIMEOUT_MS || 25000)));
  return {
    configured: Boolean(geminiKey || openaiKey),
    provider: geminiKey ? 'gemini' : openaiKey ? 'openai' : 'none',
    model: geminiKey ? geminiModel : openaiKey ? openaiModel : 'none',
    geminiKey,
    geminiModel,
    openaiKey,
    openaiBaseUrl,
    openaiModel,
    timeoutMs,
  };
}

function extractJsonObject(rawText) {
  const cleaned = String(rawText || '').trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : cleaned;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
  }
  return JSON.parse(candidate);
}

export function createAiClient({ env = process.env, request = fetch } = {}) {
  const cfg = getAiConfig(env);

  const generateJson = async ({ systemInstruction, prompt, attachment = null, temperature = 0.2 }) => {
    const current = getAiConfig(env);
    if (!current.configured) {
      return { ok: false, reason: 'AI_NOT_CONFIGURED', data: null };
    }
    try {
      if (current.provider === 'gemini') {
        const parts = [];
        if (attachment && attachment.data && attachment.mime) {
          parts.push({
            inline_data: {
              mime_type: attachment.mime,
              data: attachment.data,
            },
          });
        }
        parts.push({ text: prompt });

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(current.geminiModel)}:generateContent?key=${encodeURIComponent(current.geminiKey)}`;
        const response = await request(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemInstruction }] },
            contents: [{ role: 'user', parts }],
            generationConfig: {
              temperature,
              responseMimeType: 'application/json',
            },
          }),
          signal: AbortSignal.timeout(current.timeoutMs),
        });
        const payload = await response.json();
        if (!response.ok) {
          return {
            ok: false,
            reason: payload?.error?.message || `Gemini API HTTP ${response.status}`,
            data: null,
          };
        }
        const textOut = payload?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
        return { ok: true, provider: 'gemini', model: current.geminiModel, data: extractJsonObject(textOut) };
      }

      if (current.provider === 'openai') {
        const userContent = [{ type: 'text', text: prompt }];
        if (attachment && attachment.data && attachment.mime && attachment.mime.startsWith('image/')) {
          userContent.push({
            type: 'image_url',
            image_url: { url: `data:${attachment.mime};base64,${attachment.data}` },
          });
        }
        const response = await request(`${current.openaiBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${current.openaiKey}`,
          },
          body: JSON.stringify({
            model: current.openaiModel,
            temperature,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: userContent },
            ],
          }),
          signal: AbortSignal.timeout(current.timeoutMs),
        });
        const payload = await response.json();
        if (!response.ok) {
          return {
            ok: false,
            reason: payload?.error?.message || `OpenAI API HTTP ${response.status}`,
            data: null,
          };
        }
        const textOut = payload?.choices?.[0]?.message?.content || '';
        return { ok: true, provider: 'openai', model: current.openaiModel, data: extractJsonObject(textOut) };
      }
      return { ok: false, reason: 'AI_NOT_CONFIGURED', data: null };
    } catch (error) {
      return {
        ok: false,
        reason: error?.name === 'TimeoutError' ? 'AI provider request timed out' : String(error?.message || 'AI request failed'),
        data: null,
      };
    }
  };

  return {
    status: () => ({
      configured: cfg.configured,
      provider: cfg.provider,
      model: cfg.model,
    }),
    generateJson,
  };
}
