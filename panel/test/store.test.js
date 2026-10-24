'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Store, defaultBot } = require('../lib/store');
const { tmpDir } = require('./helpers');

// Zgodność wstecz: config.json sprzed nowych pól musi działać bez migracji
test('stary config.json: brakujące pola bota dostają wartości domyślne', () => {
  const dir = tmpDir();
  const old = {
    version: 1,
    global: { telegram: { chatId: '-100123' } },
    bots: [{ id: 'abc123', name: 'Stary bot', topic: 'technologie', paused: false, sources: { rss: ['https://example.com/rss'] } }],
  };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(old));
  const store = new Store(dir, {}, tmpDir());
  const bot = store.bot('abc123');
  assert.ok(bot, 'bot wczytany');
  assert.equal(bot.name, 'Stary bot');
  assert.equal(bot.mode, 'news');
  assert.equal(bot.content.imageMode, 'source');
  assert.deepEqual(bot.sources.rss, ['https://example.com/rss']);
  for (const key of Object.keys(defaultBot('x'))) assert.ok(key in bot, `pole ${key}`);
  assert.equal(store.global.telegram.chatId, '-100123');
  assert.equal(store.migrated, false);
});

test('config sprzed usunięcia grafiki AI: grafika marki zamiast AI, bez Veo i limitów, jeden klucz Gemini', () => {
  const dir = tmpDir();
  const ai = {
    id: 'abc123',
    name: 'Bot z grafiką AI',
    content: {
      imageMode: 'ai',
      imageFallback: 'ai',
      imageProvider: 'cloudflare',
      imageModel: 'm',
      aspectRatio: '4:5',
      imageSize: '2K',
      imageStyle: 'styl',
      videoMode: 'veo',
      videoModel: 'v',
    },
    limits: { enabled: true, aiImagesPerMonth: 5, aiVideosPerMonth: 1 },
  };
  const news = { id: 'def456', name: 'Bot ze zdjęciami', content: { imageMode: 'source', imageFallback: 'ai' } };
  const global = { ai: { cloudflare: { accountId: 'a'.repeat(32) }, openaiImages: { baseUrl: 'https://example.com/v1' } } };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ version: 1, global, bots: [ai, news] }));
  const secrets = {
    geminiApiKey: 'AIza-billing',
    geminiTextKey: 'AIza-free',
    cloudflareToken: 'cf',
    openaiImagesKey: 'ok',
    telegramBotToken: 't',
  };
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ global: secrets, bots: {} }));
  const store = new Store(dir, {}, tmpDir());
  const a = store.bot('abc123');
  assert.equal(a.content.imageMode, 'source');
  assert.equal(a.content.imageFallback, 'brand');
  for (const k of ['imageProvider', 'imageModel', 'aspectRatio', 'imageSize', 'imageStyle', 'videoMode', 'videoModel'])
    assert.ok(!(k in a.content), `bez pola ${k}`);
  assert.equal(a.limits, undefined);
  assert.equal(store.bot('def456').content.imageMode, 'source');
  assert.equal(store.bot('def456').content.imageFallback, 'brand');
  assert.deepEqual(Object.keys(store.global.ai), ['providers']);
  // tekst idzie dalej na ten sam (darmowy) klucz, a klucze dostawców grafiki AI znikają – także z pliku
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8')).global;
  assert.deepEqual(saved, { geminiApiKey: 'AIza-free', telegramBotToken: 't' });
  assert.deepEqual(store.secrets.global, saved);
});

test('pierwsze uruchomienie bez .env: pusta konfiguracja', () => {
  const store = new Store(tmpDir(), {}, tmpDir());
  assert.equal(store.migrated, true);
  assert.deepEqual(store.bots, []);
});

test('język panelu: stara konfiguracja zostaje po polsku, nowa czeka na wybór', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ version: 1, global: {}, bots: [] }));
  assert.equal(new Store(dir, {}, tmpDir()).global.ui.language, 'pl');
  const fresh = new Store(tmpDir(), {}, tmpDir());
  assert.equal(fresh.global.ui.language, '');
  // po zapisie wybór zostaje (także pusty) – ponowne wczytanie nie zamienia go na polski
  const again = new Store(fresh.dir, {}, tmpDir());
  assert.equal(again.global.ui.language, '');
  again.updateGlobal({ ui: { language: 'en' } });
  assert.equal(new Store(fresh.dir, {}, tmpDir()).global.ui.language, 'en');
  again.updateGlobal({ ui: { language: 'de' } });
  assert.equal(again.global.ui.language, 'en', 'nieznany język ignorowany');
});
