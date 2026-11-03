'use strict';
// Test integracyjny: prawdziwy serwer panelu (oba porty) + atrapa API Telegrama, Gemini i webhooka n8n.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { tmpDir, freePort, waitFor } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const TOKEN = 'test-internal-token-1234567890';
let proc;
let logs = '';
let ui;
let internal;
let dataDir;
let mock;
const mockHits = [];
const n8nJobs = []; // zlecenia panelu do n8n (webhook „poster”)
let n8nDelay = 0; // ms do odpowiedzi webhooka n8n (wolne n8n – zapytania panelu są w drodze naraz)
let n8nReject = false; // webhook z Header Auth odrzuca token panelu (brak poświadczenia albo inny token w n8n)
// atrapa Gemini: tyle kolejnych zapytań dostaje HTTP 503 (przeciążony model), geminiBadKey – HTTP 400 (zły klucz);
// licznik wszystkich zapytań
let geminiBusy = 0;
let geminiBadKey = false;
let geminiCalls = 0;
// atrapa kanału RSS YouTube (bot „kanał YouTube”, PRO): ID filmów od najnowszego
const YT_CHANNEL = 'UCabcdefghijklmnopqrstuv';
const ytVideos = ['vidA0000001', 'vidA0000002'];
// lista transmisji kanału (playlist_id=UULV…) jest pusta
const ytFeed = (url) =>
  `<?xml version="1.0" encoding="UTF-8"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom"><title>Mój kanał</title><link rel="alternate" href="https://www.youtube.com/channel/${YT_CHANNEL}"/>${(url.includes(
    'playlist_id=',
  )
    ? []
    : ytVideos
  )
    .map(
      (id, i) =>
        `<entry><yt:videoId>${id}</yt:videoId><title>Film ${id}</title><link rel="alternate" href="https://www.youtube.com/watch?v=${id}"/><published>${new Date(Date.now() - (i + 1) * 3600e3).toISOString()}</published><media:group><media:description>Opis ${id}</media:description><media:community><media:statistics views="10"/></media:community></media:group></entry>`,
    )
    .join('')}</feed>`;
let cookie = '';

const url = (p) => `http://127.0.0.1:${ui}${p}`;
const json = (method, p, body, headers = {}) =>
  fetch(url(p), {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const setupCodeFromLogs = () => (logs.match(/Kod do ustawienia hasła panelu: ([A-Z0-9-]+)/) || [])[1];

before(async () => {
  mock = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      mockHits.push({ url: req.url, headers: req.headers });
      const body = Buffer.concat(chunks).toString('utf8');
      const send = (obj) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (req.url === '/webhook/poster') {
        if (n8nReject) {
          res.writeHead(403);
          return res.end('Authorization data is wrong!');
        }
        n8nJobs.push(JSON.parse(body));
        return setTimeout(() => send({ ok: true, executionId: 77 }), n8nDelay);
      }
      // Gemini: wersje posta – pola ze schematu odpowiedzi
      if (/:generateContent$/.test(req.url)) {
        geminiCalls++;
        if (geminiBadKey) {
          res.writeHead(400, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: { code: 400, message: 'API key not valid.', status: 'INVALID_ARGUMENT' } }));
        }
        if (geminiBusy > 0) {
          geminiBusy--;
          res.writeHead(503, { 'content-type': 'application/json' });
          return res.end(
            JSON.stringify({ error: { code: 503, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } }),
          );
        }
        const keys = Object.keys(JSON.parse(body).generationConfig.responseSchema.properties);
        const text = JSON.stringify(Object.fromEntries(keys.map((k) => [k, `AI ${k} #test`])));
        return send({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });
      }
      if (req.url.startsWith('/feeds/videos.xml')) {
        res.writeHead(200, { 'content-type': 'application/atom+xml' });
        return res.end(ytFeed(req.url));
      }
      // Polar (portal klienta): sprawdzenie klucza licencyjnego wklejonego w panelu
      if (req.url === '/v1/customer-portal/license-keys/validate') {
        const b = JSON.parse(body);
        if (b.organization_id !== 'org-test' || b.key !== 'POSTER-TEST-KEY-1') {
          res.writeHead(404, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: 'ResourceNotFound', detail: 'License key not found.' }));
        }
        const expires = new Date(Date.now() + 300 * 86400000).toISOString();
        return send({ id: 'lk-1', key: b.key, status: 'granted', limit_activations: 2, expires_at: expires, activation: null });
      }
      send({ ok: true, result: { id: 1, username: 'test_bot' } });
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  dataDir = tmpDir();
  ui = await freePort();
  internal = await freePort();
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      TZ: 'Europe/Warsaw',
      POSTER_DATA_DIR: dataDir,
      POSTER_FILES_DIR: tmpDir(),
      PANEL_INTERNAL_TOKEN: TOKEN,
      PANEL_PORT_INTERNAL: String(ui),
      PANEL_INTERNAL_PORT: String(internal),
      PANEL_DISABLE_WORKERS: '1',
      POSTER_AI_RETRY_MS: '20',
      UPSTREAM_TELEGRAM: `http://127.0.0.1:${mock.address().port}`,
      UPSTREAM_GEMINI: `http://127.0.0.1:${mock.address().port}`,
      N8N_INTERNAL_URL: `http://127.0.0.1:${mock.address().port}`,
      UPSTREAM_YOUTUBE: `http://127.0.0.1:${mock.address().port}`,
      POLAR_API_URL: `http://127.0.0.1:${mock.address().port}`,
      POLAR_ORGANIZATION_ID: 'org-test',
    },
  });
  proc.stdout.on('data', (d) => (logs += d));
  proc.stderr.on('data', (d) => (logs += d));
  await waitFor(() => /API dla n8n/.test(logs) && /Panel:/.test(logs) && setupCodeFromLogs(), 15000, 'start panelu');
});

