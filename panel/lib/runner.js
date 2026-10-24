'use strict';
// Uruchamianie botów: harmonogram, „Uruchom teraz”, publikacja po kliknięciu w Telegramie.
// Panel wywołuje webhook n8n (POST /webhook/poster) z pełną konfiguracją bota (bez sekretów),
// a n8n raportuje postęp z powrotem (/internal/events, /internal/error).
const { randomId, HttpError } = require('./util');
const { dueSlot, nextSlots } = require('./schedule');
const { TEXT_PROVIDERS } = require('./ai');
const { tr } = require('./i18n');

const PLATFORM_ACCOUNT = { x: 'x', facebook: 'meta' };
// po ilu przebiegach z rzędu bez żadnego pobranego profilu X wysłać alert o koncie-czytniku
const X_ALERT_AFTER = Math.max(1, parseInt(process.env.POSTER_X_ALERT_AFTER, 10) || 3);
const TIMEOUT_MIN = { generate: 40, publish: 60, compose: 60 };

class Runner {
  constructor(store, { n8nUrl, n8nPublicUrl, internalToken, panelInternalUrl, rsshubUrl }) {
    this.store = store;
    this.n8nUrl = n8nUrl;
    this.n8nPublicUrl = n8nPublicUrl;
    this.token = internalToken;
    this.panelInternalUrl = panelInternalUrl;
    this.rsshubUrl = rsshubUrl;
    this.telegram = null; // ustawiane w server.js
    this.timer = null;
  }

  // ------------------------------------------------------------------ konfiguracja dla n8n
  runtimeConfig(bot) {
    const g = this.store.global;
    const s = bot.sources;
    const feeds = s.rss.map((f) => ({ url: f.url, label: f.label || hostLabel(f.url), kind: 'rss' }));
    const readX = s.xSource === 'rsshub';
    const brand = bot.brandName || bot.name;
    if (readX) {
      const tpl = s.xRssTemplate || `${this.rsshubUrl}/twitter/user/{handle}/includeRts=false&count=20`;
      for (const h of s.xHandles) feeds.push({ url: tpl.split('{handle}').join(encodeURIComponent(h)), label: `X @${h}`, kind: 'x' });
    }
    const p = bot.publishing;
    const acc = bot.accounts;
    return {
      botId: bot.id,
      botName: bot.name,
      // język wiadomości w Telegramie i raportów workflow = język panelu (prompty AI zostają po polsku)
      lang: g.ui.language === 'en' ? 'en' : 'pl',
      topic: bot.topic || bot.name,
      brandName: brand,
      language: bot.language || 'polski',
      instructions: bot.instructions || '',
      maxAgeHours: s.maxAgeHours,
      maxCandidates: s.maxCandidates,
      feeds,
      xSource: s.xSource,
      xHandles: s.xHandles,
      apify: { actorId: g.apify.actorId, maxItems: s.apifyMaxItems },
      gemini: { textModel: bot.content.textModel },
      enableX: p.x,
      enableFacebook: p.facebook,
      meta: {
        graphVersion: g.meta.graphVersion,
        pageId: (acc.meta && acc.meta.pageId) || '',
      },
      telegram: { chatId: bot.telegram.chatId || g.telegram.chatId },
      // grafika: tryb z panelu (samo pozyskanie grafiki i tekstu robi panel – /internal/bots/<id>/image, /llm)
      image: { mode: bot.content.imageMode },
      gateway: `${this.panelInternalUrl}/gw/${bot.id}`,
      panelUrl: this.panelInternalUrl,
    };
  }

  // Braki, które uniemożliwiają pracę bota (pokazywane w panelu i blokujące uruchomienie).
  problems(bot) {
    const out = this.textProblems(bot);
    out.push(...this.publishProblems(bot));
    const sg = this.store.secrets.global;
    const s = bot.sources;
    if (!s.rss.length && !(s.xSource !== 'none' && s.xHandles.length)) out.push(tr('brak źródeł newsów (zakładka Źródła)'));
    if (s.xSource === 'apify' && s.xHandles.length && !sg.apifyToken) out.push(tr('źródło X = Apify, ale brak tokenu Apify (Ustawienia)'));
    return out;
  }

  // Braki publikacji draftu i własnego posta (✍️ Nowy post) – źródła i AI nie są do tego potrzebne
  publishProblems(bot) {
    const out = [];
    if (!this.store.secrets.global.telegramBotToken) out.push(tr('brak tokenu bota Telegram (Ustawienia)'));
    if (!(bot.telegram.chatId || this.store.global.telegram.chatId)) out.push(tr('brak ID czatu Telegram (Ustawienia)'));
    return out;
  }

