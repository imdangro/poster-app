'use strict';
// Magazyn danych panelu (katalog data/panel na NAS-ie):
//   config.json  – boty i ustawienia globalne (bez sekretów)
//   secrets.json – klucze API i tokeny kont (chmod 600, nigdy nie trafiają do n8n ani do przeglądarki)
//   state.json   – stan pracy: ostatnie terminy harmonogramu, historia uruchomień, offset Telegrama
//   dedup/<bot>.json – pamięć już widzianych newsów (osobno dla każdego bota)
const fs = require('fs');
const path = require('path');
const { readJson, writeJsonAtomic, randomId, HttpError } = require('./util');
const { INTERVALS, ALL_DAYS, JITTERS } = require('./schedule');
const { LANGUAGES, lang, tr } = require('./i18n');

const DEFAULTS = {
  textModel: 'gemini-3.8-flash',
  graphVersion: 'v24.0',
  apifyActorId: 'apidojo~tweet-scraper',
};
const X_SOURCES = ['rsshub', 'apify', 'none'];
const TEXT_PROVIDER_IDS = ['gemini', 'ollama', 'custom'];
// skąd grafika: zdjęcie ze źródła | post z linkiem (podgląd robi platforma) | bez grafiki
const IMAGE_MODES = ['source', 'link', 'none'];
const MAX_RUNS = 400;
// język postów nowego bota – wartość trafia do promptu AI (po polsku); w panelu pokazujemy ją przetłumaczoną
const defaultPostLanguage = () => (lang() === 'en' ? 'angielski' : 'polski');

function defaultGlobal() {
  return {
    // język panelu: '' = jeszcze niewybrany (przeglądarka decyduje, serwer pisze po polsku)
    ui: { language: '' },
    telegram: { chatId: '', adminIds: [] },
    x: { clientId: '', redirectUri: '' },
    meta: { graphVersion: DEFAULTS.graphVersion },
    apify: { actorId: DEFAULTS.apifyActorId },
    ai: defaultAi(),
  };
}

function defaultAi() {
  return {
    // adresy API dostawców tekstu zgodnych z OpenAI (puste = domyślny adres dostawcy)
    providers: {
      ollama: { baseUrl: '' },
      custom: { baseUrl: '' },
    },
  };
}

function defaultBot(id, name) {
  return {
    id,
    name: name || tr('Nowy bot'),
    paused: true,
    createdAt: new Date().toISOString(),
    mode: 'news',
    topic: '',
    brandName: '',
    language: defaultPostLanguage(),
    instructions: '',
    sources: { rss: [], xSource: 'rsshub', xHandles: [], xRssTemplate: '', apifyMaxItems: 40, maxAgeHours: 12, maxCandidates: 25 },
    content: {
      textProvider: 'gemini',
      textModel: DEFAULTS.textModel,
      thinking: 'low', // „myślenie” modelu Gemini: low = taniej, default = ustawienie modelu
      imageMode: 'source',
    },
    // jitter: losowe przesunięcie terminów o 0–N minut (0 = dokładnie o czasie)
    schedule: { mode: 'interval', every: 4, from: 8, to: 20, hours: [8, 12, 16, 20], minute: 0, jitter: 0, days: [...ALL_DAYS] },
    publishing: {
      x: false,
      facebook: false,
    },
    // czat Telegram tylko tego bota (PRO); puste = czat z Ustawień
    telegram: { chatId: '' },
    accounts: { x: null, meta: null },
  };
}