after(() => {
  if (proc) proc.kill();
  if (mock) mock.close();
});

test('strona panelu ma nagłówki bezpieczeństwa', async () => {
  const r = await fetch(url('/'));
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('sesja przed konfiguracją: potrzebne hasło, wersja i link do kodu', async () => {
  const s = await (await fetch(url('/api/session'))).json();
  assert.equal(s.needsSetup, true);
  assert.equal(s.authenticated, false);
  assert.match(s.version, /^\d+\.\d+\.\d+/);
  assert.match(s.projectUrl, /^https:\/\/github\.com\//);
  assert.equal(s.language, '', 'nowa instalacja: język jeszcze niewybrany');
  assert.equal(s.edition, 'lite');
  assert.match(s.productUrl, /^https:\/\//);
});

test('kod do ustawienia hasła jest w logach w obu językach', () => {
  const code = setupCodeFromLogs();
  assert.ok(logs.includes(`Panel setup code: ${code}`), logs);
});

test('przed wyborem języka błędy API są w języku ekranu (nagłówek x-poster-lang)', async () => {
  const bad = { password: 'mojehaslo123', code: 'AAAA-BBBB-CCCC' };
  const en = await (await json('POST', '/api/setup', bad, { 'x-poster-lang': 'en' })).json();
  assert.match(en.error.message, /^Invalid code\. .*grep -i code$/);
  const pl = await (await json('POST', '/api/setup', bad)).json();
  assert.match(pl.error.message, /^Nieprawidłowy kod\. .*grep -i kod$/);
});

test('hasła nie da się ustawić bez kodu z logów', async () => {
  assert.equal((await json('POST', '/api/setup', { password: 'mojehaslo123' })).status, 403);
  assert.equal((await json('POST', '/api/setup', { password: 'mojehaslo123', code: 'AAAA-BBBB-CCCC' })).status, 403);
  assert.equal((await (await fetch(url('/api/session'))).json()).needsSetup, true);
});

test('kod z logów ustawia hasło i język panelu, drugi raz już nie', async () => {
  const r = await json('POST', '/api/setup', { password: 'mojehaslo123', code: setupCodeFromLogs(), language: 'en' });
  assert.equal(r.status, 200);
  cookie = r.headers.get('set-cookie').split(';')[0];
  assert.match(cookie, /^poster_session=/);
  assert.equal((await json('POST', '/api/setup', { password: 'innehaslo123', code: setupCodeFromLogs() })).status, 409);
  assert.equal((await (await fetch(url('/api/session'))).json()).language, 'en');
});

test('język panelu: komunikaty serwera, domyślny język postów i zmiana w Ustawieniach', async () => {
  // bez nagłówka: język z ustawień (en)
  const missing = await (await json('GET', '/api/bots/nieistnieje')).json();
  assert.equal(missing.error.message, 'No such bot (maybe it was deleted)');
  const { bot } = await (await json('POST', '/api/bots', { name: 'Test' })).json();
  assert.equal(bot.language, 'angielski', 'nowy bot pisze posty w języku panelu (wartość dla promptu AI)');
  assert.equal((await json('DELETE', `/api/bots/${bot.id}`)).status, 200);
  // nieznany język nie zmienia ustawienia
  const keep = await (await json('PUT', '/api/settings', { global: { ui: { language: 'xx' } } })).json();
  assert.equal(keep.global.ui.language, 'en');
  const pl = await (await json('PUT', '/api/settings', { global: { ui: { language: 'pl' } } })).json();
  assert.equal(pl.global.ui.language, 'pl');
  assert.equal((await (await json('GET', '/api/bots/nieistnieje')).json()).error.message, 'Nie ma takiego bota (może został usunięty)');
});

test('TikTok i wideo tylko w wersji PRO', async () => {
  const { bot } = await (await json('POST', '/api/bots', { name: 'TikTok' })).json();
  const start = await json('POST', `/api/bots/${bot.id}/accounts/tiktok/start`);
  assert.equal(start.status, 400);
  const startMsg = (await start.json()).error.message;
  const settings = await (await json('GET', '/api/settings')).json();
  const ib = `http://127.0.0.1:${internal}`;
  const headers = { 'x-poster-token': TOKEN, 'content-type': 'application/json' };
  const anim = await fetch(`${ib}/internal/bots/${bot.id}/animation`, { method: 'POST', headers, body: '{}' });
  const gw = await fetch(`${ib}/gw/${bot.id}/tiktok/v2/post/publish/status/fetch/`, { method: 'POST', headers, body: '{}' });
  assert.match(startMsg, /Nieznana platforma/);
  assert.equal(settings.options.tiktokPrivacy, undefined);
  assert.equal(bot.publishing.tiktok, undefined);
  assert.equal(anim.status, 404, 'LITE: brak animacji wideo');
  assert.equal(gw.status, 404, 'LITE: bramka nie zna TikToka');
  assert.equal((await json('DELETE', `/api/bots/${bot.id}`)).status, 200);
});

test('Threads i Bluesky tylko w wersji PRO: konta, publikacja przez panel dla n8n', async () => {
  const { bot } = await (await json('POST', '/api/bots', { name: 'Social' })).json();
  const { bot: upd } = await (await json('PUT', `/api/bots/${bot.id}`, { publishing: { threads: true, bluesky: true } })).json();
  const start = await json('POST', `/api/bots/${bot.id}/accounts/threads/start`);
  const bsky = await json('POST', `/api/bots/${bot.id}/accounts/bluesky`, { identifier: 'kawiarnia', appPassword: 'haslo' });
  const settings = await (await json('GET', '/api/settings')).json();
  const view = await (await json('GET', `/api/bots/${bot.id}`)).json();
  const ib = `http://127.0.0.1:${internal}`;
  const headers = { 'x-poster-token': TOKEN, 'content-type': 'application/json' };
  const pub = await fetch(`${ib}/internal/bots/${bot.id}/publish/bluesky`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ draftId: 'd1', text: 'Test' }),
  });
  assert.equal(upd.publishing.threads, undefined);
  assert.equal(upd.publishing.bluesky, undefined);
  assert.match((await start.json()).error.message, /Nieznana platforma/);
  assert.equal(bsky.status, 404, 'LITE: brak konta Bluesky');
  assert.equal(settings.secrets.threadsAppSecret, undefined);
  assert.equal(view.tokens.threads, undefined);
  assert.equal(pub.status, 404, 'LITE: brak publikacji na Threads i Bluesky');
  assert.equal((await json('DELETE', `/api/bots/${bot.id}`)).status, 200);
});

test('kanał Telegram tylko w wersji PRO: podłączenie kanału, publikacja przez panel dla n8n', async () => {
  const { bot } = await (await json('POST', '/api/bots', { name: 'Kanał' })).json();
  const { bot: upd } = await (await json('PUT', `/api/bots/${bot.id}`, { publishing: { telegram: true } })).json();
  // link zaproszenia odrzucony, zanim panel zapyta Telegram
  const conn = await json('POST', `/api/bots/${bot.id}/accounts/telegram`, { channel: 'https://t.me/+AbCdEf' });
  const pub = await fetch(`http://127.0.0.1:${internal}/internal/bots/${bot.id}/publish/telegram`, {
    method: 'POST',
    headers: { 'x-poster-token': TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ draftId: 'd1', text: 'Test' }),
  });
  assert.equal(upd.publishing.telegram, undefined);
  assert.equal(conn.status, 404, 'LITE: brak kanału Telegram');
  assert.equal(pub.status, 404, 'LITE: brak publikacji na kanale Telegram');
  assert.equal((await json('DELETE', `/api/bots/${bot.id}`)).status, 200);
});

