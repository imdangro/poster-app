// Ujednolica wpisy z RSS/RSSHub do wspólnego formatu + wylicza stabilny klucz deduplikacji (id).
const feedItems = $('Lista źródeł').all();
// tryb „własna strona”: AI dostaje dłuższy fragment treści artykułu (pole body)
const site = !!$('Config').first().json.site;
const articles = [];
const feedErrors = [];

// Encje HTML w jednym przejściu (bez podwójnego dekodowania), w tym liczbowe z WordPressa (&#8217; → ’)
const ENTITIES = {
  nbsp: ' ',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  amp: '&',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
};
const entity = (m, e) => {
  if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
  const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
};
// Znaczniki usuwamy w jednym przejściu po tekście. Wyrażenia w rodzaju /<[^>]*>/g albo /<script[\s\S]*?<\/script>/g
// na treści z tysiącami niezamkniętych „<” liczą się kwadratowo – wpis z cudzego kanału zatrzymywałby przebieg bota.
// Wynik jak dotąd: bloki <script>…</script> i <style>…</style> oraz każdy znacznik „<…>” zamienione na spację.
function stripTags(s) {
  const parts = [];
  const open = /<(script|style)\b/gi;
  const close = { script: /<\/script>/gi, style: /<\/style>/gi };
  let pos = 0;
  let m;
  while ((close.script || close.style) && (m = open.exec(s))) {
    const end = close[m[1].toLowerCase()];
    if (!end) continue; // dalej nie ma już znacznika zamykającego – nie szukamy go ponownie
    end.lastIndex = open.lastIndex;
    if (!end.exec(s)) {
      close[m[1].toLowerCase()] = null;
      continue;
    }
    parts.push(s.slice(pos, m.index), ' ');
    pos = open.lastIndex = end.lastIndex;
  }
  const text = parts.join('') + s.slice(pos);
  const out = [];
  let i = 0;
  for (;;) {
    const lt = text.indexOf('<', i);
    const gt = lt < 0 ? -1 : text.indexOf('>', lt + 1);
    if (gt < 0) break; // bez „>” nie ma już znaczników
    out.push(text.slice(i, lt), ' ');
    i = gt + 1;
  }
  return out.join('') + text.slice(i);
}
const decode = (s) =>
  stripTags(String(s || ''))
    .replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi, entity)
    .replace(/\s+/g, ' ')
    .trim();

