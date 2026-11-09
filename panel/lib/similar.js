'use strict';
// Sprawdzanie powtórek: czy nowy draft opisuje tę samą historię co wcześniejszy post bota – bez AI i bez kosztów.
//
// Pamięć: data/panel/similar/<bot>.json – posty bota z ostatnich 90 dni (tytuł, początek tekstów, link do artykułu
// i do posta, status). Draft trafia do niej, gdy powstanie (zdarzenie „draft” z n8n), a status zmienia publikacja
// i odrzucenie. Pierwsze użycie uzupełnia pamięć draftami z dysku (data/files).
// Workflow po napisaniu tekstu przez AI pyta o podobne posty (/internal/bots/<id>/similar) – podobny draft dostaje
// w Telegramie „🔁 Podobny do posta z …”, a w trybie automatycznym (PRO) czeka na ✅.
//
// Porównanie: rdzenie słów („Starshipa” = „Starship”) i pary sąsiednich słów, bez słów pospolitych PL/EN, linków,
// nazwy źródła i słów z tematu i nazwy bota; tytuł waży 2×, liczby (daty, kwoty) 1,3×. Słowa częste w postach bota
// ważą mniej (IDF), więc dwa różne newsy o bitcoinie w bocie o kryptowalutach nie są „podobne”. Wynik to podobieństwo
// cosinusowe 0–1 porównane z progiem czułości bota; ten sam link do artykułu = powtórka zawsze.
// Porównujemy słowa, nie znaczenie: ta sama historia w innym języku przejdzie, a stały temat (np. comiesięczna decyzja
// o stopach procentowych) bywa fałszywym alarmem – dlatego to ostrzeżenie, a próg ustawia się w bocie.
const fs = require('fs');
const path = require('path');
const { readJsonSafe, writeJsonAtomic } = require('./util');
const { STOP, SUFFIXES } = require('./similar-words');

// czułość → próg podobieństwa (dobrany na parach postów PL/EN: ta sama historia z różnych źródeł ok. 0,21–0,35,
// różne historie z tego samego tematu do ok. 0,13, a ten sam artykuł drugi raz ok. 0,9)
const THRESHOLDS = { low: 0.3, medium: 0.2, high: 0.15 };
const WINDOWS = [30, 60, 90]; // dni wstecz do porównania (ustawienie bota)
const KEEP_DAYS = 90; // tyle pamiętamy posty
const PENDING_DAYS = 7; // draft bez decyzji liczy się tyle dni (potem to raczej porzucony draft)
const MAX_POSTS = 3000; // na bota (najnowsze)
const MAX_MATCHES = 3;
const MIN_SHARED = 3; // tyle wspólnych słów kluczowych, żeby uznać posty za podobne (krótkie posty)
const TEXT_MAX = 700; // znaków z każdego tekstu posta
const DAY = 86400 * 1000;
// statusy postów, z którymi porównujemy: opublikowane (także częściowo albo bez pewności), zatwierdzone (X ręcznie)
// i czekające na decyzję; odrzucone i nieudane – nie
const COUNTED = new Set(['published', 'partial', 'unknown', 'approved', 'draft']);

const STEM_MAX = 8;
const WORD = /\p{N}+(?:[.,]\p{N}+)*|[\p{L}\p{N}]+/gu;
// granice zdań i części tytułu („Lot opóźniony – nowa data…”): pary słów nie przechodzą przez nie
const BREAK = /[.!?…:;]+(?=\s|$)|\n+|\s[–—-]\s/u;

// bez polskich (i innych) znaków diakrytycznych: „Łódź” = „Lodz”
const fold = (s) =>
  String(s)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L');

function stem(w) {
  for (const s of SUFFIXES) {
    if (w.length - s.length >= 4 && w.endsWith(s)) {
      w = w.slice(0, -s.length);
      break;
    }
  }
  return w.slice(0, STEM_MAX);
}

