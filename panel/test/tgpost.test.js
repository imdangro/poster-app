'use strict';
// Post z Telegrama (/post, PRO): komenda z tekstem albo zdjęcie z podpisem → wersje AI → zlecenie „compose” z draftem
// do akceptacji. Atrapa API Telegrama (wiadomości, getFile, plik zdjęcia); obsługę wiadomości wołamy bezpośrednio.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { Store } = require('../lib/store');
const { Telegram } = require('../lib/telegram');
const { tmpDir } = require('./helpers');

const CHAT = -1001;
const TOKEN = '123456:test-token';
// atrapa Telegrama: wywołania API i plik zdjęcia (photos/<nazwa>)
const tg = { calls: [], files: {} };
let mock;
before(async () => {
  mock = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const file = req.url.match(/^\/file\/bot[^/]+\/(.+)$/);
      if (file) {
        const buf = tg.files[file[1]];
        res.writeHead(buf ? 200 : 404, { 'content-type': 'application/octet-stream' });
        return res.end(buf || '');
      }
      const method = (req.url.match(/^\/bot[^/]+\/(\w+)$/) || [])[1];
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      tg.calls.push({ method, body });
      let result = true;
      if (method === 'sendMessage') result = { message_id: 500 + tg.calls.length, chat: { id: body.chat_id } };
      if (method === 'getFile') result = { file_id: body.file_id, file_path: `photos/${body.file_id}.jpg`, file_size: 1000 };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result }));
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  // adres Telegrama jest wyliczany przy wczytaniu lib/accounts.js – atrapę podstawiamy w gotowym obiekcie
  require('../lib/accounts').UPSTREAM.telegram = `http://127.0.0.1:${mock.address().port}`;
});
after(() => mock.close());

const sent = (method) => tg.calls.filter((c) => c.method === method);
const message = (text, extra = {}) => ({
  update_id: Date.now(),
  message: { message_id: 10, chat: { id: CHAT, type: 'supergroup', title: 'Drafty' }, from: { id: 5, first_name: 'Ala' }, text, ...extra },
});

test('/post w LITE: odpowiedź o wersji PRO, tylko w czacie ustawionym w Posterze', async () => {
  tg.calls.length = 0;
  const store = new Store(tmpDir(), {}, tmpDir());
  store.secrets.global.telegramBotToken = TOKEN;
  store.global.telegram.chatId = String(CHAT);
  const telegram = new Telegram(store, { filesDir: tmpDir(), onPublish: async () => {}, onReject: async () => {} });
  await telegram.handle({ ...message('/post Obcy'), message: { ...message('/post Obcy').message, chat: { id: -999 } } });
  assert.equal(sent('sendMessage').length, 0);
  await telegram.handle(message('/post Otwieramy w sobotę'));
  assert.match(sent('sendMessage')[0].body.text, /PRO: https:\/\//);
});
