'use strict';
// Webhook jako platforma (wersja PRO).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Store, defaultBot } = require('../lib/store');
const { tmpDir } = require('./helpers');

test('webhook jest w wersji PRO', () => {
  const store = new Store(tmpDir());
  const bot = store.addBot({ name: 'Bot' });
  assert.equal(bot.publishing.webhook, undefined);
  assert.equal(defaultBot('abc123').accounts.webhook, undefined);
});
