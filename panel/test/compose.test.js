'use strict';
// Własny post (✍️ Nowy post): limity platform, prompt, odpowiedź AI, sprawdzanie zlecenia, zdjęcie z panelu,
// wysyłka dla kilku botów naraz i zaplanowane posty (PRO).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Compose, xLength, fitX, titleOf, readInput, promptFor, plainVariants, parseAdapt } = require('../lib/compose');
const { defaultBot } = require('../lib/store');
const { tmpDir } = require('./helpers');

// Nagłówek PNG o podanych wymiarach – wystarcza do rozpoznania typu i wymiarów
function png(width, height, size = 4000) {
  const b = Buffer.alloc(size);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}
const dataUrl = (buf) => `data:image/png;base64,${buf.toString('base64')}`;

function setup({ failStart = false } = {}) {
  const dir = tmpDir();
  const started = [];
  const runner = {
    publishProblems: () => [],
    textProblems: () => [],
    start: async (bot, opts) => {
      if (failStart) throw new Error('n8n nie odpowiada');
      started.push(opts);
      return { id: `r${started.length}` };
    },
  };
  const ai = {
    prompts: [],
    async generateText(bot, req) {
      this.prompts.push(req);
      return {
        text: JSON.stringify({ post_x: 'Wersja AI na X #tag', post_facebook: 'Wersja AI na Facebooka' }),
        provider: 'gemini',
        model: 'm1',
        fallbackUsed: false,
      };
    },
  };
  const images = {};
  const compose = new Compose({}, { dataDir: dir, ai, runner, images });
  const bot = defaultBot('abc123', 'Kawiarnia');
  bot.publishing.x = true;
  bot.publishing.facebook = true;
  return { dir, compose, bot, started, ai };
}
const job = (over = {}) => ({
  text: 'Otwarcie w sobotę o 10:00',
  link: '',
  platforms: ['x', 'facebook'],
  posts: { x: 'Otwarcie w sobotę! #kawa', facebook: 'Otwarcie w sobotę o 10:00 – zapraszamy!' },
  image: { source: 'none' },
  ...over,
});

