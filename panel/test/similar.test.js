'use strict';
// Sprawdzanie powtórek (lib/similar.js): porównanie draftu z postami bota bez AI, pamięć postów (z dysku i ze zdarzeń
// n8n), statusy, okno dni i czułość.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpDir } = require('./helpers');
const { Similar, THRESHOLDS, fold, stem, fingerprint, compare, normalizeUrl } = require('../lib/similar');
const { Drafts } = require('../lib/drafts');

// ta sama historia z dwóch portali (AI pisze inaczej) i inna historia z tego samego tematu
const POSTS = {
  delayA: {
    title: 'SpaceX przesuwa start Starshipa na 20 listopada',
    post_x:
      '🚀 SpaceX znów przekłada lot Starshipa! Nowy termin startu to 20 listopada. Powód: wymiana silnika Raptor w boosterze Super Heavy. #SpaceX #Starship',
    post_fb_insta:
      '🚀 Starship poleci później, niż planowano!\n\nSpaceX poinformowało, że 9. lot testowy Starshipa odbędzie się najwcześniej 20 listopada. Wcześniej start planowano na 15 listopada.\n\n🔧 Powodem jest wymiana jednego z silników Raptor w boosterze Super Heavy.\n\nŹródło: Spidersweb\n\n#SpaceX #Starship #kosmos',
    source: 'Spidersweb',
  },
  delayB: {
    title: 'Lot Starshipa opóźniony – nowa data to 20 listopada',
    post_x:
      'Starship poczeka kilka dni dłużej ⏳ SpaceX ustaliło nowy termin 9. lotu testowego: 20 listopada. Wcześniej mówiono o 15.11. #Starship',
    post_fb_insta:
      '⏳ Kolejne opóźnienie Starshipa\n\nFirma Elona Muska przesunęła 9. lot testowy rakiety Starship na 20 listopada. Pierwotnie start miał nastąpić 15 listopada.\n\n🔧 Inżynierowie wymieniają silnik Raptor w pierwszym stopniu.\n\nŹródło: Komputer Świat\n\n#Starship #SpaceX',
    source: 'Komputer Świat',
  },
  launch: {
    title: 'Starship wystartował! Booster złapany przez wieżę',
    post_x:
      '🔥 Udany 9. lot Starshipa! Booster Super Heavy wrócił na wyrzutnię i został złapany przez ramiona wieży Mechazilla. Statek wodował na Oceanie Indyjskim. #SpaceX #Starship',
    post_fb_insta:
      '🚀 Historyczny dzień dla SpaceX!\n\nStarship odbył 9. lot testowy. Booster Super Heavy wrócił do Teksasu i został złapany przez wieżę startową, a statek kontrolowanie wodował na Oceanie Indyjskim.\n\nŹródło: Spidersweb\n\n#SpaceX #Starship',
    source: 'Spidersweb',
  },
  eventA: {
    title: 'Apple sets iPhone 18 event for September 9',
    post_x:
      "📱 It's official: Apple will unveil the iPhone 18 lineup at its 'Glowtime' event on September 9. Expect a new Pro Max and the first foldable iPhone. #Apple #iPhone18",
    post_fb_insta:
      '📱 Mark your calendars!\n\nApple has confirmed its fall event for September 9 at Apple Park. The company is expected to introduce the iPhone 18, iPhone 18 Pro and possibly its first foldable iPhone.\n\nSource: The Verge\n\n#Apple #iPhone #tech',
    source: 'The Verge',
  },
  eventB: {
    title: 'iPhone 18 launch date confirmed: September 9',
    post_x:
      'Apple just sent out invites 📨 The iPhone 18 event happens September 9 at Apple Park — a foldable iPhone could finally debut. #iPhone18',
    post_fb_insta:
      '📨 Invitations are out!\n\nApple will hold its iPhone 18 launch event on September 9 at Apple Park in Cupertino. Rumors point to a foldable model joining the Pro lineup.\n\nSource: 9to5Mac\n\n#Apple #iPhone18',
    source: '9to5Mac',
  },
  earnings: {
    title: 'Apple reports record iPhone revenue in Q4',
    post_x:
      '💰 Apple posts record Q4: iPhone revenue hit $52.3B, up 9% year over year. Services also reached an all-time high. #Apple #earnings',
    post_fb_insta:
      "💰 Apple's iPhone keeps printing money\n\nApple reported fourth-quarter revenue of $102 billion, with iPhone sales up 9% to $52.3 billion. Tim Cook credited strong demand for the iPhone 17 Pro.\n\nSource: CNBC\n\n#Apple #iPhone #stocks",
    source: 'CNBC',
  },
};

