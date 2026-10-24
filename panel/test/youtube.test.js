'use strict';
// Bot „Kanał YouTube” (PRO): kanał RSS YouTube (Atom), kolejka filmów i obserwator kanału z lokalną atrapą YouTube.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Store, sanitizeBot, defaultBot } = require('../lib/store');
const { tmpDir } = require('./helpers');

test('kanał YouTube jest w wersji PRO – bot zostaje botem newsowym', () => {
  const store = new Store(tmpDir(), {}, tmpDir());
  const bot = store.addBot({ name: 'Bot' });
  assert.equal(sanitizeBot({ mode: 'youtube' }, bot).mode, 'news');
  assert.equal(defaultBot('abc123').youtube, undefined);
});