test('Limity platform: długość wg X, przycinanie z hashtagami, link na końcu', () => {
  assert.equal(xLength('https://example.com/bardzo/dlugi/adres?x=1'), 23);
  assert.equal(xLength('🎉 ok'), 5);
  const long = `${'słowo '.repeat(80)}#jeden #dwa #trzy`;
  const fitted = fitX(long);
  assert.ok(xLength(fitted) <= 280);
  assert.match(fitted, /…\n\n#jeden/);
  const v = plainVariants({ text: long, link: 'https://example.com/a', platforms: ['x', 'facebook'] });
  assert.ok(xLength(v.x) <= 280, v.x);
  assert.ok(v.x.endsWith('\n\nhttps://example.com/a'));
  assert.ok(v.facebook.endsWith('\n\nhttps://example.com/a'));
  assert.equal(titleOf('  \nPierwsza   linia\nDruga'), 'Pierwsza linia');
});

test('Wejście: treść, link i platformy są sprawdzane', () => {
  assert.throws(() => readInput({ text: ' ', platforms: ['x'] }), /Napisz treść posta/);
  assert.throws(() => readInput({ text: 'ok', link: 'example.com', platforms: ['x'] }), /http:\/\//);
  assert.throws(() => readInput({ text: 'ok', link: 'https://example.com/"><b>', platforms: ['x'] }), /http:\/\//);
  assert.throws(() => readInput({ text: 'ok', platforms: [] }), /co najmniej jedną platformę/);
  assert.throws(() => readInput({ text: 'ok', platforms: ['myspace'] }), /Nieznana platforma: myspace/);
  // kolejność platform jak w workflow
  assert.deepEqual(readInput({ text: 'ok', platforms: ['facebook', 'x'] }).platforms, ['x', 'facebook']);
  assert.throws(() => readInput({ text: 'ok', platforms: ['instagram'] }), /Nieznana platforma: instagram/);
});

test('Prompt: zasady „nie wymyślaj”, pola tylko dla wybranych platform, wskazówka i wytyczne bota', () => {
  const bot = { ...defaultBot('abc123', 'Kawiarnia'), instructions: 'Bez emoji na X.', language: 'polski' };
  const p = promptFor(bot, { text: 'Otwarcie w sobotę', link: '', hint: 'luźniej', platforms: ['x'] });
  assert.match(p.system, /Nie dodawaj faktów/);
  assert.match(p.system, /Bez emoji na X\./);
  assert.match(p.system, /WSKAZÓWKA AUTORA.*luźniej/);
  assert.deepEqual(p.schema.required, ['post_x']);
  assert.match(p.user, /^POST AUTORA:\nOtwarcie w sobotę$/);
  const withLink = promptFor(bot, { text: 'x', link: 'https://e.com', hint: '', platforms: ['x', 'facebook'] });
  assert.deepEqual(withLink.schema.required, ['post_x', 'post_facebook']);
  assert.match(withLink.user, /LINK W POŚCIE: https:\/\/e\.com/);
  assert.match(withLink.system, /link jest w bio/);
});

test('Odpowiedź AI: blok kodu, brakujące pole = tekst autora, link bez dublowania', () => {
  const input = { text: 'Tekst autora', link: 'https://example.com/a', hint: '', platforms: ['x', 'facebook'] };
  const r = parseAdapt('```json\n' + JSON.stringify({ post_x: 'Wpis https://example.com/a #tag', post_facebook: '' }) + '\n```', input);
  assert.equal(r.variants.x, 'Wpis #tag\n\nhttps://example.com/a');
  assert.deepEqual(r.missing, ['Facebook']);
  assert.equal(r.variants.facebook, 'Tekst autora\n\nhttps://example.com/a');
  assert.throws(
    () => parseAdapt('to nie JSON', input),
    (e) => e.status === 502,
  );
});

test('Dopasowanie: AI przez router panelu albo tekst autora bez AI', async () => {
  const { compose, bot, ai } = setup();
  const r = await compose.adapt(bot, { text: 'Otwarcie w sobotę', platforms: ['x', 'facebook'] });
  assert.equal(r.ai, 'gemini/m1');
  assert.deepEqual(r.variants, { x: 'Wersja AI na X #tag', facebook: 'Wersja AI na Facebooka' });
  assert.equal(ai.prompts.length, 1);
  const plain = await compose.adapt(bot, { text: 'Otwarcie w sobotę', platforms: ['x'], ai: false });
  assert.equal(plain.ai, null);
  assert.deepEqual(plain.variants, { x: 'Otwarcie w sobotę' });
  assert.equal(ai.prompts.length, 1, 'bez AI – bez zapytania');
  compose.runner.textProblems = () => ['brak klucza'];
  await assert.rejects(compose.adapt(bot, { text: 'x', platforms: ['x'] }), /AI nie jest gotowe: brak klucza/);
});

test('Zlecenie: platformy włączone w bocie, limity tekstów i zdjęcie', () => {
  const { compose, bot } = setup();
  bot.publishing.facebook = false;
  assert.throws(() => compose.prepare(bot, job()), /wyłączone w ustawieniach bota: Facebook/);
  bot.publishing.facebook = true;
  assert.throws(() => compose.prepare(bot, job({ posts: { x: 'a'.repeat(281), facebook: 'ok' } })), /Wpis na X ma 281\/280/);
  assert.throws(() => compose.prepare(bot, job({ posts: { x: 'ok' } })), /Brak tekstu dla: Facebook/);
  assert.throws(() => compose.prepare(bot, job({ image: { source: 'upload' } })), /Dodaj zdjęcie/);
  assert.throws(
    () => compose.prepare(bot, job({ image: { source: 'upload', data: Buffer.from('to nie obraz…').toString('base64') } })),
    /JPG albo PNG/,
  );
  assert.throws(() => compose.prepare(bot, job({ image: { source: 'upload', data: dataUrl(png(150, 150)) } })), /za małe/);
  const { job: ok } = compose.prepare(bot, job({ link: 'https://example.com/a', publishNow: true, ai: 'gemini/m1' }));
  assert.equal(ok.title, 'Otwarcie w sobotę o 10:00');
  assert.equal(ok.publishNow, true);
  assert.deepEqual(ok.image, { source: 'none' });
});

test('Wysyłka: zlecenie compose do n8n, zdjęcie w data/compose, bez dublowania', async () => {
  const { compose, bot, started, dir } = setup();
  const photo = png(1080, 1350);
  const run = await compose.send(bot, job({ image: { source: 'upload', data: dataUrl(photo) } }));
  assert.equal(run.id, 'r1');
  assert.equal(started[0].kind, 'compose');
  const sent = started[0].extra.compose;
  assert.deepEqual(sent.platforms, ['x', 'facebook']);
  assert.equal(sent.posts.x, 'Otwarcie w sobotę! #kawa');
  assert.match(sent.image.upload, /^[a-z0-9]{12}$/);
  assert.ok(fs.existsSync(path.join(dir, 'compose', `${sent.image.upload}.png`)));
  // n8n odbiera zdjęcie przez API wewnętrzne (węzeł „Grafika: panel”)
  const img = await compose.image(bot, sent.image);
  assert.equal(img.source, 'upload');
  assert.ok(img.buffer.equals(photo));
  assert.equal(img.width, 1080);
  const gone = await compose.image(bot, { source: 'upload', upload: 'aaaaaaaaaaaa' });
  assert.equal(gone.source, 'none');
  assert.equal(gone.warnings.length, 1);
  // ten sam post jeszcze raz (podwójne kliknięcie) – odrzucony
  await assert.rejects(compose.send(bot, job({ image: { source: 'upload', data: dataUrl(photo) } })), (e) => e.status === 409);
  assert.equal(started.length, 1);
  assert.equal(fs.readdirSync(path.join(dir, 'compose')).length, 1, 'odrzucony post nie zostawia zdjęcia');
});

test('Wysyłka: błąd startu usuwa zdjęcie i pozwala spróbować ponownie', async () => {
  const { compose, bot, dir } = setup({ failStart: true });
  await assert.rejects(compose.send(bot, job({ image: { source: 'upload', data: dataUrl(png(1080, 1080)) } })), /n8n nie odpowiada/);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'compose')), []);
  await assert.rejects(compose.send(bot, job()), /n8n nie odpowiada/, 'nie 409 – post nie poszedł');
});