test('słowa: bez polskich znaków, rdzeń odmiany, adres bez parametrów kampanii', () => {
  assert.equal(fold('Łódź, żółć'), 'Lodz, zolc');
  for (const [a, b] of [
    ['starshipa', 'starship'],
    ['muska', 'musk'],
    ['prezydentem', 'prezydenta'],
    ['rakiety', 'rakieta'],
    ['launches', 'launched'],
  ])
    assert.equal(stem(a), stem(b), `${a} = ${b}`);
  assert.equal(normalizeUrl('https://www.Example.com/news/a/?utm_source=x&id=2#top'), 'example.com/news/a?id=2');
  assert.equal(normalizeUrl('http://example.com/news/a?fbclid=1'), 'example.com/news/a');
  assert.equal(normalizeUrl('nie adres'), '');
  // słowa pospolite, linki i pojedyncze cyfry nie są słowami kluczowymi, liczby tak
  const f = fingerprint({ title: 'Co nowego? Sprawdź https://example.com/x – 9 rzeczy i 125 000 USD' });
  assert.deepEqual([...f.keys()].filter((k) => !k.includes(' ')).sort(), ['125', 'rzecz', 'usd']);
});

// podobieństwo dwóch postów na tle pozostałych (IDF jak w pamięci bota)
function score(a, b, others = Object.values(POSTS)) {
  const fp = (p) => fingerprint({ title: p.title, texts: [p.post_x, p.post_fb_insta] });
  const docs = others.map(fp);
  const df = new Map();
  for (const d of docs) for (const t of d.keys()) df.set(t, (df.get(t) || 0) + 1);
  const idf = (t) => Math.log((docs.length + 1) / ((df.get(t) || 0) + 1)) + 1;
  return compare(fp(a), fp(b), idf).score;
}

test('ta sama historia z innego źródła jest podobna (średnia czułość), inna historia z tego samego tematu – nie', () => {
  for (const [a, b] of [
    ['delayA', 'delayB'],
    ['eventA', 'eventB'],
  ]) {
    assert.ok(score(POSTS[a], POSTS[b]) >= THRESHOLDS.medium, `${a} ~ ${b}: ${score(POSTS[a], POSTS[b])}`);
  }
  for (const [a, b] of [
    ['delayA', 'launch'],
    ['eventA', 'earnings'],
  ]) {
    assert.ok(score(POSTS[a], POSTS[b]) < THRESHOLDS.high, `${a} ≁ ${b}: ${score(POSTS[a], POSTS[b])}`);
  }
});

// --- pamięć postów bota --------------------------------------------------------------------------------------------
const DAY = 86400 * 1000;
const NOW = Date.parse('2026-11-08T12:00:00Z');

function setup({ bot: botChanges = {}, bots } = {}) {
  const dataDir = tmpDir();
  const filesDir = tmpDir();
  const bot = { id: 'b1', name: 'Kosmos', topic: 'kosmos', brandName: 'Kosmos', mode: 'news', ...botChanges };
  const store = { bots: bots || [bot], bot: (id) => (bots || [bot]).find((b) => b.id === id) || null, state: {} };
  const drafts = new Drafts(filesDir, store);
  const similar = new Similar(store, { dataDir, drafts });
  // draft na dysku jak z n8n: ID z datą, teksty, status i wyniki publikacji
  const write = (id, post, extra = {}) => {
    const d = {
      draftId: id,
      botId: bot.id,
      createdAt: extra.createdAt || id.replace(/^d(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})-.*$/, '$1-$2-$3T$4:$5:00.000Z'),
      status: 'published',
      news: { title: post.title, url: post.url || `https://example.com/${id}`, source: post.source },
      post_x: post.post_x,
      post_fb_insta: post.post_fb_insta,
      results: { x: { ok: true, url: `https://x.com/i/status/${id.slice(-4)}` } },
      ...extra,
    };
    fs.writeFileSync(path.join(filesDir, `${id}.json`), JSON.stringify(d));
    return d;
  };
  const candidate = (post, extra = {}) => ({
    title: post.title,
    url: `https://news.example/${Math.random()}`,
    source: post.source,
    post_x: post.post_x,
    post_fb_insta: post.post_fb_insta,
    ...extra,
  });
  return { dataDir, filesDir, bot, store, drafts, similar, write, candidate };
}