test('funkcje PRO: wiele botów, tryb strony, Instagram, grafika marki, autopilot i dostawcy tekstu', async () => {
  const { bot } = await (await json('POST', '/api/bots', { name: 'Pierwszy' })).json();
  const second = await json('POST', '/api/bots', { name: 'Drugi', mode: 'site' });
  const { bot: upd } = await (
    await json('PUT', `/api/bots/${bot.id}`, {
      mode: 'site',
      publishing: { instagram: true, requireApproval: false },
      content: { imageMode: 'brand', imageFallback: 'brand', textFallbackProvider: 'groq' },
      telegram: { chatId: '-100123' },
    })
  ).json();
  const settings = await (await json('GET', '/api/settings')).json();
  const providers = settings.options.textProviders.map((p) => p.id);
  const brand = await (await json('GET', `/api/bots/${bot.id}/brand-image`)).json();
  assert.equal(second.status, 403, 'LITE: jeden bot');
  assert.match((await second.json()).error.message, /LITE/);
  assert.equal(upd.mode, 'news');
  assert.equal(upd.site, undefined);
  assert.equal(upd.publishing.instagram, undefined);
  assert.equal(upd.publishing.requireApproval, undefined);
  assert.equal(upd.content.imageMode, 'source', 'LITE: bez grafiki marki');
  assert.equal(upd.content.imageFallback, undefined);
  assert.equal(upd.content.textFallbackProvider, undefined);
  assert.equal(upd.telegram.chatId, '', 'LITE: czat Telegram z Ustawień');
  assert.deepEqual(providers, ['gemini', 'ollama', 'custom']);
  assert.match(brand.error.message, /Nie ma takiego adresu API/);
  assert.equal((await json('DELETE', `/api/bots/${bot.id}`)).status, 200);
});

