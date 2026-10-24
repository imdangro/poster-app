'use strict';
// Poster – panel sterowania botami.
//   :7080  interfejs WWW (LAN) – logowanie hasłem
//   :7081  API wewnętrzne dla n8n (tylko sieć Dockera, wymaga PANEL_INTERNAL_TOKEN):
//          bramka /gw/... (dokleja klucze API bota), tekst AI i grafika posta,
//          deduplikacja newsów, raporty z przebiegów
const http = require('http');
const fs = require('fs');
const path = require('path');
const { PROJECT_URL, PRODUCT_URL, EDITION, HttpError, sendJson, readJsonBody, safeEqual } = require('./lib/util');
const { setLanguageSource, withLanguage, lang, tr, trBoth } = require('./lib/i18n');
const { Store } = require('./lib/store');
const { Auth } = require('./lib/auth');
const { Accounts } = require('./lib/accounts');
const { Gateway, gatewayError } = require('./lib/gateway');
const { Telegram } = require('./lib/telegram');
const { Runner, esc } = require('./lib/runner');
const { Drafts } = require('./lib/drafts');
const { createApi } = require('./lib/api');
const { AI } = require('./lib/ai');
const { Images } = require('./lib/images');
const { Compose } = require('./lib/compose');
const { createLicenseKey } = require('./lib/license');

const env = process.env;
const DATA_DIR = env.POSTER_DATA_DIR || '/data';
const FILES_DIR = env.POSTER_FILES_DIR || '/files';
const UI_PORT = Number(env.PANEL_PORT_INTERNAL || 7080);
const INTERNAL_PORT = Number(env.PANEL_INTERNAL_PORT || 7081);
const INTERNAL_TOKEN = String(env.PANEL_INTERNAL_TOKEN || '').trim();
const VERSION = require('./package.json').version;

if (INTERNAL_TOKEN.length < 16) {
  // język z ustawień nie jest jeszcze znany – komunikaty startowe w obu językach
  console.error(
    trBoth('Brak PANEL_INTERNAL_TOKEN (min. 16 znaków) – uruchom: sudo bash scripts/init-nas.sh, potem sudo docker compose up -d'),
  );
  process.exit(1);
}

const info = {
  version: VERSION,
  edition: EDITION, // 'lite' | 'pro'
  projectUrl: PROJECT_URL, // kod źródłowy (AGPL) – link w panelu
  productUrl: PRODUCT_URL, // strona produktu (wersja PRO)
  publicUrl: (env.PANEL_PUBLIC_URL || `http://localhost:${UI_PORT}`).replace(/\/+$/, ''),
  n8nPublicUrl: (env.N8N_PUBLIC_URL || 'http://localhost:5678').replace(/\/+$/, ''),
  timezone: env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
};

let store;
let auth;
try {
  store = new Store(DATA_DIR, env, FILES_DIR);
  setLanguageSource(() => store.global.ui.language); // Ustawienia → Język; puste = polski
  auth = new Auth(DATA_DIR);
} catch (e) {
  console.error(trBoth('Nie mogę użyć katalogu danych {0}: {1}', DATA_DIR, e.message));
  if (/EACCES|EPERM/.test(e.code || e.message)) {
    console.error(trBoth('Katalog data/panel musi należeć do UID 1000 – uruchom na NAS-ie: sudo bash scripts/init-nas.sh'));
  }
  process.exit(1);
}
const accounts = new Accounts(store, { publicUrl: info.publicUrl });
const ai = new AI(store);
const images = new Images(store);
const gateway = new Gateway(store, accounts);
const drafts = new Drafts(FILES_DIR, store);
const runner = new Runner(store, {
  n8nUrl: (env.N8N_INTERNAL_URL || 'http://n8n:5678').replace(/\/+$/, ''),
  n8nPublicUrl: info.n8nPublicUrl,
  internalToken: INTERNAL_TOKEN,
  panelInternalUrl: (env.PANEL_INTERNAL_URL || `http://panel:${INTERNAL_PORT}`).replace(/\/+$/, ''),
  rsshubUrl: (env.RSSHUB_URL || 'http://rsshub:1200').replace(/\/+$/, ''),
});

