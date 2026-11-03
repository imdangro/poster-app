'use strict';
// Test kanału RSS/Atom (przycisk „Sprawdź” przy źródle bota): liczba wpisów, pierwsze tytuły, data najnowszego wpisu,
// a dla adresu strony WWW – kanał, który strona wskazuje sama (<link rel="alternate" …>).
const { readLimited } = require('./util');
const { fetchUntrusted } = require('./net');
const { tr } = require('./i18n');

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
      message: `HTTP ${res.status}: ${text
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160)}`,
    };
  const items = text.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
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
  const titles = items.slice(0, 3).map((it) => decodeTitle((it.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ''));
  const dates = items
    .map((it) => Date.parse((it.match(/<(pubDate|updated|published|dc:date)[^>]*>([\s\S]*?)<\/\1>/i) || [])[2] || ''))
    .filter(Boolean);
  const newest = dates.length ? new Date(Math.max(...dates)).toISOString() : null;
  const n = items.length;
  const few = [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100);
  const message = n === 1 ? tr('OK – {0} wpis', n) : few ? tr('OK – {0} wpisy', n) : tr('OK – {0} wpisów', n);
  return { ok: true, message, count: n, titles, newest };
}

function decodeTitle(s) {
  return s
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
  for (const tag of String(html).match(/<link\b[^>]*>/gi) || []) {
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
