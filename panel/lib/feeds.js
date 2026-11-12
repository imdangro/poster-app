'use strict';
// Test kanału RSS/Atom (przycisk „Sprawdź” przy źródle bota): liczba wpisów, pierwsze tytuły, data najnowszego wpisu,
// a dla adresu strony WWW – kanał, który strona wskazuje sama (<link rel="alternate" …>).
const { readLimited } = require('./util');
const { fetchUntrusted } = require('./net');
const { tagsOf, elementsOf, firstElement } = require('./html');
const { tr } = require('./i18n');

// Treść kanału jest cudza (do 10 MB): wpisy, tytuły i daty czytają elementsOf / tagsOf z lib/html.js – w czasie
// liniowym, a teksty do pokazania są najpierw przycinane (bez wyrażeń regularnych na megabajtach treści).
const SNIPPET = 4000;
// początek tekstu do pokazania; przycięty tekst – bez znacznika uciętego w połowie
function snippet(s) {
  const t = String(s);
  return t.length > SNIPPET ? t.slice(0, SNIPPET).replace(/<[^>]*$/, '') : t;
}

// Adres wpisany przez użytkownika (trust) może prowadzić także do sieci lokalnej (RSSHub, blog na NAS-ie);
// przekierowania i kanał wskazany przez stronę na innym hoście – tylko do internetu (fetchUntrusted)
async function testFeed(url, { discover = true, trust = [url] } = {}) {
  let res;
  let text;
  try {
    res = await fetchUntrusted(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Poster panel RSS test)',
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
      timeout: 20000,
      trust,
    });
    const raw = await readLimited(res, 10 * 1024 * 1024);
    if (!raw) return { ok: false, message: tr('Odpowiedź ma ponad 10 MB – to nie wygląda na kanał RSS') };
    text = raw.toString('utf8');
  } catch (e) {
    return {
      ok: false,
      message: tr(
        'Brak połączenia: {0}',
        e.name === 'TimeoutError' ? tr('przekroczono czas (20 s)') : e.cause?.code || e.code || e.message,
      ),
    };
  }
  if (!res.ok)
    return {
      ok: false,
      message: `HTTP ${res.status}: ${snippet(text)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160)}`,
    };
  const items = [...elementsOf(text, ['item', 'entry'])].map((el) => el.outer);
  if (!items.length) {
    // adres strony zamiast kanału: kanał wskazuje <link rel="alternate" type="application/rss+xml" href="…">
    const html = /<html[\s>]|<!doctype html/i.test(text.slice(0, 2000));
    const feed = html && discover ? discoverFeed(text, res.url || url) : null;
    if (feed && feed !== url) {
      const r = await testFeed(feed, { discover: false, trust });
      if (r.ok) return { ...r, discovered: feed, message: tr('Znaleziono kanał RSS strony – {0}', r.message) };
    }
    return {
      ok: false,
      message: html
        ? tr(
            'To strona WWW, a nie kanał RSS, i nie wskazuje swojego kanału – wpisz adres kanału, np. https://twojastrona.pl/feed/ (WordPress)',
          )
        : tr('To nie wygląda na kanał RSS/Atom (brak wpisów)'),
    };
  }
  const titles = items.slice(0, 3).map((it) => decodeTitle(firstElement(it, ['title'])));
  const dates = items
    .map((it) => Date.parse(firstElement(it, ['pubDate', 'updated', 'published', 'dc:date']).slice(0, 100)))
    .filter(Boolean);
  // bez Math.max(...dates): kanał z setkami tysięcy wpisów przepełniłby stos wywołań
  const newest = dates.length ? new Date(dates.reduce((a, b) => Math.max(a, b))).toISOString() : null;
  const n = items.length;
  const few = [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100);
  const message = n === 1 ? tr('OK – {0} wpis', n) : few ? tr('OK – {0} wpisy', n) : tr('OK – {0} wpisów', n);
  return { ok: true, message, count: n, titles, newest };
}

function decodeTitle(s) {
  return snippet(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

// Kanał RSS/Atom wskazany przez stronę WWW (<link rel="alternate" …>); kanały komentarzy pomijamy.
function discoverFeed(html, base) {
  for (const tag of tagsOf(html, 'link')) {
    const attr = (name) => (tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i')) || [])[1] || '';
    if (!/(^|\s)alternate(\s|$)/i.test(attr('rel')) || !/application\/(rss|atom)\+xml/i.test(attr('type'))) continue;
    const href = attr('href').replace(/&amp;/g, '&').trim();
    if (!href || /comments?\/feed|\/comments(\/|$)/i.test(href)) continue;
    try {
      const u = new URL(href, base).toString();
      if (/^https?:\/\//i.test(u)) return u;
    } catch (e) {}
  }
  return null;
}

module.exports = { testFeed };
