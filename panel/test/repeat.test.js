'use strict';
// Posty cykliczne i kalendarz treści (PRO): reguła powtarzania i terminy (także przy zmianie czasu), seria
// w planerze (nowa wersja tekstów od AI, przegapione terminy, błędy, pomijanie, zmiana reguły) i dane kalendarza.
process.env.TZ = 'Europe/Warsaw'; // terminy liczymy w strefie kontenera – sprawdzamy też zmianę czasu
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpDir } = require('./helpers');

test('Posty cykliczne i kalendarz są w wersji PRO', () => {
  assert.equal(fs.existsSync(path.join(__dirname, '../lib/pro')), false);
  assert.ok(tmpDir());
});