test('pamięć z draftów na dysku: podobny opublikowany post z linkiem, odrzucone i stare drafty się nie liczą', () => {
  const t = setup();
  t.write('d20261107-1000-aaaa', POSTS.delayA);
  t.write('d20261106-1000-bbbb', POSTS.launch);
  t.write('d20261105-1000-cccc', POSTS.eventA, { status: 'draft' });
  t.write('d20250101-1000-dddd', POSTS.delayB); // starszy niż 90 dni – poza pamięcią
  t.write('d20261104-1000-eeee', POSTS.delayB, { botId: 'inny' }); // inny bot

  const r = t.similar.check(t.bot, t.candidate(POSTS.delayB), NOW);
  assert.equal(r.enabled, true);
  assert.equal(r.days, 60);
  assert.equal(r.matches.length, 1, JSON.stringify(r.matches));
  const [m] = r.matches;
  assert.equal(m.id, 'd20261107-1000-aaaa');
  assert.equal(m.status, 'published');
  assert.equal(m.link, 'https://x.com/i/status/aaaa');
  assert.equal(m.title, POSTS.delayA.title);
  assert.equal(m.same, 'text');
  assert.ok(m.score >= THRESHOLDS.medium && m.score < 1, String(m.score));
  // pamięć zapisana w data/panel/similar/<bot>.json – bez starego draftu i bez draftu innego bota
  const saved = JSON.parse(fs.readFileSync(path.join(t.dataDir, 'similar', 'b1.json'), 'utf8'));
  assert.deepEqual(
    saved.posts.map((p) => p.id),
    ['d20261105-1000-cccc', 'd20261106-1000-bbbb', 'd20261107-1000-aaaa'],
  );
  assert.equal(t.similar.count('b1'), 3);

  // draft czekający na akceptację też się liczy (ta sama historia w dwóch draftach przed ✅)
  const ev = t.similar.check(t.bot, t.candidate(POSTS.eventB), NOW);
  assert.deepEqual(
    ev.matches.map((x) => [x.id, x.status, x.link]),
    [['d20261105-1000-cccc', 'draft', 'https://x.com/i/status/cccc']],
  );
  // … ale nie po tygodniu bez decyzji, a odrzucony – wcale
  assert.deepEqual(t.similar.check(t.bot, t.candidate(POSTS.eventB), NOW + 7 * DAY).matches, []);
  t.similar.rejected('b1', 'd20261105-1000-cccc');
  assert.deepEqual(t.similar.check(t.bot, t.candidate(POSTS.eventB), NOW).matches, []);
});

test('ten sam link do artykułu = powtórka zawsze; wyłączone sprawdzanie i okno dni', () => {
  const t = setup();
  t.write('d20261020-1000-aaaa', { ...POSTS.earnings, url: 'https://blog.example/wpis/?utm_source=rss' });
  const same = t.similar.check(t.bot, t.candidate(POSTS.delayA, { url: 'http://www.blog.example/wpis' }), NOW);
  assert.deepEqual(
    same.matches.map((m) => [m.id, m.same, m.score]),
    [['d20261020-1000-aaaa', 'link', 1]],
  );
  t.bot.similar = { enabled: true, days: 30, sensitivity: 'medium' };
  assert.equal(t.similar.check(t.bot, t.candidate(POSTS.earnings), NOW).matches.length, 1, 'post sprzed 19 dni – w oknie 30 dni');
  assert.equal(t.similar.check(t.bot, t.candidate(POSTS.earnings), NOW + 12 * DAY).matches.length, 0, 'sprzed 31 dni – poza oknem');
  t.bot.similar = { enabled: false, days: 60, sensitivity: 'medium' };
  assert.deepEqual(t.similar.check(t.bot, t.candidate(POSTS.earnings), NOW), { enabled: false, matches: [] });
});

