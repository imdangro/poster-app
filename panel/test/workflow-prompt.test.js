'use strict';
// Węzeł n8n „Przygotuj prompt LLM” (workflows/src/code/build_prompt.js) uruchomiony w piaskownicy z atrapami $(),
// $input, $now i DateTime – tak jak w n8n, bez require.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CODE = fs.readFileSync(path.join(__dirname, '../../workflows/src/code/build_prompt.js'), 'utf8');

function systemPrompt(cfg) {
  const json = { brandName: 'Kosmos', topic: 'astronomia', language: 'polski', maxCandidates: 5, instructions: '', ...cfg };
  const article = { title: 'Nowa mgławica', summary: 'Teleskop uchwycił mgławicę.', source: 'NASA', sourceType: 'rss' };
  const sandbox = {
    $: () => ({ first: () => ({ json }) }),
    $input: { first: () => ({ json: { articles: [{ ...article, publishedAt: '2026-10-29T10:00:00Z' }] } }) },
    $now: { zoneName: 'Europe/Warsaw' },
    DateTime: { fromISO: () => ({ setZone: () => ({ toFormat: () => '29.10 11:00' }) }) },
    console,
  };
  const [item] = vm.runInNewContext(`(function () {\n${CODE}\n})()`, sandbox);
  return item.json.llm.system;
}

test('skrypt TikToka: nazwy sekcji w języku postów (po polsku polskie, w innych językach angielskie)', () => {
  const pl = systemPrompt({ language: 'polski' });
  assert.match(pl, /🔎 ROZWINIĘCIE \(10–45 s\)/);
  assert.match(pl, /💬 NAPISY NA EKRANIE:/);
  for (const language of ['angielski', 'niemiecki', 'English']) {
    const other = systemPrompt({ language });
    assert.match(other, /🔎 DETAILS \(10–45 s\)/);
    assert.match(other, /💬 ON-SCREEN TEXT:/);
    assert.doesNotMatch(other, /ROZWINIĘCIE|NAPISY NA EKRANIE/);
  }
});
