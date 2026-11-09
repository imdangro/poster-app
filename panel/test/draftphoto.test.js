'use strict';
// Własne zdjęcie w drafcie (lib/draftphoto.js): odpowiedź zdjęciem na wiadomość draftu w Telegramie podmienia grafikę
// draftu przed ✅. Atrapa API Telegrama (wiadomości, getFile, plik zdjęcia, sendPhoto jako multipart); obsługę
// wiadomości wołamy bezpośrednio (telegram.handle).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Store } = require('../lib/store');
const { Telegram } = require('../lib/telegram');
const { DraftPhoto } = require('../lib/draftphoto');
const { Drafts } = require('../lib/drafts');
const { imageSize } = require('../lib/media');
const { tmpDir } = require('./helpers');

const CHAT = -1001;
const TOKEN = '123456:test-token';
const BOT_USER = { id: 123456, is_bot: true, first_name: 'Poster' };
const ID = 'd20261108-1405-ab12';

// atrapa Telegrama: wywołania API (JSON albo multipart) i pliki zdjęć (photos/<nazwa>)
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
      const raw = Buffer.concat(chunks);
      const type = req.headers['content-type'] || '';
      const body = type.includes('json') && raw.length ? JSON.parse(raw.toString('utf8')) : {};
      // multipart (sendPhoto ze zdjęciem): pola tekstowe i rozmiar pliku
      if (type.includes('multipart')) {
        const boundary = type.split('boundary=')[1];
        for (const part of raw.toString('latin1').split(`--${boundary}`)) {
          const h = part.match(/name="([^"]+)"(?:; filename="([^"]*)")?/);
          if (!h) continue;
          const value = part.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
          body[h[1]] =
            h[2] !== undefined ? { filename: h[2], bytes: Buffer.from(value, 'latin1') } : Buffer.from(value, 'latin1').toString('utf8');
        }
      }
      tg.calls.push({ method, body });
      let result = true;
      if (['sendMessage', 'sendPhoto'].includes(method)) result = { message_id: 900 + tg.calls.length, chat: { id: CHAT } };
      if (method === 'getFile') result = { file_id: body.file_id, file_path: `photos/${body.file_id}.bin`, file_size: 1000 };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result }));
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  require('../lib/accounts').UPSTREAM.telegram = `http://127.0.0.1:${mock.address().port}`;
});
after(() => mock.close());

