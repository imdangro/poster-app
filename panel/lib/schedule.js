'use strict';
// Harmonogram botów w czasie lokalnym kontenera (zmienna TZ, domyślnie Europe/Warsaw).
//   mode "interval": co N godzin w oknie od–do (np. co 4 h od 8 do 20 → 8, 12, 16, 20)
//   mode "hours":    dowolnie wybrane godziny
// Dni tygodnia: 1 = poniedziałek … 7 = niedziela.
// jitter: losowe przesunięcie każdego terminu o 0–N minut (np. 8:00 → 8:17, 12:00 → 12:41), żeby bot
// nie odpytywał X i nie publikował co do minuty. Przesunięcie zależy od bota i terminu, więc nie zmienia
// się po restarcie panelu; klucz terminu (slotKey) zostaje bez przesunięcia.
const crypto = require('crypto');

const INTERVALS = [1, 2, 3, 4, 6, 8, 12, 24];
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const JITTERS = [0, 15, 30, 45];

function scheduleHours(s) {
  if (!s) return [];
  if (s.mode === 'hours') return [...new Set((s.hours || []).map(Number))].filter((h) => h >= 0 && h <= 23).sort((a, b) => a - b);
  const every = INTERVALS.includes(Number(s.every)) ? Number(s.every) : 4;
  const from = clampHour(s.from, 8);
  let to = clampHour(s.to, 20);
  if (to < from) to += 24; // okno przez północ, np. 20 → 2
  const out = [];
  for (let h = from; h <= to; h += every) out.push(h % 24);
  return [...new Set(out)].sort((a, b) => a - b);
}

function clampHour(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 && n <= 23 ? n : def;
}

const weekday = (d) => ((d.getDay() + 6) % 7) + 1;
const pad = (n) => String(n).padStart(2, '0');
const slotKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

// Przesunięcie terminu w ms: 0 … jitter min, stałe dla pary (seed = ID bota, termin)
function jitterMs(s, seed, base) {
  const max = JITTERS.includes(Number(s.jitter)) ? Number(s.jitter) : 0;
  if (!max || !seed) return 0;
  const h = crypto
    .createHash('sha1')
    .update(`${seed}|${slotKey(base)}`)
    .digest();
  return (h.readUInt32BE(0) % (max * 60)) * 1000;
}

// Terminy dnia: { key: termin bez przesunięcia (do pamięci „już uruchomiono”), at: faktyczna godzina startu }
function slotsOnDay(s, day, seed) {
  const days = Array.isArray(s.days) && s.days.length ? s.days : ALL_DAYS;
  if (!days.includes(weekday(day))) return [];
  const minute = Math.min(59, Math.max(0, parseInt(s.minute, 10) || 0));
  return scheduleHours(s).map((h) => {
    const base = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, minute, 0, 0);
    return { key: slotKey(base), at: new Date(base.getTime() + jitterMs(s, seed, base)) };
  });
}

// Najpóźniejszy termin ≤ now, ale nie starszy niż graceMs (po restarcie NAS-a nie nadrabiamy starych terminów).
function dueSlot(s, now = new Date(), graceMs = 10 * 60 * 1000, seed = '') {
  let best = null;
  for (const offset of [-1, 0]) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    for (const t of slotsOnDay(s, day, seed)) {
      if (t.at <= now && now - t.at < graceMs && (!best || t.at > best.at)) best = t;
    }
  }
  return best;
}

// Najbliższe faktyczne godziny startu (z przesunięciem)
function nextSlots(s, now = new Date(), count = 5, seed = '') {
  const out = [];
  // od wczoraj: przesunięty termin z 23:xx może wypaść już po północy
  for (let offset = -1; offset < 15 && out.length < count; offset++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    for (const t of slotsOnDay(s, day, seed)) if (t.at > now && out.length < count) out.push(t.at);
  }
  return out;
}

module.exports = { INTERVALS, ALL_DAYS, JITTERS, scheduleHours, dueSlot, nextSlots, slotKey };