// ---------------------------------------------------------------------------------------------- walidacja
const str = (v, max, def = '') => {
  const s = typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim();
  return (s || def).slice(0, max);
};
const int = (v, min, max, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const bool = (v, def = false) =>
  typeof v === 'boolean' ? v : v === undefined ? def : ['1', 'true', 'tak', 'on', 'yes'].includes(String(v).toLowerCase());
const oneOf = (v, list, def) => (list.includes(v) ? v : def);
const modelName = (v, def) => {
  const s = str(v, 120).replace(/^models\//, '');
  // Gemini: gemini-3.8-flash · OpenRouter: meta-llama/llama-3.3-70b-instruct:free · Ollama: llama3.1:8b
  return /^[A-Za-z0-9@][A-Za-z0-9@._:\/\-]*$/.test(s) ? s : def;
};
const isHttpUrl = (s) => /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(s);
const chatIdOk = (s) => s === '' || /^-?\d{1,20}$/.test(s) || /^@[A-Za-z0-9_]{4,64}$/.test(s);

function sanitizeBot(input, existing) {
  const b = JSON.parse(JSON.stringify(existing));
  const i = input || {};
  const errors = [];

  if ('name' in i) {
    const name = str(i.name, 60);
    if (name) b.name = name;
    else errors.push(tr('Podaj nazwę bota'));
  }
  if ('topic' in i) b.topic = str(i.topic, 400);
  if ('brandName' in i) b.brandName = str(i.brandName, 80);
  if ('language' in i) b.language = str(i.language, 40, defaultPostLanguage());
  if ('instructions' in i) b.instructions = str(i.instructions, 3000);

  const s = i.sources || {};
  if (Array.isArray(s.rss)) {
    const rss = [];
    for (const f of s.rss.slice(0, 60)) {
      const url = str(f && f.url, 1000);
      if (!url) continue;
      if (!isHttpUrl(url)) {
        errors.push(tr('Niepoprawny adres RSS: {0}', url.slice(0, 80)));
        continue;
      }
      rss.push({ label: str(f.label, 60), url });
    }
    b.sources.rss = rss;
  }
  if ('xSource' in s) b.sources.xSource = oneOf(s.xSource, X_SOURCES, 'rsshub');
  if (Array.isArray(s.xHandles)) {
    const handles = [];
    for (const h of s.xHandles.slice(0, 60)) {
      const v = str(h, 40)
        .replace(/^@/, '')
        .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '')
        .replace(/\/.*$/, '');
      if (!v) continue;
      if (!/^[A-Za-z0-9_]{1,15}$/.test(v)) errors.push(tr('Niepoprawna nazwa profilu X: {0}', v));
      else if (!handles.some((x) => x.toLowerCase() === v.toLowerCase())) handles.push(v);
    }
    b.sources.xHandles = handles;
  }
  if ('xRssTemplate' in s) {
    const t = str(s.xRssTemplate, 300);
    if (t && (!isHttpUrl(t) || !t.includes('{handle}'))) errors.push(tr('Szablon RSS dla X musi być adresem http(s) z {handle}'));
    else b.sources.xRssTemplate = t;
  }
  if ('apifyMaxItems' in s) b.sources.apifyMaxItems = int(s.apifyMaxItems, 5, 500, 40);
  if ('maxAgeHours' in s) b.sources.maxAgeHours = int(s.maxAgeHours, 1, 168, 12);
  if ('maxCandidates' in s) b.sources.maxCandidates = int(s.maxCandidates, 3, 60, 25);

  const c = i.content || {};
  if ('textProvider' in c) b.content.textProvider = oneOf(c.textProvider, TEXT_PROVIDER_IDS, 'gemini');
  if ('textModel' in c) b.content.textModel = modelName(c.textModel, b.content.textProvider === 'gemini' ? DEFAULTS.textModel : '');
  if ('thinking' in c) b.content.thinking = oneOf(c.thinking, ['low', 'default'], 'low');
  if ('imageMode' in c) b.content.imageMode = oneOf(c.imageMode, IMAGE_MODES, 'source');

  const sc = i.schedule || {};
  if ('mode' in sc) b.schedule.mode = oneOf(sc.mode, ['interval', 'hours'], 'interval');
  if ('every' in sc) b.schedule.every = INTERVALS.includes(Number(sc.every)) ? Number(sc.every) : 4;
  if ('from' in sc) b.schedule.from = int(sc.from, 0, 23, 8);
  if ('to' in sc) b.schedule.to = int(sc.to, 0, 23, 20);
  if (Array.isArray(sc.hours))
    b.schedule.hours = [...new Set(sc.hours.map((h) => int(h, 0, 23, -1)).filter((h) => h >= 0))].sort((x, y) => x - y);
  if ('minute' in sc) b.schedule.minute = int(sc.minute, 0, 59, 0);
  if ('jitter' in sc) b.schedule.jitter = JITTERS.includes(Number(sc.jitter)) ? Number(sc.jitter) : 0;
  if (Array.isArray(sc.days)) b.schedule.days = [...new Set(sc.days.map((d) => int(d, 1, 7, 0)).filter(Boolean))].sort();
  if (b.schedule.mode === 'hours' && !b.schedule.hours.length) errors.push(tr('Wybierz co najmniej jedną godzinę uruchomienia'));
  if (!b.schedule.days.length) errors.push(tr('Wybierz co najmniej jeden dzień tygodnia'));

  const p = i.publishing || {};
  const flags = ['x', 'facebook'];
  for (const k of flags) if (k in p) b.publishing[k] = bool(p[k]);

  if ('paused' in i) b.paused = bool(i.paused);

  if (errors.length) throw new HttpError(400, errors.join(' · '), { errors });
  return b;
}

function sanitizeGlobal(input, existing) {
  const g = JSON.parse(JSON.stringify(existing));
  const i = input || {};
  const errors = [];
  if (i.ui && 'language' in i.ui) g.ui.language = oneOf(i.ui.language, ['', ...LANGUAGES], g.ui.language);
  if (i.telegram) {
    if ('chatId' in i.telegram) {
      const id = str(i.telegram.chatId, 70);
      if (!chatIdOk(id)) errors.push(tr('Niepoprawne ID czatu Telegram'));
      else g.telegram.chatId = id;
    }
    if ('adminIds' in i.telegram) {
      const list = (Array.isArray(i.telegram.adminIds) ? i.telegram.adminIds : String(i.telegram.adminIds || '').split(/[\s,;]+/))
        .map((x) => str(x, 20))
        .filter(Boolean);
      if (list.some((x) => !/^\d{1,20}$/.test(x))) errors.push(tr('ID administratorów Telegram to liczby rozdzielone przecinkami'));
      else g.telegram.adminIds = [...new Set(list)];
    }
  }
  if (i.x) {
    if ('clientId' in i.x) g.x.clientId = str(i.x.clientId, 200);
    if ('redirectUri' in i.x) {
      const u = str(i.x.redirectUri, 300);
      if (u && !isHttpUrl(u)) errors.push(tr('Callback URI dla X musi być adresem http(s)'));
      else g.x.redirectUri = u;
    }
  }
  if (i.meta && 'graphVersion' in i.meta) {
    const v = str(i.meta.graphVersion, 10, DEFAULTS.graphVersion);
    if (!/^v\d{1,2}\.\d$/.test(v)) errors.push(tr('Wersja Graph API ma format v24.0'));
    else g.meta.graphVersion = v;
  }
  if (i.apify && 'actorId' in i.apify) g.apify.actorId = str(i.apify.actorId, 120, DEFAULTS.apifyActorId);
  if (i.ai) {
    const a = i.ai;
    const url = (v, what) => {
      const u = str(v, 300).replace(/\/+$/, '');
      if (u && !isHttpUrl(u)) {
        errors.push(tr('{0}: adres API musi zaczynać się od http:// lub https://', what));
        return null;
      }
      return u;
    };
    for (const id of Object.keys(defaultAi().providers)) {
      if (a.providers && a.providers[id] && 'baseUrl' in a.providers[id]) {
        const u = url(a.providers[id].baseUrl, id);
        if (u !== null) g.ai.providers[id] = { ...g.ai.providers[id], baseUrl: u };
      }
    }
  }
  if (errors.length) throw new HttpError(400, errors.join(' · '), { errors });
  return g;
}

// ---------------------------------------------------------------------------------------------- magazyn
class Store {
  constructor(dir, env = process.env, filesDir = '/files') {
    this.dir = dir;
    this.filesDir = filesDir;
    fs.mkdirSync(path.join(dir, 'dedup'), { recursive: true, mode: 0o700 });
    this.files = {
      config: path.join(dir, 'config.json'),
      secrets: path.join(dir, 'secrets.json'),
      state: path.join(dir, 'state.json'),
    };
    const config = readJson(this.files.config, null);
    this.secrets = readJson(this.files.secrets, { global: {}, bots: {} });
    this.state = readJson(this.files.state, {});
    this.state.schedule = this.state.schedule || {};
    this.state.runs = this.state.runs || [];
    this.state.telegram = this.state.telegram || { offset: 0, chats: [] };
    this.state.recentTopics = this.state.recentTopics || {};
    this.secrets.global = this.secrets.global || {};
    this.secrets.bots = this.secrets.bots || {};
    this.migrated = false;
    if (config) {
      // konfiguracja sprzed wersji angielskiej – panel zostaje po polsku (bez względu na język przeglądarki)
      const hadLanguage = !!(config.global && config.global.ui);
      this.config = config;
      this.config.global = { ...defaultGlobal(), ...config.global };
      for (const k of Object.keys(defaultGlobal())) this.config.global[k] = { ...defaultGlobal()[k], ...config.global[k] };
      if (!hadLanguage) this.config.global.ui.language = 'pl';
      const ai = defaultAi();
      const cur = config.global.ai || {};
      this.config.global.ai = {
        providers: Object.fromEntries(
          Object.keys(ai.providers).map((id) => [id, { ...ai.providers[id], ...((cur.providers || {})[id] || {}) }]),
        ),
      };
      this.config.bots = (config.bots || []).map((b) => upgradeBot(mergeDefaults(defaultBot(b.id), b)));
      if (upgradeSecrets(this.secrets.global)) this.saveSecrets();
    } else {
      this.config = { version: 1, global: defaultGlobal(), bots: [] };
      this.migrateFromEnv(env);
      this.migrated = true;
      this.saveConfig();
      this.saveSecrets();
    }
    this._stateTimer = null;
  }

  // Pierwsze uruchomienie: przenosimy dotychczasowe ustawienia z .env (przekazane do kontenera panelu).
  migrateFromEnv(env) {
    const e = (k) => String(env[k] || '').trim();
    const list = (k) =>
      e(k)
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    const g = this.config.global;
    g.telegram.chatId = e('TELEGRAM_CHAT_ID');
    g.telegram.adminIds = list('TELEGRAM_ADMIN_IDS').filter((x) => /^\d+$/.test(x));
    g.x.clientId = e('X_CLIENT_ID');
    if (/^v\d+\.\d$/.test(e('META_GRAPH_VERSION'))) g.meta.graphVersion = e('META_GRAPH_VERSION');
    if (e('APIFY_ACTOR_ID')) g.apify.actorId = e('APIFY_ACTOR_ID');
    const sg = this.secrets.global;
    const setSecret = (key, envKey) => e(envKey) && (sg[key] = e(envKey));
    setSecret('geminiApiKey', 'GEMINI_API_KEY');
    setSecret('telegramBotToken', 'TELEGRAM_BOT_TOKEN');
    setSecret('xClientSecret', 'X_CLIENT_SECRET');
    setSecret('apifyToken', 'APIFY_TOKEN');

    const hasBot = e('POSTER_TOPIC') || e('NEWS_RSS_FEEDS') || e('X_HANDLES');
    if (!hasBot) return;
    const id = randomId();
    const rss = [];
    for (const entry of list('NEWS_RSS_FEEDS')) {
      const pipe = entry.indexOf('|');
      const url = (pipe > 0 ? entry.slice(pipe + 1) : entry).trim();
      if (isHttpUrl(url)) rss.push({ label: pipe > 0 ? entry.slice(0, pipe).trim().slice(0, 60) : '', url });
    }
    const base = defaultBot(id, (e('POSTER_BRAND_NAME') || e('POSTER_TOPIC') || tr('Mój bot')).slice(0, 60));
    const input = {
      topic: e('POSTER_TOPIC'),
      brandName: e('POSTER_BRAND_NAME'),
      language: e('POST_LANGUAGE') || 'polski',
      sources: {
        rss,
        xSource: X_SOURCES.includes(e('X_SOURCE')) ? e('X_SOURCE') : 'rsshub',
        xHandles: list('X_HANDLES').filter((h) => /^@?[A-Za-z0-9_]{1,15}$/.test(h)),
        xRssTemplate: e('X_RSS_URL_TEMPLATE').includes('{handle}') ? e('X_RSS_URL_TEMPLATE') : '',
        apifyMaxItems: e('APIFY_MAX_ITEMS') || 40,
        maxAgeHours: e('MAX_NEWS_AGE_HOURS') || 12,
        maxCandidates: e('MAX_CANDIDATES') || 25,
      },
      content: { textModel: e('GEMINI_TEXT_MODEL') || DEFAULTS.textModel },
      publishing: {
        x: bool(e('ENABLE_X')),
        facebook: bool(e('ENABLE_FACEBOOK')),
      },
    };
    let bot;
    try {
      bot = sanitizeBot(input, base);
    } catch (err) {
      console.warn(tr('Migracja z .env: pominięto niepoprawne wartości –'), err.message);
      bot = sanitizeBot({ topic: input.topic, brandName: input.brandName, language: input.language }, base);
    }
    // Dotychczasowy bot działał według stałego harmonogramu 8/12/16/20 – zostaje aktywny.
    bot.paused = false;
    const sb = (this.secrets.bots[id] = {});
    if (e('META_PAGE_ID') && e('META_PAGE_ACCESS_TOKEN')) {
      bot.accounts.meta = {
        pageId: e('META_PAGE_ID'),
        pageName: '',
        connectedAt: new Date().toISOString(),
      };
      sb.meta = { pageToken: e('META_PAGE_ACCESS_TOKEN') };
    }
    this.config.bots.push(bot);
    this.migratedBotId = id;
  }

  saveConfig() {
    writeJsonAtomic(this.files.config, this.config, 0o600);
  }
  saveSecrets() {
    writeJsonAtomic(this.files.secrets, this.secrets, 0o600);
  }
  saveState(now = false) {
    if (now) {
      clearTimeout(this._stateTimer);
      this._stateTimer = null;
      writeJsonAtomic(this.files.state, this.state, 0o600);
      return;
    }
    if (this._stateTimer) return;
    this._stateTimer = setTimeout(() => {
      this._stateTimer = null;
      try {
        writeJsonAtomic(this.files.state, this.state, 0o600);
      } catch (e) {
        console.error(tr('Zapis state.json nie powiódł się:'), e.message);
      }
    }, 500);
  }

  get global() {
    return this.config.global;
  }
  get bots() {
    return this.config.bots;
  }
  bot(id) {
    return this.config.bots.find((b) => b.id === id) || null;
  }
  requireBot(id) {
    const b = this.bot(id);
    if (!b) throw new HttpError(404, tr('Nie ma takiego bota (może został usunięty)'));
    return b;
  }
  botSecrets(id) {
    return (this.secrets.bots[id] = this.secrets.bots[id] || {});
  }

  // Wersja LITE ma jednego bota (więcej botów, kopie ustawień i tryb strony są w wersji PRO)
  addBot({ name } = {}) {
    if (this.config.bots.length) throw new HttpError(403, tr('Wersja LITE ma jednego bota – więcej botów daje wersja PRO.'));
    const bot = defaultBot(randomId(), str(name, 60) || tr('Nowy bot'));
    bot.paused = true; // nowy bot startuje wstrzymany – najpierw konfiguracja
    this.config.bots.push(bot);
    this.saveConfig();
    return bot;
  }

  updateBot(id, input) {
    const idx = this.config.bots.findIndex((b) => b.id === id);
    if (idx < 0) throw new HttpError(404, tr('Nie ma takiego bota'));
    const next = sanitizeBot(input, this.config.bots[idx]);
    this.config.bots[idx] = next;
    this.saveConfig();
    return next;
  }

  deleteBot(id) {
    const idx = this.config.bots.findIndex((b) => b.id === id);
    if (idx < 0) throw new HttpError(404, tr('Nie ma takiego bota'));
    this.config.bots.splice(idx, 1);
    delete this.secrets.bots[id];
    delete this.state.schedule[id];
    delete this.state.recentTopics[id];
    if (this.state.recentImages) delete this.state.recentImages[id];
    this.saveConfig();
    this.saveSecrets();
    this.saveState();
    try {
      fs.unlinkSync(this.dedupFile(id));
    } catch (e) {}
  }

  updateGlobal(input) {
    this.config.global = sanitizeGlobal(input, this.config.global);
    this.saveConfig();
    return this.config.global;
  }

  // ------------------------------------------------------------------ historia uruchomień
  addRun(run) {
    this.state.runs.unshift(run);
    if (this.state.runs.length > MAX_RUNS) this.state.runs.length = MAX_RUNS;
    this.saveState();
    return run;
  }
  run(id) {
    return this.state.runs.find((r) => r.id === id) || null;
  }
  updateRun(id, patch) {
    const r = this.run(id);
    if (!r) return null;
    Object.assign(r, patch, { updatedAt: new Date().toISOString() });
    this.saveState();
    return r;
  }

  // ------------------------------------------------------------------ deduplikacja newsów
  dedupFile(id) {
    return path.join(this.dir, 'dedup', `${id.replace(/[^a-z0-9]/gi, '')}.json`);
  }
  dedupLoad(id) {
    return readJson(this.dedupFile(id), { keys: {} });
  }
  dedupSave(id, d, now = Date.now()) {
    // Pamiętamy maks. 20 000 kluczy / 30 dni
    const cutoff = now - 30 * 86400 * 1000;
    let entries = Object.entries(d.keys).filter(([, t]) => t >= cutoff);
    if (entries.length > 20000) entries = entries.sort((a, b) => b[1] - a[1]).slice(0, 20000);
    d.keys = Object.fromEntries(entries);
    writeJsonAtomic(this.dedupFile(id), d, 0o600);
  }
  // Zwraca tylko nowe elementy i zapamiętuje je (jak węzeł „Remove Duplicates” w n8n, ale osobno dla bota).
  dedupFilter(id, items, keyOf = (x) => x.id) {
    const d = this.dedupLoad(id);
    const now = Date.now();
    const fresh = [];
    for (const it of items) {
      const k = String(keyOf(it) || '').slice(0, 500);
      if (!k || d.keys[k]) continue;
      d.keys[k] = now;
      fresh.push(it);
    }
    this.dedupSave(id, d, now);
    return fresh;
  }

  dedupCount(id) {
    return Object.keys(this.dedupLoad(id).keys).length;
  }
  dedupReset(id) {
    try {
      fs.unlinkSync(this.dedupFile(id));
    } catch (e) {}
    delete this.state.recentTopics[id];
    this.saveState();
  }

  addRecentTopic(id, title) {
    if (!title) return;
    const list = (this.state.recentTopics[id] = this.state.recentTopics[id] || []);
    list.push(String(title).slice(0, 200));
    if (list.length > 30) list.splice(0, list.length - 30);
    this.saveState();
  }
}

function mergeDefaults(def, obj) {
  const out = { ...def, ...obj };
  const groups = ['sources', 'content', 'schedule', 'publishing', 'telegram', 'accounts'];
  for (const k of groups) out[k] = { ...def[k], ...(obj[k] || {}) };
  return out;
}

// Konfiguracja sprzed usunięcia grafiki i wideo AI: „zawsze grafika AI” i „gdy brak zdjęcia: grafika AI” → grafika
// marki; ustawienia grafiki AI, Veo i limitów AI nie są już używane.
function upgradeBot(b) {
  const c = b.content;
  if (c.imageMode === 'ai') c.imageMode = 'source';
  if (c.imageFallback === 'ai') c.imageFallback = 'brand';
  for (const k of ['imageProvider', 'imageModel', 'aspectRatio', 'imageSize', 'imageStyle', 'videoMode', 'videoModel']) delete c[k];
  delete b.limits;
  return b;
}

// Jeden klucz Gemini (do tekstu): dawny osobny klucz do tekstu zostaje kluczem głównym, a klucze dostawców grafiki
// AI są usuwane. Zwraca true, gdy coś się zmieniło.
function upgradeSecrets(sg) {
  let changed = false;
  if (sg.geminiTextKey) {
    sg.geminiApiKey = sg.geminiTextKey;
    changed = true;
  }
  for (const k of ['geminiTextKey', 'cloudflareToken', 'openaiImagesKey']) {
    if (k in sg) {
      delete sg[k];
      changed = true;
    }
  }
  return changed;
}

module.exports = {
  Store,
  DEFAULTS,
  IMAGE_MODES,
  sanitizeBot,
  defaultBot,
};
