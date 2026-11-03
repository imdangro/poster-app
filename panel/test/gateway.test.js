'use strict';
// Bramka API (panel/lib/gateway.js): przepuszcza tylko zapytania, których używa workflow Postera. Test sprawdza, że lista
// dozwolonych obejmuje każde wywołanie bramki w wygenerowanym workflow (węzły HTTP i węzły Code) – nowe zapytanie bez
// wpisu na liście zatrzyma się tutaj, a nie u użytkownika – i że inne zapytania (np. setWebhook bota Telegram, token
// strony na Facebooku) bramka odrzuca, zanim doklei klucze.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Store } = require('../lib/store');
const { UPSTREAM } = require('../lib/accounts');
const { Gateway, gatewayError, gatewayAllows } = require('../lib/gateway');
const { tmpDir } = require('./helpers');

const WORKFLOW = JSON.parse(fs.readFileSync(path.join(__dirname, '../../workflows/poster_workflow.json'), 'utf8'));
const GW = "={{ $('Config').first().json.gateway }}";

// wyrażenie n8n w adresie → przykładowa wartość (wersja Graph API, aktor Apify, ID strony / zdjęcia / posta)
const sample = (expr) => (/graphVersion/.test(expr) ? 'v24.0' : /actorId/.test(expr) ? 'apidojo~tweet-scraper' : '1234567890');
const split = (p) => {
  const m = p.match(/^\/([^/]+)(\/[^?]*)$/);
  assert.ok(m, `adres bramki bez usługi: ${p}`);
  return { service: m[1], rest: m[2] };
};

// wywołania bramki w węzłach Code (adres składany w JS) – każde musi być opisane tutaj
const CODE_CALLS = {};

test('lista dozwolonych obejmuje każde zapytanie workflow przez bramkę (węzły HTTP i Code)', () => {
  let http = 0;
  for (const node of WORKFLOW.nodes) {
    const p = node.parameters || {};
    if (node.type === 'n8n-nodes-base.httpRequest' && String(p.url || '').startsWith(GW)) {
      const { service, rest } = split(p.url.slice(GW.length).replace(/\{\{([^}]*)\}\}/g, (_, e) => sample(e)));
      const query = p.sendQuery ? new URLSearchParams((p.queryParameters.parameters || []).map((q) => [q.name, q.value])).toString() : '';
      const method = p.method || 'GET';
      assert.ok(gatewayAllows(service, method, rest, query), `„${node.name}”: ${method} /${service}${rest}?${query} poza listą bramki`);
      http++;
    }
    if (node.type === 'n8n-nodes-base.code') {
      const code = String(p.jsCode || '');
      for (const [tpl] of code.matchAll(/`\$\{cfg\.gateway\}[^`]*`/g)) {
        assert.ok(CODE_CALLS[tpl], `„${node.name}”: nowe zapytanie przez bramkę ${tpl} – dopisz je do ALLOWED (gateway.js) i tego testu`);
        for (const [method, url] of CODE_CALLS[tpl]) {
          const { service, rest } = split(url);
          assert.ok(gatewayAllows(service, method, rest), `„${node.name}”: ${method} ${url} poza listą bramki`);
        }
      }
      // każde użycie adresu bramki w kodzie (bez komentarzy) jest jednym z opisanych szablonów
      const uses = code.replace(/\/\/.*$/gm, '').match(/\.gateway\b/g) || [];
      assert.equal(uses.length, (code.match(/`\$\{cfg\.gateway\}/g) || []).length, `„${node.name}”: inne użycie bramki niż szablon adresu`);
    }
  }
  assert.ok(http >= 8, `za mało węzłów HTTP przez bramkę (${http}) – zmienił się format adresu?`);
});