test('licencja PRO tego NAS-a: koniec aktualizacji na Pulpicie i w Ustawieniach (bez klucza)', async () => {
  const file = path.join(dataDir, 'license.json');
  const overview = async () => (await (await json('GET', '/api/overview')).json()).license;
  assert.equal((await overview()) ?? null, null, 'bez licencji (np. wdrożenie) – nic do pokazania');
  const until = new Date(Date.now() + 20 * 86400000).toISOString();
  const summary = { state: 'active', updatesUntil: until, checkedAt: new Date().toISOString(), keyEnd: 'ABC123' };
  fs.writeFileSync(file, JSON.stringify(summary));
  const l = await overview();
  const settings = await (await json('GET', '/api/settings')).json();
  fs.rmSync(file);
  assert.equal(l, undefined, 'LITE nie pokazuje licencji PRO');
  assert.equal(settings.license, undefined);
});

test('klucz licencyjny z panelu (oba wydania): sprawdzenie bez aktywacji, polecenie, klucz nie wraca do przeglądarki', async () => {
  let settings = await (await json('GET', '/api/settings')).json();
  assert.equal(settings.licenseKey.pending, null);
  assert.equal(settings.licenseKey.command, 'sudo bash scripts/upgrade-to-pro.sh', 'katalog projektu jeszcze nieznany');
  fs.writeFileSync(path.join(dataDir, 'install.json'), JSON.stringify({ projectDir: '/volume2/docker/poster' }));

  const bad = await (await json('POST', '/api/license/check', { key: 'NOPE-NOPE-1' })).json();
  assert.equal(bad.result, 'invalid');
  assert.match(bad.message, /Nieznany klucz licencyjny/);
  assert.equal(bad.pending, null);

  const r = await (await json('POST', '/api/license/check', { key: ' POSTER-TEST-KEY-1 ' })).json();
  assert.equal(r.result, 'ok');
  assert.equal(r.pending.hint, '••••EY-1');
  assert.equal(r.pending.limit, 2);
  assert.equal(r.command, 'sudo bash /volume2/docker/poster/scripts/upgrade-to-pro.sh');
  assert.ok(!mockHits.some((h) => /license-keys\/activate/.test(h.url)), 'panel nie aktywuje licencji');
  const file = path.join(dataDir, 'license-key.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  settings = await (await fetch(url('/api/settings'), { headers: { cookie } })).text();
  assert.ok(!settings.includes('POSTER-TEST-KEY-1'), 'przeglądarka widzi tylko końcówkę klucza');
  assert.equal(JSON.parse(settings).licenseKey.pending.hint, '••••EY-1');

  assert.equal((await json('POST', '/api/license/check', { key: 'abc' })).status, 400);
  assert.equal((await (await json('DELETE', '/api/license/key')).json()).pending, null);
  assert.ok(!fs.existsSync(file));
  const anon = await fetch(url('/api/license/check'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(anon.status, 401);
});

test('API wymaga logowania, a zmiany – typu JSON z tej samej strony (ochrona przed CSRF)', async () => {
  assert.equal((await fetch(url('/api/settings'))).status, 401);
  assert.equal((await fetch(url('/api/settings'), { headers: { cookie } })).status, 200);
  const botsBefore = (await (await json('GET', '/api/overview')).json()).bots.length;
  const form = await fetch(url('/api/bots'), {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'name=x',
  });
  assert.equal(form.status, 415);
  // „prosty” fetch z obcej strony (przeglądarka wysyła go bez pytania CORS): typ treści tylko udaje JSON
  const sneaky = await fetch(url('/api/bots'), {
    method: 'POST',
    headers: { cookie, 'content-type': 'text/plain; x=application/json' },
    body: JSON.stringify({ name: 'x' }),
  });
  assert.equal(sneaky.status, 415);
  // inna aplikacja pod adresem NAS-a (inny port) albo sąsiednia subdomena: ta sama witryna, inne pochodzenie
  const sameSite = await json('POST', '/api/bots', { name: 'x' }, { 'sec-fetch-site': 'same-site' });
  assert.equal(sameSite.status, 403);
  assert.match((await sameSite.json()).error.message, /z innej strony/);
  assert.equal((await json('POST', '/api/bots', { name: 'x' }, { 'sec-fetch-site': 'cross-site' })).status, 403);
  // starsza przeglądarka bez Sec-Fetch-Site: decyduje Origin
  assert.equal((await json('POST', '/api/bots', { name: 'x' }, { origin: 'http://127.0.0.1:1' })).status, 403);
  assert.equal((await json('POST', '/api/bots', { name: 'x' }, { origin: 'null' })).status, 403);
  assert.equal((await json('POST', '/api/logout', {}, { 'sec-fetch-site': 'same-site' })).status, 403, 'także bez logowania');
  assert.equal((await (await json('GET', '/api/overview')).json()).bots.length, botsBefore, 'żaden bot nie powstał');
  // panel w przeglądarce (same-origin), starsza przeglądarka z Origin panelu i reverse proxy (X-Forwarded-Host)
  const preview = (headers) => json('POST', '/api/schedule/preview', { schedule: {} }, headers);
  const own = await preview({ 'sec-fetch-site': 'same-origin' });
  assert.equal(own.status, 200);
  assert.deepEqual((await own.json()).hours, [8, 12, 16, 20], 'podgląd harmonogramu działa (w PRO także)');
  assert.equal((await preview({ origin: `http://127.0.0.1:${ui}` })).status, 200);
  assert.equal((await preview({ origin: 'https://poster.example.pl', 'x-forwarded-host': 'poster.example.pl' })).status, 200);
});

test('pliki draftów tylko po zalogowaniu i bez wychodzenia poza katalog', async () => {
  assert.equal((await fetch(url('/files/draft.json'))).status, 401);
  assert.equal((await fetch(url('/files/..%2f..%2fetc%2fpasswd'), { headers: { cookie } })).status, 404);
  assert.equal((await fetch(url('/%2e%2e/%2e%2e/etc/passwd'))).status, 404);
});

test('API wewnętrzne i bramka wymagają PANEL_INTERNAL_TOKEN', async () => {
  const ib = `http://127.0.0.1:${internal}`;
  assert.equal((await fetch(`${ib}/internal/health`)).status, 200);
  const send = (headers) => fetch(`${ib}/gw/_/telegram/sendMessage`, { method: 'POST', headers, body: '{}' });
  assert.equal((await send({})).status, 403);
  assert.equal((await send({ 'x-poster-token': 'zly-token-1234567890' })).status, 403);
  // poprawny token, ale bez tokenu bota Telegram w panelu
  assert.equal((await send({ 'x-poster-token': TOKEN })).status, 401);
});

test('bramka dokleja token Telegrama, a przeglądarka i usługa nie widzą sekretów', async () => {
  const secret = '123456:SEKRET-TELEGRAMA';
  assert.equal((await json('PUT', '/api/settings', { secrets: { telegramBotToken: secret } })).status, 200);
  const view = await (await fetch(url('/api/settings'), { headers: { cookie } })).text();
  assert.ok(!view.includes(secret), 'token nie trafia do przeglądarki');

  const r = await fetch(`http://127.0.0.1:${internal}/gw/_/telegram/sendMessage`, {
    method: 'POST',
    headers: { 'x-poster-token': TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: 1, text: 'test' }),
  });
  assert.equal(r.status, 200);
  const hit = mockHits.at(-1);
  assert.equal(hit.url, `/bot${secret}/sendMessage`);
  // poza listą zapytań workflow (np. przejęcie odbioru wiadomości bota) – odmowa bez doklejania tokenu
  const hook = await fetch(`http://127.0.0.1:${internal}/gw/_/telegram/setWebhook`, {
    method: 'POST',
    headers: { 'x-poster-token': TOKEN },
  });
  assert.equal(hook.status, 403);
  assert.notEqual(mockHits.at(-1).url, `/bot${secret}/setWebhook`);
  assert.equal(hit.headers['x-poster-token'], undefined, 'sekret panelu nie wychodzi poza bramkę');
});

test('własny post: wersje z AI, zlecenie „compose” do n8n, zdjęcie dla n8n i historia', async () => {
  const ib = `http://127.0.0.1:${internal}`;
  const headers = { 'x-poster-token': TOKEN, 'content-type': 'application/json' };
  const event = (e) => fetch(`${ib}/internal/events`, { method: 'POST', headers, body: JSON.stringify(e) });
  const runOf = async (id) => (await (await json('GET', '/api/overview')).json()).runs.find((r) => r.id === id);
  const settings = { global: { telegram: { chatId: '-100123' } }, secrets: { geminiApiKey: 'AIza-test-key' } };
  assert.equal((await json('PUT', '/api/settings', settings)).status, 200);
  const { bot } = await (await json('POST', '/api/bots', { name: 'Kawiarnia' })).json();
  assert.equal((await json('PUT', `/api/bots/${bot.id}`, { publishing: { x: true, facebook: true } })).status, 200);
  const view = (await (await json('GET', '/api/compose')).json()).bots.find((b) => b.id === bot.id);
  assert.deepEqual(
    view.platforms.filter((p) => p.enabled).map((p) => p.id),
    ['x', 'facebook'],
  );
  assert.deepEqual(view.problems, [], 'Telegram ustawiony – źródła i harmonogram nie są potrzebne');
  assert.deepEqual(view.aiProblems, []);

  const link = 'https://cafe.example/otwarcie';
  const adapt = await (
    await json('POST', `/api/bots/${bot.id}/compose/adapt`, { text: 'Otwarcie w sobotę', link, platforms: ['x', 'facebook'] })
  ).json();
  assert.equal(adapt.ai, 'gemini/gemini-3.8-flash');
  assert.deepEqual(adapt.variants, { x: `AI post_x #test\n\n${link}`, facebook: `AI post_facebook #test\n\n${link}` });

  // zdjęcie: nagłówek PNG 1080×1350
  const photo = Buffer.alloc(3000);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(photo, 0);
  photo.write('IHDR', 12, 'ascii');
  photo.writeUInt32BE(1080, 16);
  photo.writeUInt32BE(1350, 20);
  const body = {
    text: 'Otwarcie w sobotę',
    link,
    platforms: ['x', 'facebook'],
    posts: adapt.variants,
    image: { source: 'upload', data: `data:image/png;base64,${photo.toString('base64')}` },
    publishNow: true,
    ai: adapt.ai,
  };
  const sent = await json('POST', `/api/bots/${bot.id}/compose`, body);
  assert.equal(sent.status, 200);
  const { run } = await sent.json();
  assert.equal(run.kind, 'compose');
  assert.equal(run.status, 'running');
  assert.equal(run.title, 'Otwarcie w sobotę');
  const job = n8nJobs.at(-1);
  assert.equal(job.kind, 'compose');
  assert.equal(job.runId, run.id);
  assert.equal(job.config.botId, bot.id);
  assert.equal(job.compose.publishNow, true);
  assert.deepEqual(job.compose.posts, adapt.variants);
  // n8n odbiera zdjęcie przez API wewnętrzne (węzeł „Grafika: panel”)
  const img = await (
    await fetch(`${ib}/internal/bots/${bot.id}/image`, { method: 'POST', headers, body: JSON.stringify({ compose: job.compose.image }) })
  ).json();
  assert.equal(img.source, 'upload');
  assert.equal(img.data, photo.toString('base64'));
  assert.equal((await json('POST', `/api/bots/${bot.id}/compose`, body)).status, 409, 'podwójne kliknięcie – bez drugiej publikacji');

  // n8n zgłasza draft (publikacja od razu) i wynik publikacji
  const draftId = 'd20261019-1200-abcd';
  await event({ type: 'draft', runId: run.id, botId: bot.id, draftId, title: 'Otwarcie w sobotę', auto: true });
  assert.equal((await runOf(run.id)).status, 'publishing');
  await event({ type: 'publish', runId: run.id, botId: bot.id, draftId, status: 'published', results: { x: { ok: true } } });
  assert.equal((await runOf(run.id)).status, 'published');

  const ig = await (
    await json('POST', `/api/bots/${bot.id}/compose`, { ...body, platforms: ['instagram'], posts: { instagram: 'x' } })
  ).json();
  assert.match(ig.error.message, /Nieznana platforma: instagram/);
  assert.equal((await json('DELETE', `/api/bots/${bot.id}`)).status, 200);
});

test('post przez /api/compose: do akceptacji; PRO – kilka botów i zaplanowane posty (edycja, wyślij teraz, anulowanie)', async () => {
  const settings = { global: { telegram: { chatId: '-100123' } }, secrets: { geminiApiKey: 'AIza-test-key' } };
  assert.equal((await json('PUT', '/api/settings', settings)).status, 200);
  const { bot } = await (await json('POST', '/api/bots', { name: 'Kwiaciarnia' })).json();
  assert.equal((await json('PUT', `/api/bots/${bot.id}`, { publishing: { x: true, facebook: true } })).status, 200);
  const one = { id: bot.id, platforms: ['x'], posts: { x: 'Tulipany już są! #kwiaty' } };
  const base = { text: 'Tulipany już są', image: { source: 'none' }, bots: [one] };
  const r = await json('POST', '/api/compose', base);
  assert.equal(r.status, 200);
  const { runs, failed } = await r.json();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].kind, 'compose');
  assert.deepEqual(failed, []);
  assert.equal(n8nJobs.at(-1).compose.publishNow, false, 'draft do akceptacji w Telegramie');
  assert.equal((await json('POST', '/api/compose', { ...base, bots: [] })).status, 400);
  assert.equal((await json('POST', '/api/compose', { ...base, plan: { at: new Date(Date.now() + 3600000).toISOString() } })).status, 400);
  assert.equal((await json('DELETE', `/api/bots/${bot.id}`)).status, 200);
});

