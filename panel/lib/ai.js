'use strict';
// Router AI panelu: tekst z Gemini albo z API zgodnego z OpenAI (Ollama, własny serwer). Klucze zna tylko panel.
const { HttpError, fetchJson, sleep } = require('./util');
const { UPSTREAM } = require('./accounts');
const { tr } = require('./i18n');

// Dostawcy tekstu. kind "openai" = API zgodne z OpenAI (POST {baseUrl}/chat/completions)
const TEXT_PROVIDERS = {
  gemini: { label: 'Google Gemini', kind: 'gemini' },
  // etykiety z tłumaczeniem jako gettery – język panelu jest znany dopiero w chwili użycia
  ollama: {
    get label() {
      return tr('Ollama (lokalnie)');
    },
    kind: 'openai',
    defaultBase: '',
    secret: 'ollamaKey',
    keyOptional: true,
    slow: true,
  },
  custom: {
    get label() {
      return tr('Własny (zgodny z OpenAI)');
    },
    kind: 'openai',
    defaultBase: '',
    secret: 'customKey',
    keyOptional: true,
  },
};
const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504]);

class AI {
  constructor(store) {
    this.store = store;
  }

  // ------------------------------------------------------------------ klucze i adresy
  // geminiTextKey – dawny osobny klucz do tekstu (store.js przenosi go do geminiApiKey)
  geminiKey() {
    const sg = this.store.secrets.global;
    return sg.geminiTextKey || sg.geminiApiKey || '';
  }

  openaiProvider(id) {
    const p = TEXT_PROVIDERS[id];
    if (!p || p.kind !== 'openai') throw new HttpError(400, tr('Nieznany dostawca tekstu: {0}', id));
    const cfg = (this.store.global.ai && this.store.global.ai.providers && this.store.global.ai.providers[id]) || {};
    const baseUrl = String(cfg.baseUrl || p.defaultBase || '').replace(/\/+$/, '');
    const key = this.store.secrets.global[p.secret] || '';
    if (!baseUrl) throw new HttpError(400, tr('{0}: brak adresu API (panel → Ustawienia → Dostawcy AI)', p.label));
    if (!key && !p.keyOptional) throw new HttpError(400, tr('{0}: brak klucza API (panel → Ustawienia → Dostawcy AI)', p.label));
    return { ...p, id, baseUrl, key };
  }

  providerConfigured(id) {
    if (id === 'gemini') return !!this.geminiKey();
    try {
      this.openaiProvider(id);
      return true;
    } catch (e) {
      return false;
    }
  }