let hasFfmpeg = true;
try {
  execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], { stdio: 'ignore' });
} catch (e) {
  hasFfmpeg = false;
}
const ffmpegOnly = { skip: !hasFfmpeg && 'brak ffmpeg' };
// prawdziwy obrazek (ffmpeg) – zdjęcie z Telegrama
function picture(file, size, ext = 'jpg') {
  const out = path.join(tmpDir(), `p.${ext}`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=s=${size}`, '-frames:v', '1', out]);
  tg.files[`photos/${file}.bin`] = fs.readFileSync(out);
}

// Panel z jednym botem i draftem na dysku (zdjęcie ze źródła)
function setup({ admins = ['5'], draft: draftChanges = {}, bot: botChanges = {}, publishing = false } = {}) {
  tg.calls.length = 0;
  const store = new Store(tmpDir());
  store.secrets.global.telegramBotToken = TOKEN;
  store.global.telegram.chatId = String(CHAT);
  store.global.telegram.adminIds = admins;
  const bot = store.addBot({ name: 'Kawiarnia' });
  store.updateBot(bot.id, { publishing: { x: true, facebook: true, ...(botChanges.publishing || {}) } });
  const filesDir = tmpDir();
  const draft = {
    draftId: ID,
    botId: bot.id,
    createdAt: '2026-11-08T13:05:00.000Z',
    status: 'draft',
    news: { title: 'Nowa sala', url: 'https://kawiarnia.example/sala', source: 'Kawiarnia' },
    post_x: 'Nowa sala #kawa',
    post_fb_insta: 'Post FB',
    image: { file: `${ID}.png`, mimeType: 'image/png', sizeBytes: 3, source: 'source' },
    imageMode: 'source',
    linkMode: false,
    results: {},
    ...draftChanges,
  };
  fs.writeFileSync(path.join(filesDir, `${ID}.json`), JSON.stringify(draft, null, 2));
  fs.writeFileSync(path.join(filesDir, `${ID}.png`), 'old');
  const telegram = new Telegram(store, { filesDir, onPublish: async () => {}, onReject: async () => {} });
  telegram.photo = new DraftPhoto(store, { telegram, filesDir, isPublishing: () => publishing });
  const read = () => JSON.parse(fs.readFileSync(path.join(filesDir, `${ID}.json`), 'utf8'));
  return { store, bot, filesDir, telegram, read };
}

// wiadomość draftu, na którą odpowiada użytkownik: nagłówek (kod draftu), przyciski albo zwykły tekst
const HEADER = { message_id: 70, from: BOT_USER, chat: { id: CHAT }, caption: `🆕 Nowy draft · 🤖 Kawiarnia · ${ID}\n📰 Nowa sala` };
const BUTTONS = {
  message_id: 72,
  from: BOT_USER,
  chat: { id: CHAT },
  text: '🧠 Tekst: gemini',
  reply_markup: {
    inline_keyboard: [
      [
        { text: '✅ Publikuj', callback_data: `pub:${ID}` },
        { text: '❌', callback_data: `rej:${ID}` },
      ],
    ],
  },
};
const TEXTS = { message_id: 71, from: BOT_USER, chat: { id: CHAT }, text: '🐦 X · 15/280\nNowa sala #kawa' };
let uid = 1;
const photoReply = (replyTo, extra = {}) => ({
  update_id: uid++,
  message: {
    message_id: 100 + uid,
    chat: { id: CHAT, type: 'supergroup' },
    from: { id: 5, username: 'ala' },
    photo: [
      { file_id: 'small', file_size: 900, width: 320, height: 240 },
      { file_id: 'big', file_size: 90000, width: 1280, height: 960 },
    ],
    reply_to_message: replyTo,
    ...extra,
  },
});
const replies = () => tg.calls.filter((c) => ['sendMessage', 'sendPhoto'].includes(c.method));

test('odpowiedź zdjęciem na nagłówek draftu: nowe zdjęcie w drafcie (JPG), stare usunięte, podgląd w Telegramie', ffmpegOnly, async () => {
  const t = setup();
  picture('big', '1280x960');
  await t.telegram.handle(photoReply(HEADER));
  const d = t.read();
  assert.match(d.image.file, new RegExp(`^${ID}-[a-z0-9]{4}\\.jpg$`));
  assert.equal(d.image.source, 'upload');
  assert.equal(d.image.mimeType, 'image/jpeg');
  assert.equal(d.linkMode, false);
  assert.deepEqual([d.image.width, d.image.height], [1280, 960]);
  assert.deepEqual(imageSize(fs.readFileSync(path.join(t.filesDir, d.image.file))), { width: 1280, height: 960 });
  assert.equal(fs.existsSync(path.join(t.filesDir, `${ID}.png`)), false, 'stare zdjęcie usunięte');
  assert.equal(d.post_x, 'Nowa sala #kawa', 'reszta draftu bez zmian');
  assert.deepEqual(
    tg.calls.filter((c) => c.method === 'getFile').map((c) => c.body.file_id),
    ['big'],
    'największy rozmiar zdjęcia',
  );
  const [preview] = replies();
  assert.equal(preview.method, 'sendPhoto');
  assert.match(preview.body.caption, new RegExp(`Zdjęcie podmienione</b> · <code>${ID}</code>`));
  assert.match(preview.body.caption, /✅ pod draftem opublikuje to zdjęcie\./);
  assert.ok(preview.body.photo.bytes.length > 1000, 'podgląd to nowe zdjęcie');
  assert.equal(JSON.parse(preview.body.reply_parameters).message_id > 100, true);

  // drafty: nowe zdjęcie należy do draftu – usuwanie starych draftów zabiera je razem z nim
  const drafts = new Drafts(t.filesDir, t.store);
  assert.equal(drafts.summary(`${ID}.json`).image, d.image.file);
  assert.equal(drafts.prune(1, { now: Date.now() + 3 * 86400e3 }), 1);
  assert.deepEqual(fs.readdirSync(t.filesDir), []);
});

test('draft rozpoznany po przyciskach ✅/❌ i po zapamiętanych wiadomościach draftu (teksty postów)', ffmpegOnly, async () => {
  let t = setup();
  picture('big', '800x800');
  await t.telegram.handle(photoReply(BUTTONS));
  assert.equal(t.read().image.source, 'upload');

  t = setup();
  // wiadomość z tekstami nie ma kodu draftu ani przycisków – zdarzenie „draft” z n8n podało jej ID
  await t.telegram.handle(photoReply(TEXTS));
  assert.equal(t.read().image.source, 'source', 'nieznana wiadomość – bez zmian');
  assert.equal(replies().length, 0);
  t.telegram.rememberDraft(CHAT, [70, 71, 72], ID);
  await t.telegram.handle(photoReply(TEXTS));
  assert.equal(t.read().image.source, 'upload');
});

test('uprawnienia i stan draftu: obcy czat, osoba spoza administratorów, publikacja w toku, po publikacji, odrzucony', async () => {
  // obcy czat – bez odpowiedzi
  let t = setup();
  await t.telegram.handle(photoReply(HEADER, { chat: { id: -999, type: 'group' } }));
  assert.equal(tg.calls.length, 0);
  // osoba spoza listy administratorów
  await t.telegram.handle(photoReply(HEADER, { from: { id: 77, username: 'obcy' } }));
  assert.match(replies()[0].body.text, /⛔ Zdjęcie w drafcie podmieni tylko osoba, która może zatwierdzać drafty/);
  // odpowiedź na wiadomość innej osoby (nie bota) – pomijamy
  tg.calls.length = 0;
  await t.telegram.handle(photoReply({ ...HEADER, from: { id: 5, is_bot: false } }));
  assert.equal(tg.calls.length, 0);

  const refused = async (opts, re) => {
    const s = setup(opts);
    await s.telegram.handle(photoReply(HEADER));
    assert.match(replies()[0].body.text, re);
    assert.equal(s.read().image.source, 'source');
    assert.equal(tg.calls.filter((c) => c.method === 'getFile').length, 0, 'bez pobierania zdjęcia');
    return s;
  };
  await refused({ publishing: true }, /⏳ Ten draft właśnie się publikuje/);
  await refused({ draft: { status: 'published' } }, /ℹ️ Ten draft jest już po publikacji/);
  await refused({ draft: { status: 'partial' } }, /ℹ️ Ten draft jest już po publikacji/);
  t = setup();
  t.store.state.drafts = { [ID]: { status: 'rejected' } };
  await t.telegram.handle(photoReply(HEADER));
  assert.match(replies()[0].body.text, /ℹ️ Ten draft jest odrzucony/);
  // draftu nie ma już na dysku (usunięty jako stary)
  t = setup();
  fs.rmSync(path.join(t.filesDir, `${ID}.json`));
  await t.telegram.handle(photoReply(HEADER));
  assert.match(replies()[0].body.text, /Nie znaleziono draftu <code>d20261108-1405-ab12<\/code>/);
});

test('pliki: zdjęcie jako plik (WebP, PNG), inny format, za duży plik, inny dokument i album', ffmpegOnly, async () => {
  const doc = (mime, extra = {}) => ({ document: { file_id: 'doc', mime_type: mime, file_size: 5000, ...extra } });
  let t = setup();
  await t.telegram.handle(photoReply(HEADER, { photo: undefined, ...doc('application/pdf') }));
  assert.equal(tg.calls.length, 0, 'PDF w odpowiedzi – to nie zdjęcie draftu');
  await t.telegram.handle(photoReply(HEADER, { photo: undefined, ...doc('image/heic') }));
  assert.match(replies()[0].body.text, /Wyślij zdjęcie jako zdjęcie albo plik JPG, PNG lub WebP/);
  tg.calls.length = 0;
  await t.telegram.handle(photoReply(HEADER, { photo: undefined, ...doc('image/jpeg', { file_size: 25 * 1024 * 1024 }) }));
  assert.match(replies()[0].body.text, /Zdjęcie może mieć najwyżej 20 MB/);

  // WebP jako plik → JPG
  t = setup();
  picture('doc', '640x480', 'webp');
  await t.telegram.handle(photoReply(HEADER, { photo: undefined, ...doc('image/webp') }));
  assert.match(t.read().image.file, /\.jpg$/);
  assert.deepEqual(imageSize(fs.readFileSync(path.join(t.filesDir, t.read().image.file))), { width: 640, height: 480 });

  // album: tylko pierwsze zdjęcie
  t = setup();
  picture('big', '1000x800');
  await t.telegram.handle(photoReply(HEADER, { media_group_id: 'album1' }));
  const first = t.read().image.file;
  await t.telegram.handle(photoReply(HEADER, { media_group_id: 'album1' }));
  assert.equal(t.read().image.file, first);
  assert.equal(replies().length, 1);

  // duże zdjęcie: najwyżej 2048 px
  t = setup();
  picture('big', '4000x3000');
  await t.telegram.handle(photoReply(HEADER));
  assert.deepEqual([t.read().image.width, t.read().image.height], [2048, 1536]);
});

test('tryb grafiki „link” (np. własna strona): X i Facebook dalej z linkiem, zdjęcie na pozostałe platformy', ffmpegOnly, async () => {
  const t = setup({ draft: { imageMode: 'link', linkMode: true, image: null } });
  picture('big', '1200x900');
  await t.telegram.handle(photoReply(HEADER));
  const d = t.read();
  assert.equal(d.linkMode, true);
  assert.equal(d.image.source, 'upload');
  assert.match(replies()[0].body.caption, /X i Facebook: post z linkiem \(tryb grafiki bota\)/);
  // draft bez zdjęcia (post z linkiem, bo źródło nie miało zdjęcia) – teraz zwykły post ze zdjęciem
  const u = setup({ draft: { imageMode: 'source', linkMode: true, image: null } });
  await u.telegram.handle(photoReply(HEADER));
  assert.equal(u.read().linkMode, false);
});

test('pamięć wiadomości draftów: ograniczona liczba, złe dane pomijane', () => {
  const t = setup();
  for (let i = 1; i <= 400; i++) t.telegram.rememberDraft(CHAT, [i * 3, i * 3 + 1, i * 3 + 2], `d20261108-1405-a${i}`);
  const map = t.store.state.telegram.draftMessages;
  assert.equal(Object.keys(map).length, 900);
  assert.equal(t.telegram.draftOfMessage(CHAT, 3), null, 'najstarsze wypadły');
  assert.equal(t.telegram.draftOfMessage(CHAT, 1201), 'd20261108-1405-a400');
  t.telegram.rememberDraft(CHAT, ['x', -1, 5.5], ID);
  t.telegram.rememberDraft(CHAT, [5000], '../zly');
  assert.equal(t.telegram.draftOfMessage(CHAT, 5000), null);
});