test('ten sam post wysłany dwa razy naraz (dwie karty, ponowienie): jedno zlecenie dla n8n, drugie zapytanie – 409', async () => {
  const settings = { global: { telegram: { chatId: '-100123' } }, secrets: { geminiApiKey: 'AIza-test-key' } };
  assert.equal((await json('PUT', '/api/settings', settings)).status, 200);
  const { bot } = await (await json('POST', '/api/bots', { name: 'Piekarnia' })).json();
  assert.equal((await json('PUT', `/api/bots/${bot.id}`, { publishing: { x: true } })).status, 200);
  const before = n8nJobs.length;
  n8nDelay = 300; // n8n odpowiada wolno – oba zapytania czekają na odpowiedź w tym samym czasie
  try {
    const one = { text: 'Świeże pieczywo', platforms: ['x'], posts: { x: 'Świeże pieczywo' }, image: { source: 'none' }, publishNow: true };
    const single = await Promise.all([1, 2].map(() => json('POST', `/api/bots/${bot.id}/compose`, one)));
    assert.deepEqual(single.map((r) => r.status).sort(), [200, 409]);
    const many = {
      bots: [{ id: bot.id, platforms: ['x'], posts: { x: 'Chleb na zakwasie' } }],
      text: 'Chleb na zakwasie',
      image: { source: 'none' },
      publishNow: true,
    };
    const batch = await Promise.all([1, 2].map(() => json('POST', '/api/compose', many)));
    assert.deepEqual(batch.map((r) => r.status).sort(), [200, 409]);
  } finally {
    n8nDelay = 0;
  }
  assert.equal(n8nJobs.length - before, 2, 'po jednym zleceniu na każdy post');
  assert.equal((await json('DELETE', `/api/bots/${bot.id}`)).status, 200);
});