test('Zdjęcia sprzed ponad 48 godzin są usuwane', () => {
  const { compose, dir } = setup();
  const id = compose.saveUpload({ buffer: png(800, 800), mimeType: 'image/png' });
  const file = path.join(dir, 'compose', `${id}.png`);
  const old = new Date(Date.now() - 49 * 3600 * 1000);
  fs.utimesSync(file, old, old);
  compose.cleanup();
  assert.ok(!fs.existsSync(file));
});

// ---------------------------------------------------------------------------------------------- jeden albo kilka botów
function batchSetup(opts) {
  const s = setup(opts);
  const second = defaultBot('def456', 'Piekarnia');
  second.publishing.x = true;
  const bots = [s.bot, second];
  s.compose.store = { bot: (id) => bots.find((b) => b.id === id) || null };
  return { ...s, second };
}
const batch = (bots, over = {}) => ({ text: 'Otwarcie w sobotę o 10:00', link: '', image: { source: 'none' }, bots, ...over });

test('Wysyłka przez /api/compose: jeden bot, braki i błąd startu jak przy pojedynczym poście', async () => {
  const { compose, bot, started } = batchSetup();
  const r = await compose.batch(batch([{ id: bot.id, platforms: ['x'], posts: { x: 'Otwarcie! #kawa' } }], { publishNow: true }));
  assert.equal(r.runs.length, 1);
  assert.deepEqual(r.failed, []);
  assert.equal(started[0].extra.compose.publishNow, true);
  await assert.rejects(compose.batch(batch([])), /co najmniej jednego bota/);
  await assert.rejects(compose.batch(batch([{ id: 'nope', platforms: ['x'], posts: { x: 'a' } }])), /Nie ma takiego bota/);
  await assert.rejects(compose.batch(batch([{ id: bot.id, platforms: ['x'], posts: {} }])), /^Error: Brak tekstu dla: X$/);
  const failing = batchSetup({ failStart: true });
  await assert.rejects(
    failing.compose.batch(batch([{ id: failing.bot.id, platforms: ['x'], posts: { x: 'a' } }])),
    /^Error: n8n nie odpowiada$/,
  );
});

test('LITE: post dla jednego bota, bez planowania', async () => {
  const { compose, bot, second } = batchSetup();
  const one = { id: bot.id, platforms: ['x'], posts: { x: 'A' } };
  await assert.rejects(compose.batch(batch([one, { ...one, id: second.id }])), /w wersji PRO/);
  await assert.rejects(compose.batch(batch([one], { plan: { at: new Date(Date.now() + 3600000).toISOString() } })), /w wersji PRO/);
});