// Kliknięcia w Telegramie → publikacja (n8n) albo odrzucenie
const defaultBot = () => (store.migratedBotId && store.bot(store.migratedBotId)) || store.bots[0] || null;
const telegram = new Telegram(store, {
  filesDir: FILES_DIR,
  onPublish: async (draft, ctx) => {
    // drafty sprzed panelu nie mają botId – należą do pierwszego (przeniesionego z .env) bota
    const bot = draft.botId ? store.bot(draft.botId) : defaultBot();
    if (!bot) throw new HttpError(404, tr('Bot, który utworzył ten draft, został usunięty'));
    await runner.start(bot, {
      kind: 'publish',
      trigger: 'telegram',
      extra: { draftId: ctx.draftId, chatId: ctx.chatId, messageId: ctx.messageId, approvedBy: ctx.from },
    });
  },
  onReject: async (draft, ctx) => {
    drafts.markRejected(ctx.draftId, ctx.from);
    const gen = store.state.runs.find((r) => r.draftId === ctx.draftId && ['generate', 'compose'].includes(r.kind));
    if (gen) store.updateRun(gen.id, { status: 'rejected', message: tr('odrzucony w Telegramie ({0})', ctx.from) });
  },
});
runner.telegram = telegram;
runner.ai = ai;
// własny post (✍️ Nowy post): wersje na platformy i zlecenie dla n8n
const compose = new Compose(store, { dataDir: DATA_DIR, ai, runner, images });

// klucz licencyjny wklejony w panelu: sprawdzenie w Polarze bez aktywacji i polecenie scripts/upgrade-to-pro.sh
const licenseKey = createLicenseKey(DATA_DIR);
const api = createApi({ store, auth, runner, accounts, telegram, drafts, gateway, info, ai, compose, licenseKey });

// ---------------------------------------------------------------------------------------------- UI :7080
const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.json': 'application/json',
};
const SECURITY_HEADERS = {
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy':
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function serveFile(res, file, { cache = 'no-cache', download } = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return sendJson(res, 404, { error: { message: tr('Nie znaleziono pliku') } });
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': cache,
      ...(download ? { 'content-disposition': `attachment; filename="${path.basename(file)}"` } : {}),
      ...SECURITY_HEADERS,
    });
    fs.createReadStream(file).pipe(res);
  });
}

function oauthPage(res, ok, title, text, botId) {
  const back = botId ? `/#/bot/${encodeURIComponent(botId)}/accounts` : '/';
  const html = `<!doctype html><html lang="${lang()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel="stylesheet" href="/style.css"></head>
<body class="oauth-page"><main class="card oauth-card"><div class="oauth-icon ${ok ? 'ok' : 'bad'}">${ok ? '✓' : '!'}</div>
<h1>${esc(title)}</h1><p>${esc(text)}</p><a class="btn primary" href="${back}">${esc(tr('Wróć do panelu'))}</a></main></body></html>`;
  res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS });
  res.end(html);
}

// panel wysyła swój język w nagłówku – błędy API są w języku ekranu także przed wyborem języka w Ustawieniach
const uiServer = http.createServer((req, res) => withLanguage(req.headers['x-poster-lang'], () => handleUi(req, res)));
async function handleUi(req, res) {
  try {
    const url = req.url.split('?')[0];
    if (url.startsWith('/api/')) return await api(req, res);

    const cb = url.match(/^\/oauth\/x\/callback$/);
    if (cb && req.method === 'GET') {
      try {
        const r = await accounts.complete(accounts.parseRedirect(req.url));
        const a = r.bot.accounts[r.platform] || {};
        const who = `@${a.username || '?'}`;
        return oauthPage(
          res,
          true,
          tr('Konto połączone'),
          tr('{0} jest teraz podłączone do bota „{1}”. Możesz zamknąć tę kartę.', who, r.bot.name),
          r.bot.id,
        );
      } catch (e) {
        return oauthPage(res, false, tr('Nie udało się połączyć konta'), e.message);
      }
    }

    const fm = url.match(/^\/files\/([A-Za-z0-9._-]+\.(png|jpe?g|webp|mp4|json))$/);
    if (fm && req.method === 'GET') {
      if (!auth.isAuthenticated(req)) throw new HttpError(401, tr('Zaloguj się'));
      return serveFile(res, path.join(FILES_DIR, fm[1]), { cache: 'private, max-age=3600', download: /[?&]download=1/.test(req.url) });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, tr('Metoda niedozwolona'));
    const name = url === '/' ? 'index.html' : url.slice(1);
    if (!/^[a-z0-9._-]+$/i.test(name)) throw new HttpError(404, tr('Nie znaleziono'));
    return serveFile(res, path.join(PUBLIC, name));
  } catch (e) {
    if (!e.status) console.error('UI:', e);
    if (res.headersSent) return res.destroy();
    sendJson(res, e.status || 500, { error: { message: e.status ? e.message : tr('Błąd serwera: {0}', e.message), ...(e.extra || {}) } });
  }
}

