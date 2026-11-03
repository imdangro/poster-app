'use strict';
// REST API interfejsu panelu (port 7080, wymaga zalogowania).
const { HttpError, readJsonBody, sendJson, fetchJson, mask, isJsonType, sameOrigin } = require('./util');
const { testFeed } = require('./feeds');
const { esc } = require('./html');
const { nextSlots, scheduleHours } = require('./schedule');
const { sanitizeBot, DEFAULTS } = require('./store');
const { UPSTREAM, apiError } = require('./accounts');
const { TEXT_PROVIDERS } = require('./ai');
const { LANGUAGES, tr } = require('./i18n');

const SECRET_KEYS = ['geminiApiKey', 'telegramBotToken', 'xClientSecret', 'apifyToken', 'ollamaKey', 'customKey'];

function createApi(ctx) {
  const { store, auth, runner, accounts, telegram, drafts, gateway, info, ai, compose, licenseKey } = ctx;
  const routes = [];
  const route = (method, pattern, handler, { open = false, bodyLimit } = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, re, keys, handler, open, bodyLimit });
  };

  // ------------------------------------------------------------------ sesja
  route(
    'GET',
    '/api/session',
    async (req) => {
      const needsSetup = auth.needsSetup;
      if (needsSetup) auth.setupCode(); // brak kodu (np. usunięty auth.json) → nowy kod w logach panelu
      // language: język panelu z ustawień ('' = niewybrany – przeglądarka decyduje)
      return {
        authenticated: auth.isAuthenticated(req),
        needsSetup,
        version: info.version,
        edition: info.edition,
        projectUrl: info.projectUrl,
        productUrl: info.productUrl,
        language: store.global.ui.language,
      };
    },
    { open: true },
  );
  route(
    'POST',
    '/api/setup',
    async (req, res, p, body) => {
      if (!auth.needsSetup) throw new HttpError(409, tr('Hasło jest już ustawione'));
      const client = auth.clientKey(req);
      auth.checkRate(client);
      if (!auth.checkSetupCode(body.code)) {
        auth.fail(client);
        throw new HttpError(403, tr('Nieprawidłowy kod. Znajdziesz go w logach panelu: sudo docker compose logs panel | grep -i kod'));
      }
      await auth.setPassword(body.password);
      // język wybrany na ekranie pierwszego uruchomienia – od teraz panel, Telegram i raporty w tym języku
      if (LANGUAGES.includes(body.language)) store.updateGlobal({ ui: { language: body.language } });
      res.setHeader('set-cookie', auth.createCookie(req));
      return { ok: true };
    },
    { open: true },
  );
  route(
    'POST',
    '/api/login',
    async (req, res, p, body) => {
      const client = auth.clientKey(req);
      auth.checkRate(client);
      if (!(await auth.verify(body.password))) {
        auth.fail(client);
        throw new HttpError(401, tr('Nieprawidłowe hasło'));
      }
      res.setHeader('set-cookie', auth.createCookie(req));
      return { ok: true };
    },
    { open: true },
  );
  route(
    'POST',
    '/api/logout',
    async (req, res, p, body) => {
      // everywhere: wylogowanie na wszystkich urządzeniach (nowy sekret sesji) – tylko z ważnej sesji
      if (body && body.everywhere === true) {
        if (!auth.isAuthenticated(req)) throw new HttpError(401, tr('Zaloguj się'));
        auth.logoutEverywhere();
      }
      res.setHeader('set-cookie', auth.clearCookie(req));
      return { ok: true };
    },
    { open: true },
  );
  route('POST', '/api/password', async (req, res, p, body) => {
    // limit prób także tutaj: z przejętą sesją (ciasteczkiem) nie da się zgadywać obecnego hasła
    const client = auth.clientKey(req);
    auth.checkRate(client);
    if (!(await auth.verify(body.current))) {
      auth.fail(client);
      throw new HttpError(400, tr('Obecne hasło jest nieprawidłowe'));
    }
    await auth.setPassword(body.password);
    res.setHeader('set-cookie', auth.createCookie(req));
    return { ok: true };
  });

  // ------------------------------------------------------------------ pulpit
  const botView = (b) => ({
    ...b,
    problems: runner.problems(b),
    warnings: runner.warnings(b),
    nextRun: runner.nextRun(b),
    hours: scheduleHours(b.schedule),
    lastRun: store.state.runs.find((r) => r.botId === b.id && r.kind === 'generate') || null,
  });
  const runView = (r) => ({ ...r, executionUrl: runner.executionUrl(r.executionId) });

  route('GET', '/api/overview', async () => ({
    bots: store.bots.map(botView),
    runs: store.state.runs.slice(0, 40).map(runView),
    health: await health(),
    info,
  }));

  let n8nHealth = { at: 0 };
  async function health() {
    if (Date.now() - n8nHealth.at > 15000) {
      try {
        const r = await fetch(`${runner.n8nUrl}/healthz`, { signal: AbortSignal.timeout(4000) });
        n8nHealth = { at: Date.now(), ok: r.ok, message: r.ok ? tr('działa') : `HTTP ${r.status}` };
      } catch (e) {
        n8nHealth = { at: Date.now(), ok: false, message: tr('nie odpowiada') };
      }
    }
    return {
      n8n: { ok: n8nHealth.ok, message: n8nHealth.message, url: info.n8nPublicUrl },
      telegram: {
        ok: telegram.status.ok && !!store.global.telegram.chatId,
        message: !store.global.telegram.chatId && telegram.status.ok ? tr('brak ID czatu') : telegram.status.message,
        username: telegram.status.username,
      },
      gemini: { ok: !!ai.geminiKey(), message: ai.geminiKey() ? tr('klucz ustawiony') : tr('brak klucza') },
      disk: drafts.disk(), // wolne miejsce na dysku z draftami (free: bajty albo null), low: mniej niż 1 GB
      // konto-czytnik X (RSSHub) – tylko gdy któryś bot czyta X przez RSSHub
      xReader: store.bots.some((b) => runner.usesXReader(b))
        ? { ...runner.xReaderStatus(), botId: (store.bots.find((b) => runner.usesXReader(b)) || {}).id }
        : null,
      gateway: gateway.stats,
    };
  }

  // ------------------------------------------------------------------ boty
  route('GET', '/api/bots/:id', async (req, res, p) => {
    const b = store.requireBot(p.id);
    const sb = store.botSecrets(b.id);
    return {
      bot: botView(b),
      nextRuns: b.paused ? [] : nextSlots(b.schedule, new Date(), 6, b.id).map((d) => d.toISOString()),
      dedupCount: store.dedupCount(b.id),
      recentTopics: store.state.recentTopics[b.id] || [],
      runs: store.state.runs
        .filter((r) => r.botId === b.id)
        .slice(0, 50)
        .map(runView),
      tokens: {
        x: sb.x ? { expiresAt: sb.x.expiresAt, hasRefresh: !!sb.x.refreshToken } : null,
        meta: sb.meta ? { set: true } : null,
      },
    };
  });
  route('POST', '/api/bots', async (req, res, p, body) => {
    const bot = store.addBot({ name: body.name });
    runner.markCurrentSlot(bot);
    return { bot };
  });
  route('PUT', '/api/bots/:id', async (req, res, p, body) => {
    const before = store.requireBot(p.id); // ten sam obiekt po zmianie (store.updateBot) – stan sprzed zmiany kopiujemy
    const scheduleBefore = JSON.stringify(before.schedule) + before.paused;
    const { accounts: _a, id: _i, createdAt: _c, ...input } = body || {};
    let bot = store.updateBot(p.id, input);
    if (JSON.stringify(bot.schedule) + bot.paused !== scheduleBefore) runner.markCurrentSlot(bot);
    return { bot: botView(bot) };
  });
  route('DELETE', '/api/bots/:id', async (req, res, p) => {
    store.deleteBot(p.id);
    return { ok: true };
  });

  route('POST', '/api/bots/:id/pause', async (req, res, p, body) => {
    const bot = store.updateBot(p.id, { paused: body.paused !== false });
    runner.markCurrentSlot(bot);
    return { bot: botView(bot) };
  });
  route('POST', '/api/bots/:id/run', async (req, res, p) => {
    const bot = store.requireBot(p.id);
    const busy = store.state.runs.find(
      (r) =>
        r.botId === bot.id &&
        r.kind === 'generate' &&
        ['starting', 'running'].includes(r.status) &&
        Date.now() - Date.parse(r.startedAt) < 90000,
    );
    if (busy) throw new HttpError(409, tr('Ten bot właśnie działa – poczekaj chwilę'));
    const run = await runner.start(bot, { trigger: 'manual' });
    return { run: runView(store.run(run.id)) };
  });
  route('POST', '/api/bots/:id/dedup-reset', async (req, res, p) => {
    store.requireBot(p.id);
    store.dedupReset(p.id);
    return { ok: true };
  });
  route('POST', '/api/schedule/preview', async (req, res, p, body) => {
    const tmp = sanitizeBot(
      { schedule: body.schedule || {} },
      {
        schedule: { mode: 'interval', every: 4, from: 8, to: 20, hours: [], minute: 0, days: [1, 2, 3, 4, 5, 6, 7] },
        sources: {},
        content: {},
        publishing: {},
        telegram: {},
        accounts: {},
        // sanitizeBot czyta też pola trybu strony i kanału YouTube – bez nich podgląd kończył się błędem 500
      },
    );
    // botId = ziarno losowego przesunięcia (podgląd pokazuje te same godziny, które wybierze harmonogram)
    const seed = /^[a-z0-9]{3,20}$/.test(String(body.botId || '')) ? String(body.botId) : '';
    return { hours: scheduleHours(tmp.schedule), next: nextSlots(tmp.schedule, new Date(), 6, seed).map((d) => d.toISOString()) };
  });

  // ------------------------------------------------------------------ konta platform
  route('POST', '/api/bots/:id/accounts/:platform/start', async (req, res, p) => accounts.start(p.id, p.platform));
  route('POST', '/api/oauth/complete', async (req, res, p, body) => {
    const r = await accounts.complete(accounts.parseRedirect(body.url));
    return { ok: true, botId: r.bot.id, platform: r.platform, account: r.bot.accounts[r.platform] };
  });
  route('POST', '/api/bots/:id/accounts/meta', async (req, res, p, body) => ({ account: await accounts.connectMeta(p.id, body) }));
  route('DELETE', '/api/bots/:id/accounts/:platform', async (req, res, p) => {
    accounts.disconnect(p.id, p.platform);
    return { ok: true };
  });

  // ------------------------------------------------------------------ ustawienia globalne
  const settingsView = () => ({
    global: store.global,
    secrets: Object.fromEntries(SECRET_KEYS.map((k) => [k, { set: !!store.secrets.global[k], hint: mask(store.secrets.global[k]) }])),
    info: {
      ...info,
      xRedirectUri: accounts.xRedirectUri(),
    },
    licenseKey: licenseKey.view(), // klucz licencyjny z panelu dla scripts/upgrade-to-pro.sh
    disk: drafts.disk(), // wolne miejsce na dysku z draftami (karta „Pliki draftów”)
    options: {
      defaults: DEFAULTS,
      textProviders: Object.entries(TEXT_PROVIDERS).map(([id, p]) => ({
        id,
        label: p.label,
        defaultBase: p.defaultBase || '',
        keyOptional: !!p.keyOptional,
        configured: ai.providerConfigured(id),
      })),
    },
  });
  route('GET', '/api/settings', async () => settingsView());
  route('PUT', '/api/settings', async (req, res, p, body) => {
    if (body.global) store.updateGlobal(body.global);
    const secrets = body.secrets || {};
    let changed = false;
    for (const k of SECRET_KEYS) {
      if (!(k in secrets)) continue;
      const v = secrets[k] === null ? '' : String(secrets[k]).trim();
      if (secrets[k] !== null && !v) continue; // puste pole = bez zmian
      if (v.length > 500) throw new HttpError(400, tr('Zbyt długa wartość'));
      if (v) store.secrets.global[k] = v;
      else delete store.secrets.global[k];
      changed = true;
      modelsCache.clear();
      if (k === 'telegramBotToken') telegram.restart();
    }
    if (changed) store.saveSecrets();
    return settingsView();
  });

  // ------------------------------------------------------------------ licencja PRO: klucz z panelu
  // Panel sprawdza klucz w Polarze bez aktywacji i trzyma go dla scripts/upgrade-to-pro.sh; aktywację robi skrypt
  // (klucz SSH NAS-a i stan licencji w .git/, do których panel nie ma dostępu)
  route('POST', '/api/license/check', async (req, res, p, body) => licenseKey.check(body.key));
  route('DELETE', '/api/license/key', async () => licenseKey.clear());

  // ------------------------------------------------------------------ testy / pomocniki
  // Listy modeli dostawców (pamięć podręczna 10 min)
  const modelsCache = new Map();
  async function listModels(provider, force) {
    const c = modelsCache.get(provider);
    if (!force && c && Date.now() - c.at < 10 * 60 * 1000) return c.data;
    const data = await ai.listModels(provider);
    modelsCache.set(provider, { at: Date.now(), data });
    return data;
  }
  route('GET', '/api/models', async (req) => {
    const q = new URL(req.url, 'http://x').searchParams;
    return { models: await listModels(q.get('provider') || 'gemini', q.get('refresh') === '1') };
  });
  route('POST', '/api/test/gemini', async () => {
    const key = ai.geminiKey();
    if (!key) throw new HttpError(400, tr('Najpierw zapisz klucz Google Gemini'));
    const r = await fetchJson(`${UPSTREAM.gemini}/v1beta/models?pageSize=1000`, { headers: { 'x-goog-api-key': key } });
    if (!r.ok) throw new HttpError(400, tr('Google odrzucił klucz: {0}', apiError(r)));
    modelsCache.delete('gemini');
    return { ok: true, message: `Gemini: ${tr('klucz działa ({0} modeli)', ((r.data && r.data.models) || []).length)}` };
  });
  route('POST', '/api/test/provider', async (req, res, p, body) => {
    const provider = String(body.provider || '');
    const models = await listModels(provider, true);
    return {
      ok: true,
      message: tr('Działa – dostępnych modeli: {0}. Model wybierasz w bocie: zakładka Tekst i grafika.', (models.text || []).length),
    };
  });

  route('POST', '/api/test/telegram', async (req, res, p, body) => {
    const chatId = String(body.chatId || store.global.telegram.chatId || '').trim();
    if (!chatId) throw new HttpError(400, tr('Podaj ID czatu (albo kliknij „Wykryj”)'));
    await telegram.call('sendMessage', {
      chat_id: chatId,
      parse_mode: 'HTML',
      text: tr(
        '✅ <b>Poster</b>: test połączenia z panelu{0}. Drafty będą przychodzić tutaj.',
        body.botName ? tr(' (bot „{0}”)', esc(body.botName)) : '',
      ),
    });
    return { ok: true, message: tr('Wysłano wiadomość testową') };
  });
  route('POST', '/api/test/telegram-token', async (req, res, p, body) => {
    const token = String(body.token || store.secrets.global.telegramBotToken || '').trim();
    const me = await telegram.call('getMe', {}, { token });
    return { ok: true, message: tr('Token działa – bot @{0}', me.username), username: me.username };
  });
  route('GET', '/api/telegram/chats', async () => ({ chats: store.state.telegram.chats || [], status: telegram.status }));

  route('POST', '/api/test/rss', async (req, res, p, body) => {
    const url = String(body.url || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new HttpError(400, tr('Podaj adres zaczynający się od http:// lub https://'));
    return testFeed(url);
  });
  route('POST', '/api/test/x-handle', async (req, res, p, body) => {
    const handle = String(body.handle || '')
      .replace(/^@/, '')
      .trim();
    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw new HttpError(400, tr('Niepoprawna nazwa profilu'));
    const tpl = String(body.template || '').trim() || `${runner.rsshubUrl}/twitter/user/{handle}/includeRts=false&count=20`;
    const r = await testFeed(tpl.split('{handle}').join(encodeURIComponent(handle)));
    if (!r.ok && /503|500|auth|token/i.test(r.message || '')) r.message += tr(' – sprawdź TWITTER_AUTH_TOKEN w .env (RSSHub)');
    // udany test po podmianie tokenu od razu zdejmuje alert „odczyt X nie działa”
    if (r.ok && !String(body.template || '').trim()) await runner.trackXReader({ total: 1, failed: 0, testOnly: true });
    return r;
  });

  // ------------------------------------------------------------------ własny post (✍️ Nowy post)
  route('GET', '/api/compose', async () => ({ bots: store.bots.map((b) => compose.view(b)) }));
  // wersje na platformy: AI albo (ai: false) tekst autora przycięty do limitów
  route('POST', '/api/bots/:id/compose/adapt', async (req, res, p, body) => compose.adapt(store.requireBot(p.id), body));
  // wysyłka: draft na Telegram do akceptacji albo publikacja od razu (publishNow)
  route(
    'POST',
    '/api/bots/:id/compose',
    async (req, res, p, body) => {
      const run = await compose.send(store.requireBot(p.id), body);
      return { run: runView(store.run(run.id)) };
    },
    { bodyLimit: 9 * 1024 * 1024 },
  );

  // jeden bot albo kilka naraz (PRO): wysyłka do akceptacji, „Publikuj teraz” albo zaplanowanie (plan – PRO)
  route(
    'POST',
    '/api/compose',
    async (req, res, p, body) => {
      const r = await compose.batch(body);
      return { runs: r.runs.map((run) => runView(store.run(run.id))), failed: r.failed };
    },
    { bodyLimit: 9 * 1024 * 1024 },
  );

  // ------------------------------------------------------------------ drafty
  route('GET', '/api/drafts', async (req) => {
    const q = new URL(req.url, 'http://x').searchParams;
    return { drafts: drafts.list({ botId: q.get('bot') || undefined, limit: Math.min(200, Number(q.get('limit')) || 60) }) };
  });
  route('GET', '/api/drafts/:id', async (req, res, p) => {
    const d = drafts.read(p.id);
    if (!d) throw new HttpError(404, tr('Nie ma takiego draftu'));
    return { draft: { ...drafts.summary(`${p.id}.json`), raw: d } };
  });

  // ------------------------------------------------------------------ dispatcher
  return async function handleApi(req, res) {
    const url = req.url.split('?')[0];
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.match(r.re);
      if (!m) continue;
      if (!r.open && !auth.isAuthenticated(req)) throw new HttpError(401, tr('Zaloguj się'));
      // CSRF: zmiany tylko JSON-em (blokuje formularze i „proste” zapytania obcych stron) i tylko z tej samej strony
      // (blokuje inne aplikacje pod adresem NAS-a i sąsiednie subdomeny – patrz sameOrigin w util.js)
      if (req.method !== 'GET') {
        if (!isJsonType(req)) throw new HttpError(415, tr('Wymagany JSON'));
        if (!sameOrigin(req)) throw new HttpError(403, tr('Odrzucono zapytanie z innej strony – otwórz panel bezpośrednio jego adresem'));
      }
      let params;
      try {
        params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      } catch (e) {
        throw new HttpError(400, tr('Niepoprawny adres')); // np. „%” bez kodu znaku
      }
      const body = req.method === 'GET' ? {} : await readJsonBody(req, r.bodyLimit);
      const out = await r.handler(req, res, params, body);
      if (res.headersSent || res.writableEnded) return; // handler sam wysłał odpowiedź (np. plik)
      return sendJson(res, 200, out);
    }
    throw new HttpError(404, tr('Nie ma takiego adresu API'));
  };
}

module.exports = { createApi };
