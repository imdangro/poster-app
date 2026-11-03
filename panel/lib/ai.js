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
// Przerwa między próbami (POSTER_AI_RETRY_MS – krótsza w testach). Przebieg bota przy przeciążeniu dostawcy: kolejne
// rundy po 4×, 8× i 15× tej przerwy (16, 32 i 60 s – razem ok. 2 min), ale nie dłużej niż PATIENT_MAX_MS od startu.
const retryMs = () => Number(process.env.POSTER_AI_RETRY_MS) || 4000;
const PATIENT_ROUNDS = [4, 8, 15];
const PATIENT_MAX_MS = 5 * 60 * 1000;
// n8n czeka na tekst najwyżej 20 min (węzeł „AI: wybierz news i napisz posty”): przebieg bota mieści się w 19 min razem
// z ponowieniami i dostawcą zapasowym – inaczej panel pracowałby dalej nad tekstem, na który n8n już nie czeka
// (Ollama na słabym sprzęcie: jedno zapytanie do 15 min)
const patientDeadlineMs = () => Number(process.env.POSTER_AI_DEADLINE_MS) || 19 * 60 * 1000;

class AI {
  constructor(store) {
    this.store = store;
  }

  // ------------------------------------------------------------------ klucze i adresy
  geminiKey() {
    return this.store.secrets.global.geminiApiKey || '';
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
  // patient – przebieg bota (n8n czeka na tekst do 20 min): gdy dostawca jest przeciążony albo ma limit zapytań
  // (HTTP 429/5xx), kolejne rundy prób z rosnącymi przerwami, zanim przyjdzie alert. Edytor, /post z Telegrama
  // i seria postów dostają błąd od razu – mają własne wyjście (tekst autora albo teksty z planu).
  async generateText(bot, { system, user, schema, maxTokens = 8192 }, { patient = false } = {}) {
    const c = bot.content;
    let chain = [{ provider: c.textProvider || 'gemini', model: c.textModel }];
    const waits = patient ? PATIENT_ROUNDS.map((x) => x * retryMs()) : [];
    const started = Date.now();
    const deadline = patient ? started + patientDeadlineMs() : Infinity;
    const left = () => deadline - Date.now();
    const lasting = []; // błędy, których ponowienie nie naprawi (klucz, model) – zostają w opisie
    for (let round = 0; ; round++) {
      const errors = [...lasting];
      const again = []; // dostawcy z chwilowym błędem – próbujemy ich w kolejnej rundzie
      for (const step of chain) {
        const { provider, model } = step;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            if (!model) throw new HttpError(400, tr('nie wybrano modelu (panel → bot → Tekst i grafika)'));
            if (left() < 1000)
              throw new HttpError(504, tr('skończył się czas na tekst ({0} min)', Math.round((deadline - started) / 60000)));
            const text =
              provider === 'gemini'
                ? await this.geminiText({ model, system, user, schema, maxTokens, thinking: c.thinking, left })
                : await this.openaiText({ provider, model, system, user, schema, maxTokens, left });
            return { text, provider, model, fallbackUsed: !!step.fallback, errors };
          } catch (e) {
            const label = `${(TEXT_PROVIDERS[provider] || {}).label || provider} (${model || '?'})`;
            const retry = attempt === 1 && (e.transient || e.status === 502) && left() > retryMs();
            if (!retry) {
              errors.push(`${label}: ${e.message}`);
              if (e.transient) again.push(step);
              else lasting.push(errors.at(-1));
              break;
            }
            await sleep(retryMs());
          }
        }
      }
      const why = errors.join(' · ');
      if (round >= waits.length || !again.length || Date.now() - started > PATIENT_MAX_MS || left() < waits[round] + 1000) {
        if (!round) throw new HttpError(502, tr('AI nie wygenerowało tekstu – {0}', why));
        const min = Math.max(1, Math.round((Date.now() - started) / 60000));
        throw new HttpError(502, tr('AI nie wygenerowało tekstu mimo ponawiania przez {0} min – {1}', min, why));
      }
      await sleep(waits[round]);
      chain = again;
    }
  }

  // left() – ile ms zostało na cały tekst (przebieg bota); każde zapytanie kończy się najpóźniej wtedy
  async geminiText({ model, system, user, schema, maxTokens, thinking, left = () => Infinity }) {
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
        timeout: Math.max(1000, Math.min(180000, left())),
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

  async openaiText({ provider, model, system, user, schema, maxTokens, left = () => Infinity }) {
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
        timeout: Math.max(1000, Math.min(p.slow ? 900000 : 180000, left())),
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

module.exports = { AI, TEXT_PROVIDERS, toJsonSchema };
