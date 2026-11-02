'use strict';
// Niepewna publikacja (brak odpowiedzi platformy – post mógł się ukazać): rozpoznanie błędu bez odpowiedzi, bramka
// (504 zamiast 502) i przyciski w Telegramie (puc – post jest na profilu, pua – wyślij ponownie) w zleceniu publikacji.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Store } = require('../lib/store');
const { UPSTREAM } = require('../lib/accounts');
const { Gateway, gatewayError } = require('../lib/gateway');
const { Telegram } = require('../lib/telegram');
const { fetchJson, noAnswer } = require('../lib/util');
const { tmpDir, freePort } = require('./helpers');

// atrapa serwera: …/drop – zapytanie przyjęte, połączenie zerwane bez odpowiedzi; …/hang – bez odpowiedzi; reszta – 200
let mock;
let base;
before(async () => {
  mock = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (req.url.endsWith('/drop')) return req.socket.destroy();
      if (req.url.endsWith('/hang')) return;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true,"result":{}}');
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${mock.address().port}`;
});
after(() => {
  mock.closeAllConnections();
  mock.close();
});

test('brak odpowiedzi: przekroczony czas i zerwane połączenie – tak; odmowa połączenia i DNS – nie', async () => {
  assert.equal(noAnswer(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), true);
  assert.equal(noAnswer({ cause: { code: 'UND_ERR_SOCKET' } }), true);
  assert.equal(noAnswer({ cause: { code: 'ECONNRESET' } }), true);
  assert.equal(noAnswer({ cause: { code: 'ECONNREFUSED' } }), false);
  assert.equal(noAnswer({ cause: { code: 'ENOTFOUND' } }), false);
  assert.equal(noAnswer(null), false);

  const dropped = await fetchJson(`${base}/drop`, { method: 'POST', body: '{}' }).catch((e) => e);
  assert.equal(dropped.noAnswer, true);
  assert.match(dropped.message, /^Brak odpowiedzi od 127\.0\.0\.1:\d+: /);
  const slow = await fetchJson(`${base}/hang`, { method: 'POST', body: '{}', timeout: 300 }).catch((e) => e);
  assert.equal(slow.noAnswer, true);
  assert.match(slow.message, /przekroczono czas/);
  const closed = await freePort(); // nikt na nim nie słucha
  const refused = await fetchJson(`http://127.0.0.1:${closed}/x`).catch((e) => e);
  assert.equal(refused.noAnswer, undefined);
  assert.match(refused.message, /^Brak połączenia z 127\.0\.0\.1:\d+: ECONNREFUSED/);
});

test('bramka: połączenie zerwane po wysłaniu – 504 „Brak odpowiedzi”; nieudane połączenie – 502', async () => {
  const store = new Store(tmpDir(), {}, tmpDir());
  store.secrets.global.telegramBotToken = '123:abc';
  store.secrets.global.apifyToken = 'apify-token';
  const saved = { telegram: UPSTREAM.telegram, apify: UPSTREAM.apify };
  Object.assign(UPSTREAM, { telegram: base, apify: `http://127.0.0.1:${await freePort()}` });
  const gw = new Gateway(store, {});
  const srv = http.createServer((req, res) => gw.handle(req, res).catch((e) => gatewayError(res, e)));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const gwBase = `http://127.0.0.1:${srv.address().port}`;
  try {
    const post = (p) => fetch(`${gwBase}${p}`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    const dropped = await post('/gw/_/telegram/drop');
    assert.equal(dropped.status, 504);
    assert.match((await dropped.json()).error.message, /^Brak odpowiedzi od 127\.0\.0\.1:\d+: \w+/);
    const refused = await post('/gw/_/apify/v2/acts');
    assert.equal(refused.status, 502);
    assert.match((await refused.json()).error.message, /^Panel nie może połączyć się z 127\.0\.0\.1:\d+: ECONNREFUSED/);
    const fine = await post('/gw/_/telegram/getMe');
    assert.equal(fine.status, 200);
  } finally {
    srv.close();
    Object.assign(UPSTREAM, saved);
  }
});

test('Telegram: „✅ Jest na profilu” i „📤 Nie ma – wyślij” – zlecenie publikacji z decyzją, zwykłe ✅ bez niej', async () => {
  const filesDir = tmpDir();
  const store = new Store(tmpDir(), {}, filesDir);
  store.updateGlobal({ telegram: { chatId: '-100777' } });
  fs.writeFileSync(path.join(filesDir, 'd1.json'), JSON.stringify({ draftId: 'd1', status: 'unknown' }));
  const published = [];
  let failNext = false;
  const telegram = new Telegram(store, {
    filesDir,
    onPublish: async (draft, ctx) => {
      if (failNext) {
        failNext = false;
        throw new Error('n8n nie odpowiada');
      }
      published.push(ctx);
    },
    onReject: async () => {},
  });
  const calls = [];
  telegram.call = async (method, params) => {
    calls.push({ method, params });
    return {};
  };
  const click = (data, chatId = -100777) =>
    telegram.handle({
      callback_query: { id: 'q1', data, from: { id: 5, username: 'ania' }, message: { message_id: 9, chat: { id: chatId } } },
    });
  await click('puc:d1');
  await click('pua:d1');
  await click('pub:d1');
  assert.deepEqual(
    published.map((c) => c.unknown),
    ['confirm', 'retry', undefined],
  );
  assert.deepEqual(published[0], { draftId: 'd1', chatId: -100777, messageId: 9, from: '@ania', unknown: 'confirm' });
  const marks = () => calls.filter((c) => c.method === 'editMessageReplyMarkup').map((c) => c.params.reply_markup.inline_keyboard[0][0]);
  assert.deepEqual(
    marks().map((b) => b.text),
    ['⏳ Zapisuję…', '⏳ Publikuję…', '⏳ Publikuję…'],
  );

  // zlecenie się nie udało – przycisk „Spróbuj ponownie” powtarza tę samą decyzję
  failNext = true;
  await click('puc:d1');
  assert.equal(marks().at(-1).callback_data, 'puc:d1');
  // nieznana akcja i obcy czat – bez zlecenia
  await click('pux:d1');
  await click('pua:d1', -100999);
  assert.equal(published.length, 3);
});
