'use strict';
// Threads i Bluesky (PRO): konta (OAuth Threads, hasło aplikacji Bluesky), publikacja przez panel z atrapami Threads,
// serwera Bluesky (PDS) i Graph API Facebooka (hostowanie zdjęcia), tekst (grafemy, emoji, odnośniki w bajtach UTF-8).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Store, defaultBot } = require('../lib/store');
const { tmpDir } = require('./helpers');

test('Threads i Bluesky są w wersji PRO', () => {
  const store = new Store(tmpDir(), {}, tmpDir());
  const bot = store.addBot({ name: 'Bot' });
  assert.equal(bot.publishing.threads, undefined);
  assert.equal(defaultBot('abc123').accounts.bluesky, undefined);
  assert.equal(store.global.threads, undefined);
});