test('n8n odrzuca token panelu (webhook z Header Auth): czytelny błąd z poleceniem naprawy', async () => {
  assert.equal((await json('PUT', '/api/settings', { global: { telegram: { chatId: '-100123' } } })).status, 200);
  const { bot } = await (await json('POST', '/api/bots', { name: 'Token' })).json();
  assert.equal((await json('PUT', `/api/bots/${bot.id}`, { publishing: { x: true } })).status, 200);
  n8nReject = true;
  try {
    const post = { text: 'Test tokenu', platforms: ['x'], posts: { x: 'Test tokenu' }, image: { source: 'none' } };
    const r = await json('POST', `/api/bots/${bot.id}/compose`, post);
    assert.equal(r.status, 502);
    assert.match((await r.json()).error.message, /odrzucił token panelu .*sudo bash scripts\/import-to-n8n\.sh/);
  } finally {
    n8nReject = false;
  }
  assert.equal((await json('DELETE', `/api/bots/${bot.id}`)).status, 200);
});

test('bot kanału YouTube (PRO): test kanału, pierwsze sprawdzenie, film z kolejki dla n8n, film wraca po błędzie', async () => {
  const settings = { global: { telegram: { chatId: '-100123' } }, secrets: { geminiApiKey: 'AIza-test-key' } };
  assert.equal((await json('PUT', '/api/settings', settings)).status, 200);
  const { bot } = await (await json('POST', '/api/bots', { name: 'Kanał', mode: 'youtube' })).json();
  const test = await json('POST', '/api/test/youtube', { channel: YT_CHANNEL });
  assert.equal(bot.mode, 'news', 'LITE: bez bota kanału YouTube');
  assert.equal(test.status, 404);
  assert.equal((await json('DELETE', `/api/bots/${bot.id}`)).status, 200);
});