  // Dostawca i model tekstu AI
  textProblems(bot) {
    const out = [];
    const id = bot.content.textProvider || 'gemini';
    if (this.ai && !this.ai.providerConfigured(id))
      out.push(tr('brak klucza/adresu dostawcy tekstu {0} (Ustawienia → Dostawcy AI)', (TEXT_PROVIDERS[id] || {}).label || id));
    if (!bot.content.textModel) out.push(tr('nie wybrano modelu tekstowego (zakładka Tekst i grafika)'));
    return out;
  }

  // Ostrzeżenia – bot działa, ale część publikacji się nie uda.
  warnings(bot) {
    const out = [];
    const xr = this.store.state.xReader;
    if (this.usesXReader(bot) && xr && xr.alertedAt) {
      out.push(
        tr(
          'odczyt X nie działa od {0} – konto-czytnik (TWITTER_AUTH_TOKEN) jest wylogowane lub zablokowane; podmień token w .env (README → „Źródło X”)',
          shortTime(xr.firstFailAt),
        ),
      );
    }
    const names = { x: 'X', facebook: 'Facebook' };
    for (const [k, acc] of Object.entries(PLATFORM_ACCOUNT)) {
      if (bot.publishing[k] && !bot.accounts[acc]) out.push(tr('{0} włączony, ale bez podłączonego konta', names[k]));
    }
    return out;
  }

  // ------------------------------------------------------------------ wywołanie n8n
  async callN8n(payload) {
    let res;
    try {
      res = await fetch(`${this.n8nUrl}/webhook/poster`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-poster-token': this.token },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      throw new HttpError(
        502,
        tr(
          'n8n nie odpowiada ({0}) – czy kontener poster-n8n działa?',
          e.name === 'TimeoutError' ? tr('przekroczono czas') : e.cause?.code || e.message,
        ),
      );
    }
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (e) {}
    if (res.status === 404) {
      throw new HttpError(502, tr('n8n nie zna webhooka „poster” – zaimportuj i opublikuj workflow: sudo bash scripts/import-to-n8n.sh'));
    }
    if (!res.ok) throw new HttpError(502, tr('n8n zwrócił HTTP {0}: {1}', res.status, text.slice(0, 200)));
    if (!data || data.ok !== true)
      throw new HttpError(502, tr('n8n odrzucił zapytanie – PANEL_INTERNAL_TOKEN w n8n i panelu się różni (sudo docker compose up -d)'));
    return data;
  }

  // kind: generate (źródła → AI → draft) | publish (✅ w Telegramie) | compose (własny post z panelu)
  async start(bot, { kind = 'generate', trigger = 'manual', extra = {}, slot } = {}) {
    // publikacja i własny post nie potrzebują źródeł ani AI – wystarczy Telegram
    const problems = kind === 'generate' ? this.problems(bot) : this.publishProblems(bot);
    if (problems.length) throw new HttpError(400, tr('Bot „{0}” nie może wystartować: {1}', bot.name, problems.join('; ')));
    const run = this.store.addRun({
      id: `r${Date.now().toString(36)}${randomId(3)}`,
      botId: bot.id,
      botName: bot.name,
      kind,
      trigger,
      slot: slot || null,
      status: 'starting',
      message: '',
      startedAt: new Date().toISOString(),
      ...(extra.draftId ? { draftId: extra.draftId } : {}),
      ...(extra.compose ? { title: extra.compose.title } : {}),
    });
    try {
      const data = await this.callN8n({ kind, runId: run.id, trigger, config: this.runtimeConfig(bot), ...extra });
      this.store.updateRun(run.id, { status: 'running', executionId: data.executionId ? String(data.executionId) : null });
    } catch (e) {
      this.store.updateRun(run.id, { status: 'error', message: e.message, finishedAt: new Date().toISOString() });
      throw e;
    }
    return run;
  }

  executionUrl(id) {
    return id ? `${this.n8nPublicUrl}/workflow/PosterBotMain001/executions/${id}` : null;
  }

  // ------------------------------------------------------------------ harmonogram
  startScheduler() {
    const tick = () => {
      this.tick().catch((e) => console.error(tr('Harmonogram:'), e.message));
    };
    setTimeout(tick, 5000);
    this.timer = setInterval(tick, 20000);
  }

  // Ustaw „ostatni termin” na bieżący – po zapisaniu harmonogramu bot nie wystartuje za termin, który właśnie minął.
  markCurrentSlot(bot) {
    const slot = dueSlot(bot.schedule, new Date(), undefined, bot.id);
    this.store.state.schedule[bot.id] = { ...(this.store.state.schedule[bot.id] || {}), lastSlot: slot ? slot.key : null };
    this.store.saveState();
  }