// Kanoniczny klucz: tweety → "x:<status_id>" (niezależnie od domeny x.com/twitter.com/nitter),
// artykuły → host + ścieżka bez parametrów śledzących (utm_*, fbclid...), bez "www." i końcowego "/".
// Uwaga: w sandboksie Code node nie ma klas URL/URLSearchParams – parsujemy wyrażeniami regularnymi.
const TRACKING = /^(utm_\w*|fbclid|gclid|mc_\w*|ref|ref_src|oc|cmpid|ncid|guccounter)(=|$)/i;
function parseUrl(link) {
  const m = String(link).match(/^https?:\/\/([^/?#:]+)(?::\d+)?([^?#]*)(?:\?([^#]*))?/i);
  return m ? { host: m[1].toLowerCase().replace(/^www\./, ''), path: m[2] || '', query: m[3] || '' } : null;
}
function canonical(link) {
  const tw = String(link).match(/^https?:\/\/(?:www\.|mobile\.)?(?:twitter\.com|x\.com|[^/]*nitter[^/]*)\/([^/]+)\/status(?:es)?\/(\d+)/i);
  if (tw) return { id: `x:${tw[2]}`, url: `https://x.com/${tw[1]}/status/${tw[2]}` };
  const u = parseUrl(link);
  if (!u) return null;
  const query = u.query.split('&').filter((kv) => kv && !TRACKING.test(kv));
  const q = query.length ? '?' + query.join('&') : '';
  // w postach link bez parametrów śledzących (np. utm_source=rss z kanału) – ruch z sociali nie udaje RSS-a
  return { id: `${u.host}${u.path.replace(/\/+$/, '')}${q}`, url: String(link).replace(/[?#].*$/, '') + q };
}

// Obrazki z wpisu: <enclosure>, media:content / media:thumbnail / media:group, pierwsze <img> w treści
// (RSSHub wstawia zdjęcia tweetów jako <img>). Panel wybierze z nich pierwsze pasujące.
function imagesOf(j) {
  const out = [];
  const push = (u) => {
    const url = String(u || '')
      .replace(/&amp;/g, '&')
      .trim();
    if (/^https?:\/\//i.test(url) && !out.includes(url)) out.push(url);
  };
  const enc = j.enclosure;
  if (enc && enc.url && (!enc.type || /^image\//i.test(enc.type))) push(enc.url);
  const media = (v, depth = 0) => {
    if (!v || depth > 4) return;
    if (Array.isArray(v)) return v.forEach((x) => media(x, depth + 1));
    if (typeof v !== 'object') return;
    const a = v.$ || {};
    if (a.url && (!a.medium || a.medium === 'image') && (!a.type || /^image\//i.test(a.type))) push(a.url);
    for (const k of Object.keys(v)) if (k.startsWith('media:')) media(v[k], depth + 1);
  };
  media(j['media:content']);
  media(j['media:group']);
  media(j['media:thumbnail']);
  for (const src of imgSources(String(j['content:encoded'] || j.content || ''))) push(src);
  return out.slice(0, 5);
}
// Adresy z <img … src="…"> – ostatnie src w znaczniku, dokładnie jak dawne /<img\b[^>]*\bsrc=["']([^"']+)["']/gi, ale
// w czasie liniowym: znacznik (do najbliższego „>”) czytamy najwyżej dwa razy, a po znaczniku bez src idziemy za
// jego „>” (w treści bez żadnego „>” – kończymy), zamiast próbować od każdego kolejnego <img.
function imgSources(html) {
  const found = [];
  const img = /<img\b/gi;
  const value = /([^"']+)["']/y;
  while (img.exec(html)) {
    const from = img.lastIndex;
    const gt = html.indexOf('>', from);
    const tag = html.slice(from, gt < 0 ? html.length : gt);
    const starts = [];
    for (const a of tag.matchAll(/\bsrc=["']/gi)) starts.push(from + a.index + a[0].length);
    let hit = null;
    for (let k = starts.length - 1; k >= 0 && !hit; k--) {
      value.lastIndex = starts[k];
      hit = value.exec(html);
    }
    if (hit) {
      found.push(hit[1]);
      img.lastIndex = value.lastIndex;
    } else if (gt < 0) {
      break;
    } else {
      img.lastIndex = gt + 1;
    }
  }
  return found;
}

// Błąd węzła RSS bywa obiektem ({ message, description }) – do raportu wystarczy krótki tekst.
const errText = (e) =>
  String((e && typeof e === 'object' ? [e.message, e.description].filter(Boolean).join(' – ') || JSON.stringify(e) : e) || tr('błąd'))
    .replace(/\s+/g, ' ')
    .slice(0, 300);

// Kanał, z którego pochodzi wpis (lub błąd). W węźle Code `item.pairedItem` to tylko numer pozycji na
// wejściu, więc źródło ustalamy przez itemMatching (śledzi pochodzenie elementu przez węzeł RSS).
const feedOf = (i) => {
  try {
    return $('Lista źródeł').itemMatching(i).json || {};
  } catch (e) {
    return feedItems.length === 1 ? feedItems[0].json || {} : {};
  }
};

const input = $input.all();
for (let i = 0; i < input.length; i++) {
  const item = input[i];
  const feed = feedOf(i);
  const j = item.json || {};

  if (j.error) {
    if (feed.kind !== 'none') feedErrors.push({ feed: feed.label || feed.url, kind: feed.kind, error: errText(j.error) });
    continue;
  }
  const link = j.link || (typeof j.guid === 'string' ? j.guid : '');
  if (!link || !/^https?:\/\//i.test(link)) continue;
  const c = canonical(link);
  if (!c) continue;

  const isX = c.id.startsWith('x:') || feed.kind === 'x';
  const summary = decode(j.contentSnippet || j.content || j.summary || j.description).slice(0, 600);
  const title = decode(j.title).slice(0, 300) || summary.slice(0, 160);
  const date = new Date(j.isoDate || j.pubDate || Date.now());
  const source = feed.label || (parseUrl(link) || {}).host || 'RSS';

  articles.push({
    id: c.id,
    url: c.url,
    title,
    summary,
    // pełniejsza treść artykułu (content:encoded) – tylko dla bota „własna strona”
    ...(site ? { body: decode(j['content:encoded'] || j.content || j.summary || j.description).slice(0, 2500) } : {}),
    source,
    sourceType: isX ? 'x' : 'rss',
    author: decode(j.creator || j.author || ''),
    images: imagesOf(j),
    publishedAt: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
  });
}

return [{ json: { articles, feedErrors } }];
