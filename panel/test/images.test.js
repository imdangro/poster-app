'use strict';
// Grafika do posta wg trybu bota. Zdjęć ze źródeł test nie pobiera (news bez zdjęć i bez adresu – bez sieci).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Images } = require('../lib/images');
const { defaultBot } = require('../lib/store');
const { tmpDir } = require('./helpers');

test('grafika: bez zdjęcia w źródle – post bez grafiki', async () => {
  const images = new Images({ state: {}, saveState() {} });
  const bot = defaultBot('abc123', 'Kawiarnia');
  const r = await images.resolve(bot, { news: {} });
  assert.equal(r.source, 'none');
  assert.deepEqual(r.warnings, ['brak odpowiedniego zdjęcia w źródle']);
  bot.content.imageMode = 'none';
  assert.deepEqual((await images.resolve(bot, { news: {} })).warnings, []);
});