  async tick() {
    const now = new Date();
    for (const bot of [...this.store.bots]) {
      if (bot.paused) continue;
      const slot = dueSlot(bot.schedule, now, undefined, bot.id);
      if (!slot) continue;
      const key = slot.key;
      const st = (this.store.state.schedule[bot.id] = this.store.state.schedule[bot.id] || {});
      if (st.lastSlot === key) continue;
      st.lastSlot = key;
      this.store.saveState(true);
      try {
        await this.start(bot, { trigger: 'schedule', slot: key });
        console.log(tr('Harmonogram: uruchomiono bota {0} ({1})', bot.name, key));
      } catch (e) {
        console.error(tr('Harmonogram: bot {0} – {1}', bot.name, e.message));
        await this.alert(
          tr('❗ <b>{0}</b>: zaplanowane uruchomienie ({1}) nie wystartowało\n{2}', esc(bot.name), key.slice(11), esc(e.message)),
          bot,
        );
      }
    }
    this.sweep();
  }

  // Uruchomienia, o których n8n nic nie zgłosił, oznaczamy po czasie jako „brak odpowiedzi”.
  sweep() {
    const now = Date.now();
    for (const r of this.store.state.runs) {
      if (!['starting', 'running', 'publishing'].includes(r.status)) continue;
      const limit = (TIMEOUT_MIN[r.kind] || 40) * 60 * 1000;
      if (now - Date.parse(r.startedAt) > limit) {
        const message = tr('n8n nie zgłosił wyniku – sprawdź zakładkę Executions w n8n');
        this.store.updateRun(r.id, {
          status: 'timeout',
          message,
          finishedAt: new Date().toISOString(),
        });
      }
    }
  }

  // ------------------------------------------------------------------ konto-czytnik X (RSSHub)
  // Bot czyta X przez wbudowany RSSHub, czyli przez wspólne konto-czytnik z TWITTER_AUTH_TOKEN.
  usesXReader(bot) {
    const s = bot.sources;
    return s.xSource === 'rsshub' && !s.xRssTemplate && (s.xHandles || []).length > 0;
  }

  // Wynik odczytu profili X w przebiegu (total = liczba profili, failed = ile się nie pobrało).
  // Pojedynczy błędny profil to zwykle literówka/usunięte konto; gdy NIE pobrał się żaden profil
  // X_ALERT_AFTER razy z rzędu – konto-czytnik padło: alert na Telegram, a po naprawie – informacja.
  async trackXReader({ total, failed, error, testOnly = false }) {
    if (!total) return;
    const st = (this.store.state.xReader = this.store.state.xReader || { fails: 0 });
    const now = new Date().toISOString();
    if (failed < total) {
      const wasDown = !!st.alertedAt;
      Object.assign(st, { fails: 0, lastOkAt: now, firstFailAt: null, alertedAt: null });
      this.store.saveState();
      if (wasDown) await this.alert(tr('✅ <b>Odczyt X znowu działa</b> – profile X pobierają się poprawnie.'));
      return;
    }
    if (testOnly) return; // ręczny test profilu nie liczy się do alertu
    st.fails = (st.fails || 0) + 1;
    st.lastFailAt = now;
    st.firstFailAt = st.firstFailAt || now;
    st.lastError = String(error || '').slice(0, 300);
    const alertNow = st.fails >= X_ALERT_AFTER && !st.alertedAt;
    if (alertNow) st.alertedAt = now;
    this.store.saveState();
    if (!alertNow) return;
    const runs = st.fails < 5 ? tr('uruchomienia') : tr('uruchomień');
    await this.alert(
      [
        tr('⚠️ <b>Odczyt X nie działa</b>'),
        tr('Od {0} nie pobrał się żaden profil X ({1} {2} z rzędu). ', shortTime(st.firstFailAt), st.fails, runs) +
          tr('Najpewniej konto-czytnik (<code>TWITTER_AUTH_TOKEN</code>) zostało wylogowane albo zablokowane.'),
        ...(st.lastError ? [tr('Ostatni błąd: <code>{0}</code>', esc(st.lastError.slice(0, 200)))] : []),
        '',
        tr('<b>Co zrobić:</b>'),
        tr('1. Zaloguj się na konto-czytnik w przeglądarce (albo załóż nowe) i skopiuj ciasteczko <code>auth_token</code>.'),
        tr('2. Na NAS-ie wpisz je w <code>.env</code>: <code>TWITTER_AUTH_TOKEN=…</code> (kilka kont rozdziel przecinkami).'),
        tr('3. <code>sudo docker compose up -d rsshub</code>'),
        tr('Jeśli odczyt X idzie przez proxy (<code>RSSHUB_PROXY_URI</code>) – sprawdź też proxy.'),
        tr('Do tego czasu boty działają na samych kanałach RSS.'),
      ].join('\n'),
    );
  }

  xReaderStatus() {
    const st = this.store.state.xReader || {};
    return {
      fails: st.fails || 0,
      alertAfter: X_ALERT_AFTER,
      down: !!st.alertedAt,
      lastOkAt: st.lastOkAt || null,
      firstFailAt: st.firstFailAt || null,
      lastError: st.lastError || '',
    };
  }