test('czułość: niska pomija podobne, wysoka łapie więcej; słowa z tematu bota nie robią podobieństwa', () => {
  const t = setup();
  t.write('d20261107-1000-aaaa', POSTS.delayA);
  const best = (sensitivity) => {
    t.bot.similar = { enabled: true, days: 60, sensitivity };
    return t.similar.check(t.bot, t.candidate(POSTS.delayB), NOW).matches.length;
  };
  assert.equal(best('medium'), 1);
  assert.equal(best('high'), 1);
  assert.equal(best('low'), 0, 'ta sama historia innymi słowami – za mało jak na „tylko bardzo podobne”');
  // prawie ten sam tekst (np. artykuł strony opublikowany drugi raz) – także przy niskiej czułości
  const again = t.candidate({ ...POSTS.delayA, post_x: `${POSTS.delayA.post_x} 🔥` });
  assert.equal(t.similar.check(t.bot, again, NOW).matches.length, 1);

  // dwa krótkie posty, wspólne tylko słowa z tematu i nazwy bota
  const u = setup({ bot: { topic: 'SpaceX i Starship', brandName: 'Starship Polska' } });
  u.write('d20261107-1000-aaaa', {
    title: 'Starship: nowy film SpaceX',
    post_x: 'Starship w nowym filmie SpaceX #Starship',
    source: 'YouTube',
  });
  const other = u.candidate({ title: 'SpaceX: Starship w hangarze', post_x: 'Starship SpaceX zimuje w hangarze #Starship', source: 'X' });
  assert.deepEqual(u.similar.check(u.bot, other, NOW).matches, []);
});

test('zdarzenia z n8n: nowy draft, publikacja (status i link), nieudana publikacja się nie liczy, usunięcie bota', () => {
  const t = setup();
  // pamięć już istnieje (pusty plik) – nowy draft dopisuje zdarzenie „draft”
  t.similar.check(t.bot, t.candidate(POSTS.eventA), NOW);
  t.write('d20261108-0900-aaaa', POSTS.eventA, { status: 'draft', results: {}, createdAt: new Date(NOW - 3600e3).toISOString() });
  t.similar.addDraft('b1', 'd20261108-0900-aaaa');
  let m = t.similar.check(t.bot, t.candidate(POSTS.eventB), NOW).matches;
  assert.deepEqual(
    m.map((x) => [x.id, x.status, x.link]),
    [['d20261108-0900-aaaa', 'draft', '']],
  );
  t.similar.published('b1', 'd20261108-0900-aaaa', 'failed', { x: { ok: false, error: '403' } });
  assert.deepEqual(t.similar.check(t.bot, t.candidate(POSTS.eventB), NOW).matches, [], 'publikacja nieudana – posta nie ma na profilu');
  t.similar.published('b1', 'd20261108-0900-aaaa', 'partial', {
    x: { ok: false, error: '403' },
    facebook: { ok: true, url: 'https://www.facebook.com/1_2' },
  });
  m = t.similar.check(t.bot, t.candidate(POSTS.eventB), NOW).matches;
  assert.deepEqual(
    m.map((x) => [x.status, x.link]),
    [['partial', 'https://www.facebook.com/1_2']],
  );
  t.similar.rejected('b1', 'd20261108-0900-aaaa');
  assert.equal(
    t.similar.check(t.bot, t.candidate(POSTS.eventB), NOW).matches.length,
    1,
    '🗑 Porzuć po częściowej publikacji – post zostaje',
  );
  // nieznany bot i złe ID – bez błędu
  t.similar.addDraft('inny', 'd20261108-0900-aaaa');
  t.similar.addDraft('b1', '../config');
  t.similar.dropBot('b1');
  assert.equal(fs.existsSync(path.join(t.dataDir, 'similar', 'b1.json')), false);
});

test('ustawienia bota: domyślnie włączone (60 dni, średnia czułość), zły format i złe wartości – bez błędu', () => {
  const { sanitizeBot, defaultBot } = require('../lib/store');
  const base = defaultBot('b1', 'Bot');
  assert.deepEqual(base.similar, { enabled: true, days: 60, sensitivity: 'medium' });
  assert.deepEqual(sanitizeBot({ similar: 'tak' }, base).similar, base.similar);
  assert.deepEqual(sanitizeBot({ similar: { enabled: false, days: '90', sensitivity: 'high' } }, base).similar, {
    enabled: false,
    days: 90,
    sensitivity: 'high',
  });
  assert.deepEqual(sanitizeBot({ similar: { days: 45, sensitivity: 'max' } }, base).similar, base.similar);
});