// Słowa tekstu jako lista zdań: [[{ t: rdzeń albo liczba, num }, …], …]
function sentences(text, skip = new Set()) {
  const clean = String(text || '')
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/[@#]([\p{L}\p{N}_]+)/gu, ' $1 ')
    .replace(/_/g, ' ');
  const out = [];
  for (const part of clean.split(BREAK)) {
    const list = [];
    for (const m of part.matchAll(WORD)) {
      const raw = m[0];
      if (/^\p{N}/u.test(raw)) {
        // liczby: kwoty, daty, wyniki – bez pojedynczych cyfr i samych zer („125 000” → 125)
        const n = raw.replace(/,/g, '.');
        if (n.replace(/\D/g, '').length >= 2 && !/^[0.]+$/.test(n)) list.push({ t: n, num: true });
        continue;
      }
      const f = fold(raw);
      const w = f.toLowerCase();
      // krótkie słowa tylko jako skróty pisane wielkimi literami (UE, AI)
      if (STOP.has(w) || (w.length < 3 && !/^\p{Lu}{2}$/u.test(f))) continue;
      const t = w.length < 3 ? w : stem(w);
      if (!skip.has(t)) list.push({ t, num: false });
    }
    if (list.length) out.push(list);
  }
  return out;
}

// Rdzenie słów z tekstu – nazwa źródła, temat i nazwa bota (pomijane przy porównaniu)
function stems(text) {
  const out = new Set();
  for (const list of sentences(text)) for (const x of list) if (!x.num) out.add(x.t);
  return out;
}

// Odcisk posta: Map(termin → waga) – rdzenie słów i pary sąsiednich słów (bez względu na kolejność:
// „start Starshipa” = „Starship startuje”), tytuł 2×, liczby 1,3×
function fingerprint({ title = '', texts = [] } = {}, skip = new Set()) {
  const terms = new Map();
  const put = (k, w) => terms.set(k, Math.max(terms.get(k) || 0, w));
  for (const [text, fw] of [[title, 2], ...texts.map((t) => [t, 1])]) {
    for (const list of sentences(text, skip)) {
      list.forEach((x, i) => {
        put(x.t, fw * (x.num ? 1.3 : 1));
        const y = list[i + 1];
        if (y && y.t !== x.t) put(x.t < y.t ? `${x.t} ${y.t}` : `${y.t} ${x.t}`, fw);
      });
    }
  }
  return terms;
}

// Podobieństwo cosinusowe odcisków z wagami IDF; shared – ile wspólnych słów (bez par)
function compare(a, b, idf) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  let shared = 0;
  for (const [t, w] of a) {
    const x = w * idf(t);
    na += x * x;
    const v = b.get(t);
    if (!v) continue;
    dot += x * v * idf(t);
    if (!t.includes(' ')) shared++;
  }
  for (const [t, w] of b) nb += (w * idf(t)) ** 2;
  return { score: na && nb ? dot / Math.sqrt(na * nb) : 0, shared };
}