  // ------------------------------------------------------------------ tekst
  async generateText(bot, { system, user, schema, maxTokens = 8192 }) {
    const c = bot.content;
    const chain = [{ provider: c.textProvider || 'gemini', model: c.textModel }];
    const errors = [];
    for (let i = 0; i < chain.length; i++) {
      const { provider, model } = chain[i];
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          if (!model) throw new HttpError(400, tr('nie wybrano modelu (panel → bot → Tekst i grafika)'));
          const text =
            provider === 'gemini'
              ? await this.geminiText({ model, system, user, schema, maxTokens, thinking: c.thinking })
              : await this.openaiText({ provider, model, system, user, schema, maxTokens });
          return { text, provider, model, fallbackUsed: i > 0, errors };
        } catch (e) {
          const label = `${(TEXT_PROVIDERS[provider] || {}).label || provider} (${model || '?'})`;
          const retry = attempt === 1 && (e.transient || e.status === 502);
          if (!retry) {
            errors.push(`${label}: ${e.message}`);
            break;
          }
          await sleep(Number(process.env.POSTER_AI_RETRY_MS) || 4000);
        }
      }
    }
    throw new HttpError(502, tr('AI nie wygenerowało tekstu – {0}', errors.join(' · ')));
  }

  async geminiText({ model, system, user, schema, maxTokens, thinking }) {
    const key = this.geminiKey();
    if (!key) throw new HttpError(400, tr('brak klucza Google Gemini (Ustawienia)'));
    const generationConfig = { responseMimeType: 'application/json', responseSchema: schema, maxOutputTokens: maxTokens };
    const think = thinking === 'low' ? thinkingConfigFor(model) : null;
    const call = async (withThinking) => {
      const r = await fetchJson(`${UPSTREAM.gemini}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: withThinking && think ? { ...generationConfig, thinkingConfig: think } : generationConfig,
        }),
        timeout: 180000,
      });
      return r;
    };
    let r = await call(true);
    // Model nie obsługuje ustawienia „myślenia” → ponów bez niego
    if (r.status === 400 && think && /thinking/i.test(r.text)) r = await call(false);
    if (!r.ok) throw apiFailure(r);
    const cand = ((r.data && r.data.candidates) || [])[0];
    const text = ((cand && cand.content && cand.content.parts) || [])
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join('')
      .trim();
    if (!text) {
      const reason = (cand && cand.finishReason) || (r.data && r.data.promptFeedback && r.data.promptFeedback.blockReason) || tr('brak');
      throw new HttpError(502, tr('pusta odpowiedź (powód: {0})', reason));
    }
    return text;
  }

  async openaiText({ provider, model, system, user, schema, maxTokens }) {
    const p = this.openaiProvider(provider);
    const headers = { 'content-type': 'application/json' };
    if (p.key) headers.authorization = `Bearer ${p.key}`;
    const messages = [
      {
        role: 'system',
        content: `${system}\n\nOdpowiedz WYŁĄCZNIE jednym poprawnym obiektem JSON (bez komentarzy i bez bloku kodu) zgodnym z tym schematem JSON Schema:\n${JSON.stringify(toJsonSchema(schema))}`,
      },
      { role: 'user', content: user },
    ];
    const call = (jsonMode) =>
      fetchJson(`${p.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.7,
          max_tokens: maxTokens,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
        timeout: p.slow ? 900000 : 180000,
      });
    let r = await call(true);
    // Część modeli nie obsługuje trybu JSON → ponów bez niego (i tak prosimy o JSON w poleceniu)
    if (r.status === 400 && /response_format|json/i.test(r.text)) r = await call(false);
    if (!r.ok) throw apiFailure(r);
    const msg = r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].message;
    const text = String((msg && msg.content) || '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .trim();
    if (!text) throw new HttpError(502, tr('pusta odpowiedź'));
    return text;
  }

  // ------------------------------------------------------------------ listy modeli i testy
  async listModels(provider) {
    if (provider === 'gemini') {
      const key = this.geminiKey();
      if (!key) throw new HttpError(400, tr('Najpierw zapisz klucz Google Gemini'));
      const r = await fetchJson(`${UPSTREAM.gemini}/v1beta/models?pageSize=1000`, { headers: { 'x-goog-api-key': key } });
      if (!r.ok) throw apiFailure(r);
      const text = [];
      for (const m of (r.data && r.data.models) || []) {
        const id = String(m.name || '').replace(/^models\//, '');
        const methods = m.supportedGenerationMethods || [];
        if (/^gemini/.test(id) && methods.includes('generateContent') && !/image|tts|embedding|audio|live|robotics|computer-use/.test(id))
          text.push({ id, name: m.displayName || id });
      }
      return { text };
    }
    const p = this.openaiProvider(provider);
    const r = await fetchJson(`${p.baseUrl}/models`, { headers: p.key ? { authorization: `Bearer ${p.key}` } : {}, timeout: 20000 });
    if (!r.ok) throw apiFailure(r);
    return { text: modelsOf(r.data) };
  }
}

// ---------------------------------------------------------------------------------------------- pomocnicze
function thinkingConfigFor(model) {
  if (/gemini-2\.5-flash/i.test(model)) return { thinkingBudget: 0 };
  if (/gemini-2\.5-pro/i.test(model)) return { thinkingBudget: 128 };
  if (/gemini-[3-9]/i.test(model)) return { thinkingLevel: 'low' };
  return null;
}

// Schemat Gemini (OBJECT/STRING/...) → JSON Schema (object/string/...) dla dostawców zgodnych z OpenAI
function toJsonSchema(s) {
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'type') out.type = String(v).toLowerCase();
    else if (k === 'propertyOrdering') continue;
    else if (k === 'properties') out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toJsonSchema(pv)]));
    else if (k === 'items') out.items = toJsonSchema(v);
    else out[k] = v;
  }
  return out;
}

function modelsOf(data) {
  const list = (data && (data.data || data.models)) || [];
  return list
    .map((m) => ({ id: String(m.id || m.name || ''), name: String(m.name || m.id || '') }))
    .filter((m) => m.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function apiFailure(r) {
  const d = r.data;
  const e0 = d && (Array.isArray(d) ? d[0] && d[0].error : d.error);
  const msg =
    (e0 && typeof e0 === 'object' && (e0.message || e0.code)) ||
    (typeof e0 === 'string' && e0) ||
    (d && (d.message || d.detail)) ||
    (d && Array.isArray(d.errors) && d.errors[0] && (d.errors[0].message || d.errors[0].code)) ||
    String(r.text || '').slice(0, 200);
  const e = new HttpError(
    r.status >= 400 && r.status < 500 && r.status !== 429 ? 400 : 502,
    `HTTP ${r.status}${msg ? ` – ${String(msg).slice(0, 300)}` : ''}`,
  );
  e.transient = TRANSIENT.has(r.status);
  e.upstreamStatus = r.status;
  return e;
}

// Rozpoznanie formatu po nagłówku pliku
function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  return null;
}

module.exports = { AI, TEXT_PROVIDERS, sniffImage, toJsonSchema };