test('AI przeciążone (503): przebieg bota ponawia w kolejnych rundach, edytor dostaje błąd od razu', async () => {
  const headers = { 'x-poster-token': TOKEN, 'content-type': 'application/json' };
  const settings = { global: { telegram: { chatId: '-100123' } }, secrets: { geminiApiKey: 'AIza-test-key' } };
  assert.equal((await json('PUT', '/api/settings', settings)).status, 200);
  const { bot } = await (await json('POST', '/api/bots', { name: 'Przeciążenie' })).json();
  assert.equal((await json('PUT', `/api/bots/${bot.id}`, { publishing: { x: true } })).status, 200);
  const llm = { system: 'Napisz post', user: 'Temat', schema: { type: 'OBJECT', properties: { post_x: { type: 'STRING' } } } };
  const ask = () =>
    fetch(`http://127.0.0.1:${internal}/internal/bots/${bot.id}/llm`, { method: 'POST', headers, body: JSON.stringify(llm) });

  // runda 1 i 2: po dwie odpowiedzi 503, runda 3: jedna 503 i tekst
  geminiBusy = 5;
  let calls = geminiCalls;
  const ok = await ask();
  assert.equal(ok.status, 200);
  const out = await ok.json();
  assert.equal(JSON.parse(out.text).post_x, 'AI post_x #test');
  assert.equal(out.fallbackUsed, false);
  assert.equal(geminiCalls - calls, 6);

  // przeciążenie dłuższe niż wszystkie rundy: 4 rundy po 2 próby, potem błąd z informacją o ponawianiu
  geminiBusy = 100;
  calls = geminiCalls;
  const fail = await ask();
  assert.equal(fail.status, 502);
  assert.match(
    (await fail.json()).error.message,
    /mimo ponawiania przez 1 min – Google Gemini \(gemini-3\.8-flash\): HTTP 503 – This model/,
  );
  assert.equal(geminiCalls - calls, 8);

  // edytor własnego posta: bez rund – dwie próby i od razu błąd
  calls = geminiCalls;
  const adapt = await json('POST', `/api/bots/${bot.id}/compose/adapt`, { text: 'Test', platforms: ['x'] });
  assert.equal(adapt.status, 502);
  assert.match((await adapt.json()).error.message, /^AI nie wygenerowało tekstu – Google Gemini/);
  assert.equal(geminiCalls - calls, 2);

  // błąd, którego ponowienie nie naprawi (zły klucz – HTTP 400): jedna próba, bez kolejnych rund
  geminiBusy = 0;
  geminiBadKey = true;
  calls = geminiCalls;
  const bad = await ask();
  geminiBadKey = false;
  assert.equal(bad.status, 502);
  assert.match(
    (await bad.json()).error.message,
    /^AI nie wygenerowało tekstu – Google Gemini \(gemini-3\.8-flash\): HTTP 400 – API key not valid/,
  );
  assert.equal(geminiCalls - calls, 1);
  assert.equal((await json('DELETE', `/api/bots/${bot.id}`)).status, 200);
});