// Adres artykułu do porównania: bez http(s), www, parametrów kampanii, kotwicy i końcowego ukośnika
function normalizeUrl(u) {
  const m = String(u || '')
    .trim()
    .match(/^https?:\/\/(?:www\.)?([^/?#\s]+)([^?#\s]*)(\?[^#\s]*)?/i);
  if (!m) return '';
  const query = (m[3] || '')
    .slice(1)
    .split('&')
    .filter((p) => p && !/^(utm_[a-z_]+|fbclid|gclid|mc_[a-z]+|ref|source)(=|$)/i.test(p))
    .sort()
    .join('&');
  return `${m[1].toLowerCase()}${m[2].replace(/\/+$/, '')}${query ? `?${query}` : ''}`;
}

// Teksty draftu do porównania: X, Facebook/Instagram i tekst autora (własny post); bez nich – pozostałe teksty
function draftTexts(d) {
  const cut = (s) => (typeof s === 'string' ? s.slice(0, TEXT_MAX) : '');
  const main = [d.post_x, d.post_fb_insta, d.composeText].filter(Boolean);
  // draft bez tekstu X i Facebooka – np. tylko Instagram, Threads albo TikTok
  const rest = [];
  return [...new Set((main.length ? main : rest).map(cut))];
}
// link do posta: pierwsza platforma z adresem
const PLATFORM_ORDER = ['x', 'facebook', 'instagram', 'threads', 'bluesky', 'telegram'];
function postLink(results) {
  for (const k of PLATFORM_ORDER) {
    const r = results && results[k];
    if (r && r.ok && /^https:\/\/\S+$/.test(String(r.url || ''))) return r.url;
  }
  return '';
}
// nazwa pliku draftu zawiera datę: dRRRRMMDD-GGMM-…
function draftDate(name) {
  const m = /^d(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})-/.exec(name);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : 0;
}

class Similar {
  constructor(store, { dataDir, drafts }) {
    this.store = store;
    this.drafts = drafts;
    this.dir = path.join(dataDir, 'similar');
    this.mem = new Map(); // bot → { posts: [...] }
    this.prints = new Map(); // bot → { sig, map: id → odcisk }
  }

  file(botId) {
    return path.join(this.dir, `${String(botId).replace(/[^a-z0-9]/gi, '')}.json`);
  }

  // Pamięć bota; pierwszy raz (brak pliku) – z draftów zapisanych na dysku
  load(botId) {
    let m = this.mem.get(botId);
    if (m) return m;
    let data = null;
    try {
      data = readJsonSafe(this.file(botId), null);
    } catch (e) {
      console.error('similar:', e.message); // np. brak uprawnień do pliku – bez pamięci zamiast błędu
      data = { posts: [] };
    }
    const fresh = !(data && Array.isArray(data.posts));
    m = { posts: fresh ? this.fromDisk(botId) : data.posts.filter((p) => p && p.id) };
    this.mem.set(botId, m);
    if (fresh) this.save(botId); // pierwsze użycie: pamięć z draftów na dysku
    return m;
  }

  fromDisk(botId, now = Date.now()) {
    if (!this.drafts) return [];
    const first = this.store.bots[0];
    const posts = [];
    for (const name of this.drafts.draftNames()) {
      if (draftDate(name) < now - KEEP_DAYS * DAY) break; // nazwy od najnowszej
      const d = this.drafts.summary(name);
      // drafty sprzed panelu nie mają botId – należą do pierwszego bota
      if (!d || (d.botId || (first && first.id)) !== botId) continue;
      posts.push(this.entry(d));
      if (posts.length >= MAX_POSTS) break;
    }
    return posts.reverse();
  }

  // wpis pamięci z podsumowania draftu (lib/drafts.js)
  entry(d) {
    return {
      id: d.draftId,
      at: d.createdAt || new Date().toISOString(),
      status: d.status || 'draft',
      mode: d.mode || 'news',
      title: String(d.title || '').slice(0, 300),
      text: draftTexts(d).join('\n\n'),
      url: d.url || '',
      source: String(d.source || '').slice(0, 100),
      link: postLink(d.results),
    };
  }

  save(botId, now = Date.now()) {
    const m = this.mem.get(botId);
    if (!m) return;
    const cutoff = now - KEEP_DAYS * DAY;
    m.posts = m.posts.filter((p) => Date.parse(p.at) >= cutoff).slice(-MAX_POSTS);
    try {
      fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      writeJsonAtomic(this.file(botId), { version: 1, posts: m.posts }, 0o600);
    } catch (e) {
      console.error('similar:', e.message);
    }
  }

  // Nowy draft (zdarzenie „draft” z n8n) – plik draftu jest już na dysku
  addDraft(botId, draftId) {
    if (!this.store.bot(botId) || !/^[A-Za-z0-9_-]{1,40}$/.test(String(draftId || ''))) return;
    const d = this.drafts && this.drafts.summary(`${draftId}.json`);
    if (!d) return;
    const m = this.load(botId);
    const e = this.entry(d);
    const i = m.posts.findIndex((p) => p.id === e.id);
    if (i >= 0) m.posts[i] = { ...e, status: m.posts[i].status === 'draft' ? e.status : m.posts[i].status };
    else m.posts.push(e);
    this.save(botId);
  }

  // Publikacja (zdarzenie „publish”): status i link do posta
  published(botId, draftId, status, results) {
    if (!this.store.bot(botId) || !draftId) return;
    const m = this.load(botId);
    let p = m.posts.find((x) => x.id === draftId);
    if (!p) {
      this.addDraft(botId, draftId);
      p = m.posts.find((x) => x.id === draftId);
      if (!p) return;
    }
    p.status = String(status || p.status);
    p.link = postLink(results) || p.link || '';
    this.save(botId);
  }

  // ❌ w Telegramie: draft bez publikacji nie jest już powtórką (częściowo opublikowany – zostaje)
  rejected(botId, draftId) {
    if (!this.store.bot(botId)) return;
    const p = this.load(botId).posts.find((x) => x.id === draftId);
    if (p && ['draft', 'failed'].includes(p.status)) {
      p.status = 'rejected';
      this.save(botId);
    }
  }

  // ile postów bota pamięta panel (karta w ustawieniach bota)
  count(botId) {
    return this.store.bot(botId) ? this.load(botId).posts.length : 0;
  }

  dropBot(botId) {
    this.mem.delete(botId);
    this.prints.delete(botId);
    fs.rmSync(this.file(botId), { force: true });
  }

  // Słowa pomijane w porównaniu: temat, nazwa marki i bota, stałe hashtagi (te są w każdym poście)
  botWords(bot) {
    const own = bot.mode === 'youtube' ? bot.youtube : bot.mode === 'site' ? bot.site : null;
    return [bot.topic, bot.brandName, bot.name, own && own.hashtags].filter(Boolean).join(' ');
  }

  // Posty bota podobne do nowego draftu: { enabled, days, matches: [{ id, at, status, title, link, url, score, same }] }
  check(bot, cand = {}, now = Date.now()) {
    const cfg = bot.similar || {};
    if (cfg.enabled === false) return { enabled: false, matches: [] };
    const days = WINDOWS.includes(cfg.days) ? cfg.days : 60;
    const threshold = THRESHOLDS[cfg.sensitivity] || THRESHOLDS.medium;
    const since = now - days * DAY;
    const posts = this.load(bot.id).posts.filter((p) => {
      const at = Date.parse(p.at);
      if (!(at >= since) || !COUNTED.has(p.status) || p.id === cand.draftId) return false;
      return p.status !== 'draft' || at >= now - PENDING_DAYS * DAY;
    });
    if (!posts.length) return { enabled: true, days, matches: [] };

    const words = this.botWords(bot);
    const base = stems(words);
    const skipFor = (source) => (source ? new Set([...base, ...stems(source)]) : base);
    // odciski postów z pamięci (zapamiętane do zmiany tematu bota)
    let pc = this.prints.get(bot.id);
    if (!pc || pc.sig !== words) this.prints.set(bot.id, (pc = { sig: words, map: new Map() }));
    const printOf = (p) => {
      let f = pc.map.get(p.id);
      if (!f) pc.map.set(p.id, (f = fingerprint({ title: p.title, texts: [p.text] }, skipFor(p.source))));
      return f;
    };
    // nowy draft: te same pola co draft na dysku (post_x, post_fb_insta…) – teksty wybiera draftTexts jak dla pamięci
    const texts = draftTexts(cand).join('\n\n');
    const mine = fingerprint({ title: String(cand.title || '').slice(0, 300), texts: [texts] }, skipFor(String(cand.source || '')));
    const prints = posts.map(printOf);
    // IDF: w ilu postach (z nowym draftem) jest termin
    const df = new Map();
    for (const f of [mine, ...prints]) for (const t of f.keys()) df.set(t, (df.get(t) || 0) + 1);
    const n = prints.length + 1;
    const idf = (t) => Math.log((n + 1) / ((df.get(t) || 0) + 1)) + 1;

    const url = normalizeUrl(cand.url);
    const matches = [];
    posts.forEach((p, i) => {
      const sameUrl = !!url && normalizeUrl(p.url) === url;
      const r = compare(mine, prints[i], idf);
      if (!sameUrl && !(r.score >= threshold && r.shared >= MIN_SHARED)) return;
      matches.push({
        id: p.id,
        at: p.at,
        status: p.status,
        title: p.title,
        link: p.link || '',
        url: p.url || '',
        score: sameUrl ? 1 : Math.round(r.score * 100) / 100,
        same: sameUrl ? 'link' : 'text',
      });
    });
    matches.sort((a, b) => b.score - a.score || Date.parse(b.at) - Date.parse(a.at));
    if (pc.map.size > posts.length + 500) pc.map.clear(); // stare odciski (posty spoza okna)
    return { enabled: true, days, matches: matches.slice(0, MAX_MATCHES) };
  }
}

module.exports = {
  Similar,
  THRESHOLDS,
  WINDOWS,
  fold,
  stem,
  stems,
  sentences,
  fingerprint,
  compare,
  normalizeUrl,
  draftTexts,
};