test('poza listą: inne metody API, inna metoda HTTP, inne pola odczytu i doklejone segmenty ścieżki', () => {
  const blocked = [
    ['telegram', 'POST', '/getUpdates'],
    ['telegram', 'POST', '/setWebhook'],
    ['telegram', 'POST', '/logOut'],
    ['telegram', 'GET', '/sendMessage'],
    ['telegram', 'POST', '/sendMessage/../setWebhook'],
    ['x', 'GET', '/2/users/me'],
    ['x', 'POST', '/2/dm_conversations/with/1/messages'],
    ['meta', 'GET', '/v24.0/me/accounts'],
    ['meta', 'GET', '/v24.0/1234567890', '?fields=access_token'],
    ['meta', 'GET', '/v24.0/1234567890', '?fields=images&access_token=x'],
    ['meta', 'POST', '/v24.0/1234567890/photos/../conversations'],
    ['meta', 'DELETE', '/v24.0/1234567890'],
    ['tiktok', 'GET', '/v2/user/info/'],
    ['apify', 'GET', '/v2/users/me'],
    ['apify', 'POST', '/v2/acts/a~b/runs'],
    ['nieznana', 'POST', '/x'],
  ];
  for (const [service, method, rest, query] of blocked)
    assert.equal(gatewayAllows(service, method, rest, query), false, `${method} /${service}${rest}`);
  assert.equal(gatewayAllows('telegram', 'POST', '/sendPhoto'), true);
  assert.equal(gatewayAllows('meta', 'POST', '/v24.0/1234567890/feed'), true);
  assert.equal(gatewayAllows('meta', 'GET', '/v24.0/1234567890', '?fields=images'), false, 'LITE: bez Instagrama');
});

// bramka z atrapą Telegrama i Meta: zablokowane zapytanie nie dociera do platformy
let mock;
let hits;
const saved = { telegram: UPSTREAM.telegram, meta: UPSTREAM.meta };
before(async () => {
  hits = [];
  mock = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      hits.push({ method: req.method, url: req.url, auth: req.headers.authorization || '' });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true,"result":{}}');
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${mock.address().port}`;
  Object.assign(UPSTREAM, { telegram: base, meta: base });
});
after(() => {
  mock.close();
  Object.assign(UPSTREAM, saved);
});

test('bramka: zapytanie spoza listy – 403 bez kontaktu z platformą; dozwolone – z kluczem bota', async () => {
  const store = new Store(tmpDir());
  store.secrets.global.telegramBotToken = '123:abc';
  const bot = store.addBot({ name: 'Strona' });
  store.botSecrets(bot.id).meta = { pageToken: 'PAGE-TOKEN' };
  const gw = new Gateway(store, {});
  const warn = console.warn;
  const warnings = [];
  console.warn = (m) => warnings.push(m);
  const srv = http.createServer((req, res) => gw.handle(req, res).catch((e) => gatewayError(res, e)));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const call = (method, p, body) =>
    fetch(`http://127.0.0.1:${srv.address().port}${p}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    const hook = await call('POST', '/gw/_/telegram/setWebhook', { url: 'https://atakujacy.example/hook' });
    assert.equal(hook.status, 403);
    assert.match((await hook.json()).error.message, /POST \/telegram\/setWebhook jest zablokowane/);
    assert.equal((await call('GET', `/gw/${bot.id}/meta/v24.0/1234567890?fields=access_token`)).status, 403);
    assert.equal(hits.length, 0, 'zablokowane zapytania nie dotarły do platformy');
    assert.match(warnings.join('\n'), /zablokowano POST \/telegram\/setWebhook/);
    assert.equal(gw.stats.telegram.errors, 1);

    assert.equal((await call('POST', '/gw/_/telegram/sendMessage', { chat_id: 1, text: 'x' })).status, 200);
    assert.deepEqual(hits.at(-1), { method: 'POST', url: '/bot123:abc/sendMessage', auth: '' });
    assert.equal((await call('POST', `/gw/${bot.id}/meta/v24.0/1234567890/feed`, { message: 'x' })).status, 200);
    assert.deepEqual(hits.at(-1), { method: 'POST', url: '/v24.0/1234567890/feed', auth: 'Bearer PAGE-TOKEN' });
  } finally {
    console.warn = warn;
    srv.close();
  }
});