test('test kanału RSS: wpisany adres także w sieci lokalnej, przekierowanie i kanał ze strony – tylko do internetu', async () => {
  let otherHits = 0;
  const other = http.createServer((req, res) => {
    otherHits++;
    res.end('<rss><channel><item><title>Sekret</title></item></channel></rss>');
  });
  const otherFeed = () => `http://127.0.0.1:${other.address().port}/feed.xml`;
  const page = (href) => `<!doctype html><html><head><link rel="alternate" type="application/rss+xml" href="${href}"></head></html>`;
  const feeds = http.createServer((req, res) => {
    if (req.url === '/feed.xml')
      return res.end('<rss><channel><item><title>Wpis A</title></item><item><title>Wpis B</title></item></channel></rss>');
    if (req.url === '/strona') return res.end(page('/feed.xml'));
    if (req.url === '/strona-obca') return res.end(page(otherFeed()));
    if (req.url === '/przekierowanie') {
      res.writeHead(302, { location: otherFeed() });
      return res.end();
    }
    res.writeHead(404);
    res.end();
  });
  await Promise.all([other, feeds].map((s) => new Promise((r) => s.listen(0, '127.0.0.1', r))));
  const base = `http://127.0.0.1:${feeds.address().port}`;
  const check = async (u) => (await json('POST', '/api/test/rss', { url: u })).json();
  try {
    // adres wpisany w panelu (np. RSSHub albo blog na NAS-ie) – zaufany
    let r = await check(`${base}/feed.xml`);
    assert.equal(r.ok, true, r.message);
    assert.deepEqual(r.titles, ['Wpis A', 'Wpis B']);
    r = await check(`${base}/strona`);
    assert.equal(r.discovered, `${base}/feed.xml`);
    // strona albo przekierowanie wskazuje inny serwer w sieci lokalnej – bez połączenia
    r = await check(`${base}/strona-obca`);
    assert.equal(r.ok, false);
    assert.match(r.message, /^To strona WWW, a nie kanał RSS/);
    r = await check(`${base}/przekierowanie`);
    assert.match(r.message, /^Brak połączenia: 127\.0\.0\.1 – port \d+ \(Poster pobiera tylko z portów 80 i 443\)$/);
    assert.equal(otherHits, 0);
  } finally {
    feeds.close();
    other.close();
  }
});

test('wyloguj na wszystkich urządzeniach (tylko z ważnej sesji); zły adres API – 400 zamiast błędu serwera', async () => {
  const anon = await fetch(url('/api/logout'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ everywhere: true }),
  });
  assert.equal(anon.status, 401, 'bez sesji nikt nie wyloguje właściciela');
  const bad = await json('GET', '/api/bots/%zz');
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error.message, /^(Niepoprawny adres|Invalid address)$/);

  const second = (await json('POST', '/api/login', { password: 'mojehaslo123' })).headers.get('set-cookie').split(';')[0];
  assert.equal((await json('POST', '/api/logout', { everywhere: true })).status, 200);
  for (const c of [cookie, second]) assert.equal((await fetch(url('/api/settings'), { headers: { cookie: c } })).status, 401);
  const again = await json('POST', '/api/login', { password: 'mojehaslo123' });
  cookie = again.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(url('/api/settings'), { headers: { cookie } })).status, 200);
});

test('reset hasła działa od razu: stara sesja wylogowana, nowy kod ustawia hasło', async () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'reset-password.js')], {
    env: { PATH: process.env.PATH, POSTER_DATA_DIR: dataDir },
    encoding: 'utf8',
  });
  const code = (out.match(/kod: ([A-Z0-9-]+)/) || [])[1];
  assert.ok(code, out);
  assert.equal((await fetch(url('/api/settings'), { headers: { cookie } })).status, 401);
  assert.equal((await (await fetch(url('/api/session'))).json()).needsSetup, true);

  const r = await json('POST', '/api/setup', { password: 'nowehaslo123', code }, { 'x-forwarded-proto': 'https' });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /; Secure/);
});

test('zmiana hasła: limit nieudanych prób obecnego hasła (z przejętą sesją nie da się go zgadywać)', async () => {
  const l = await json('POST', '/api/login', { password: 'nowehaslo123' });
  assert.equal(l.status, 200);
  cookie = l.headers.get('set-cookie').split(';')[0];
  let status;
  let n = 0;
  do {
    status = (await json('POST', '/api/password', { current: 'zlehaslo123', password: 'innehaslo999' })).status;
    n++;
  } while (status === 400 && n < 20);
  assert.equal(status, 429);
  assert.ok(n <= 9, `blokada po ${n} próbach`);
  assert.equal((await json('POST', '/api/password', { current: 'nowehaslo123', password: 'innehaslo999' })).status, 429);
});
