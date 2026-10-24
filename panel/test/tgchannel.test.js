'use strict';
// Kanał Telegram (PRO): sprawdzenie i podłączenie kanału (bot Telegram panelu jako administrator), publikacja przez
// panel z atrapą Bot API (zdjęcie z podpisem, wiadomość z podglądem linku, 429, grupa → supergrupa), ostrzeżenia.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Store, defaultBot } = require('../lib/store');
const { tmpDir } = require('./helpers');

test('kanał Telegram jest w wersji PRO', () => {
  const store = new Store(tmpDir(), {}, tmpDir());
  const bot = store.addBot({ name: 'Bot' });
  assert.equal(bot.publishing.telegram, undefined);
  assert.equal(defaultBot('abc123').accounts.telegram, undefined);
});
