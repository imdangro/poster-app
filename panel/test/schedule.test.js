'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scheduleHours, nextSlots, dueSlot } = require('../lib/schedule');

test('co N godzin w oknie od–do, także przez północ', () => {
  assert.deepEqual(scheduleHours({ mode: 'interval', every: 4, from: 8, to: 20 }), [8, 12, 16, 20]);
  assert.deepEqual(scheduleHours({ mode: 'interval', every: 2, from: 20, to: 2 }), [0, 2, 20, 22]);
  assert.deepEqual(scheduleHours({ mode: 'interval', every: 5, from: 8, to: 20 }), [8, 12, 16, 20], 'nieznany odstęp → co 4 h');
});

test('wybrane godziny: bez powtórzeń, posortowane, tylko 0–23', () => {
  assert.deepEqual(scheduleHours({ mode: 'hours', hours: [18, 9, 9, 24, -1, 13] }), [9, 13, 18]);
});

test('najbliższe terminy z minutą i dniami tygodnia', () => {
  const s = { mode: 'hours', hours: [9, 18], minute: 5, days: [1, 2, 3, 4, 5] };
  const now = new Date(2026, 9, 9, 10, 0); // piątek 9.10.2026, 10:00
  const next = nextSlots(s, now, 3);
  assert.deepEqual(
    next.map((d) => [d.getDate(), d.getHours(), d.getMinutes()]),
    [
      [9, 18, 5],
      [12, 9, 5], // poniedziałek – weekend pominięty
      [12, 18, 5],
    ],
  );
});

test('losowe przesunięcie: stałe dla bota, w zakresie 0–N min', () => {
  const s = { mode: 'hours', hours: [8, 12, 16, 20], minute: 0, jitter: 30 };
  const now = new Date(2026, 9, 12, 0, 0);
  const a = nextSlots(s, now, 4, 'bot1');
  assert.deepEqual(a, nextSlots(s, now, 4, 'bot1'), 'to samo po „restarcie”');
  for (const d of a) {
    const offsetMin = d.getMinutes() + (d.getHours() % 4) * 60;
    assert.ok(offsetMin >= 0 && offsetMin < 30, `przesunięcie ${offsetMin} min`);
  }
  const b = nextSlots(s, now, 4, 'bot2');
  assert.notDeepEqual(a, b, 'inny bot ma inne przesunięcia');
});

test('termin do uruchomienia: najwyżej 10 min po czasie, starszych nie nadrabia', () => {
  const s = { mode: 'hours', hours: [12], minute: 0 };
  assert.equal(dueSlot(s, new Date(2026, 9, 12, 12, 5))?.key, '2026-10-12T12:00');
  assert.equal(dueSlot(s, new Date(2026, 9, 12, 12, 30)), null);
  assert.equal(dueSlot(s, new Date(2026, 9, 12, 11, 59)), null);
});