// ---------------------------------------------------------------------------------------------- wewnętrzne :7081
const internalServer = http.createServer(async (req, res) => {
  try {
    if (req.url === '/internal/health') return sendJson(res, 200, { ok: true, version: VERSION });
    if (!safeEqual(req.headers['x-poster-token'], INTERNAL_TOKEN)) throw new HttpError(403, tr('Nieprawidłowy PANEL_INTERNAL_TOKEN'));

    if (req.url.startsWith('/gw/')) {
      try {
        return await gateway.handle(req, res);
      } catch (e) {
        return gatewayError(res, e);
      }
    }
    if (req.method !== 'POST') throw new HttpError(405, tr('Metoda niedozwolona'));
    const body = await readJsonBody(req, 20 * 1024 * 1024);

    // Deduplikacja newsów + lista ostatnich tematów bota (żeby AI się nie powtarzało).
    const cm = req.url.match(/^\/internal\/bots\/([a-z0-9]+)\/candidates$/);
    if (cm) {
      const bot = store.requireBot(cm[1]);
      const articles = Array.isArray(body.articles) ? body.articles : [];
      const fresh = store.dedupFilter(bot.id, articles);
      const feedErrors = (Array.isArray(body.feedErrors) ? body.feedErrors : []).filter((e) => e && typeof e === 'object');
      // konto-czytnik X: czy w tym przebiegu pobrał się choć jeden profil X (alert, gdy padnie)
      if (runner.usesXReader(bot)) {
        const xErr = feedErrors.filter((e) => e.kind === 'x' || /^X @/.test(String(e.feed || '')));
        runner
          .trackXReader({ total: bot.sources.xHandles.length, failed: xErr.length, error: xErr.length ? xErr[0].error : '' })
          .catch((e) => console.error(tr('Odczyt X:'), e.message));
      }
      runner.event({
        type: 'candidates',
        runId: body.runId,
        botId: bot.id,
        stats: {
          fetched: Number(body.total) || articles.length,
          recent: articles.length,
          fresh: fresh.length,
          feedErrors: feedErrors.length,
          ...(feedErrors.length ? { feedErrorNames: feedErrors.map((e) => String(e.feed || '').slice(0, 60)).slice(0, 10) } : {}),
        },
      });
      return sendJson(res, 200, { articles: fresh, recentTopics: (store.state.recentTopics[bot.id] || []).slice(-15) });
    }
    // Tekst AI i grafika posta (zdjęcie ze źródła)
    const am = req.url.match(/^\/internal\/bots\/([a-z0-9]+)\/(llm|image)$/);
    if (am) {
      const bot = store.requireBot(am[1]);
      if (am[2] === 'llm') {
        if (!body.system || !body.user) throw new HttpError(400, tr('Brak treści zapytania do AI'));
        return sendJson(res, 200, await ai.generateText(bot, body));
      }
      if (am[2] === 'image') {
        // własny post (✍️ Nowy post): zdjęcie wgrane w panelu albo grafika wybrana w edytorze
        const r = body.compose ? await compose.image(bot, body.compose) : await images.resolve(bot, { news: body.news || {} });
        const { buffer, ...meta } = r;
        return sendJson(res, 200, { ...meta, data: buffer ? buffer.toString('base64') : null });
      }
    }
    if (req.url === '/internal/events') return sendJson(res, 200, runner.event(body));
    if (req.url === '/internal/error') return sendJson(res, 200, await runner.error(body));
    throw new HttpError(404, tr('Nie ma takiego adresu'));
  } catch (e) {
    if (!e.status) console.error('Internal:', e);
    if (res.headersSent) return res.destroy();
    sendJson(res, e.status || 500, { error: { message: e.message } });
  }
});
internalServer.requestTimeout = 0; // pobieranie wideo przez bramkę może trwać kilka minut
internalServer.headersTimeout = 60000;

uiServer.listen(UI_PORT, env.PANEL_LISTEN || '0.0.0.0', () => console.log(`Panel: ${info.publicUrl} (port ${UI_PORT})`));
internalServer.listen(INTERNAL_PORT, env.PANEL_LISTEN || '0.0.0.0', () => console.log(tr('API dla n8n: port {0}', INTERNAL_PORT)));
if (store.migrated) {
  console.log(
    store.bots.length
      ? tr('Pierwsze uruchomienie: przeniesiono ustawienia z .env (botów: {0}).', store.bots.length)
      : trBoth('Pierwsze uruchomienie: pusta konfiguracja – otwórz panel, ustaw hasło i dodaj bota.'),
  );
}
auth.announceSetup(); // bez hasła: kod do jego ustawienia trafia do logów (sudo docker compose logs panel)
for (const bot of store.bots) if (!store.state.schedule[bot.id]) runner.markCurrentSlot(bot);
if (env.PANEL_DISABLE_WORKERS !== '1') {
  runner.startScheduler();
  telegram.start();
}

const shutdown = () => {
  try {
    store.saveState(true);
  } catch (e) {}
  process.exit(0);
};
process.on('unhandledRejection', (e) => console.error(tr('Nieobsłużony błąd:'), e));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