  nextRun(bot) {
    if (bot.paused) return null;
    const [n] = nextSlots(bot.schedule, new Date(), 1, bot.id);
    return n ? n.toISOString() : null;
  }

  // ------------------------------------------------------------------ raporty z n8n
  event(e) {
    const run = e.runId ? this.store.run(e.runId) : null;
    const botId = e.botId || (run && run.botId);
    const now = new Date().toISOString();
    switch (e.type) {
      case 'candidates': {
        if (!run) break;
        const st = e.stats || {};
        if (st.fresh !== 0) {
          this.store.updateRun(run.id, { stats: st });
          break;
        }
        this.store.updateRun(run.id, { stats: st, status: 'no_news', message: tr('brak nowych newsów w źródłach'), finishedAt: now });
        break;
      }
      case 'skip':
        if (run)
          this.store.updateRun(run.id, {
            status: 'skipped',
            message: tr('AI pominęło publikację: {0}', String(e.reason || '').slice(0, 300)),
            finishedAt: now,
          });
        break;
      case 'draft':
        if (botId) this.store.addRecentTopic(botId, e.title);
        if (run) {
          // auto: własny post z „Publikuj teraz” – publikacja rusza od razu
          const auto = e.auto === true;
          const autoText = tr('publikuję teraz – zlecenie z panelu');
          this.store.updateRun(run.id, {
            draftId: e.draftId,
            title: String(e.title || '').slice(0, 300),
            status: auto ? 'publishing' : 'draft',
            message: auto ? autoText : tr('draft czeka na akceptację w Telegramie'),
            ...(auto ? {} : { finishedAt: now }),
          });
        }
        break;
      case 'publish': {
        const results = e.results || {};
        const summary = Object.entries(results)
          .map(([k, v]) => `${k}: ${v && v.ok ? 'OK' : tr('błąd{0}', v && v.error ? ` (${String(v.error).slice(0, 120)})` : '')}`)
          .join(' · ');
        if (run)
          this.store.updateRun(run.id, {
            status: e.status || 'published',
            results,
            message: summary,
            finishedAt: now,
            draftId: e.draftId || run.draftId,
          });
        // status draftu w uruchomieniu, które go utworzyło (lista w Pulpicie)
        const gen = this.store.state.runs.find((r) => ['generate', 'compose'].includes(r.kind) && r.draftId === e.draftId && r !== run);
        if (gen) this.store.updateRun(gen.id, { status: e.status || 'published', message: summary });
        break;
      }
      default:
        break;
    }
    return { ok: true };
  }

  async error(payload) {
    const ex = payload.execution || {};
    const execId = ex.id ? String(ex.id) : null;
    const run = execId ? this.store.state.runs.find((r) => r.executionId === execId) : null;
    const err = ex.error || (payload.trigger && payload.trigger.error) || {};
    // n8n: message = ogólny opis (np. „Service unavailable”), description = szczegóły z odpowiedzi API
    const detail =
      typeof err.description === 'string' && err.description && !String(err.message || '').includes(err.description)
        ? ` – ${err.description}`
        : '';
    const message = `${err.message || tr('nieznany błąd')}${detail}`.slice(0, 1500);
    const node = ex.lastNodeExecuted || 'trigger';
    const bot = run ? this.store.bot(run.botId) : null;
    if (run)
      this.store.updateRun(run.id, {
        status: 'error',
        message: `${node}: ${message}`,
        finishedAt: new Date().toISOString(),
      });
    const link = this.executionUrl(execId);
    await this.alert(
      [
        tr('❗ <b>Poster{0}</b>: błąd workflow', bot ? ` · ${esc(bot.name)}` : ''),
        tr('Węzeł: {0}', esc(node)),
        tr('Błąd: {0}', esc(message)),
        link ? tr('<a href="{0}">Otwórz wykonanie w n8n</a>', esc(link)) : '',
      ]
        .filter(Boolean)
        .join('\n'),
      bot,
    );
    return { ok: true };
  }

  async alert(html, bot) {
    if (!this.telegram || !this.store.secrets.global.telegramBotToken) return;
    const chatId = (bot && bot.telegram.chatId) || this.store.global.telegram.chatId;
    if (!chatId) return;
    await this.telegram.try('sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  }
}

const pad2 = (n) => String(n).padStart(2, '0');
// „03.10 14:05” w strefie TZ kontenera
function shortTime(iso) {
  const d = new Date(iso || Date.now());
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function hostLabel(url) {
  const m = String(url).match(/^https?:\/\/(?:www\.)?([^/?#:]+)/i);
  return m ? m[1] : url;
}
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

module.exports = { Runner, esc, shortTime };
