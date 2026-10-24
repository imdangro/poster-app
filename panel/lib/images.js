'use strict';
// Grafika do posta: zdjęcie ze źródła (RSS / og:image artykułu / tweet) albo post bez grafiki – według trybu bota.
const crypto = require('crypto');
const { PROJECT_URL, readLimited } = require('./util');
const { sniffImage } = require('./ai');
const { convertWebp } = require('./ffmpeg');
const { tr } = require('./i18n');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // limit X dla zdjęć
const MIN_WIDTH = 600;
const MIN_HEIGHT = 300;
const UA = `Mozilla/5.0 (compatible; PosterBot/1.0; +${PROJECT_URL})`;
const SKIP_URL = /(logo|favicon|placeholder|default[-_]?(image|og|share)|avatar|sprite|blank|spacer|pixel|1x1)/i;

class Images {
  constructor(store) {
    this.store = store;
  }

  // news: { url, title, images: [...] }; bez zdjęcia X i Facebook dostają post z linkiem do artykułu
  async resolve(bot, { news = {} }) {
    const warnings = [];
    if (bot.content.imageMode === 'none') return { source: 'none', warnings };
    const found = await this.findSourceImage(bot, news, warnings);
    if (found) return { ...found, warnings };
    warnings.push(tr('brak odpowiedniego zdjęcia w źródle'));
    return { source: 'none', warnings };
  }

  // ------------------------------------------------------------------ zdjęcie ze źródła
  async findSourceImage(bot, news, warnings) {
    const tried = new Set();
    const recent = new Set(((this.store.state.recentImages || {})[bot.id] || []).map(String));
    const attempt = async (list) => {
      for (const url of list) {
        if (tried.size >= 8) return null;
        if (!url || tried.has(url) || SKIP_URL.test(url)) continue;
        tried.add(url);
        const img = await download(url).catch(() => null);
        if (!img) continue;
        const sha = crypto.createHash('sha1').update(img.buffer).digest('hex');
        if (recent.has(sha)) continue; // ten sam obrazek co w poprzednich postach = zwykle logo serwisu
        this.rememberImage(bot.id, sha);
        return { source: 'source', ...img, url, sha };
      }
      return null;
    };
    const fromFeed = await attempt(uniqueUrls(news.images));
    if (fromFeed) return fromFeed;
    const pageUrl = String(news.url || '');
    if (!/^https?:\/\//i.test(pageUrl)) return null;
    if (/^https?:\/\/news\.google\.com\//i.test(pageUrl)) {
      warnings.push(tr('link Google News nie prowadzi wprost do artykułu – dodaj bezpośredni kanał RSS portalu'));
      return null;
    }
    const og = await pageImages(pageUrl).catch(() => []);
    return attempt(og);
  }

  rememberImage(botId, sha) {
    const r = (this.store.state.recentImages = this.store.state.recentImages || {});
    const list = (r[botId] = r[botId] || []);
    list.push(sha);
    if (list.length > 40) list.splice(0, list.length - 40);
    this.store.saveState();
  }
}

// ---------------------------------------------------------------------------------------------- sieć
async function download(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'image/jpeg,image/png;q=0.9,image/*;q=0.5' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  let buffer = await readLimited(res, MAX_IMAGE_BYTES);
  if (!buffer || buffer.length < 2000) return null;
  let mimeType = sniffImage(buffer);
  // X, Facebook i Telegram bezpiecznie przyjmują JPG i PNG: WebP konwertujemy (ffmpeg), GIF pomijamy
  if (mimeType === 'image/webp') {
    const conv = await convertWebp(buffer).catch(() => null);
    if (!conv || conv.buffer.length > MAX_IMAGE_BYTES) return null;
    ({ buffer, mimeType } = conv);
  }
  if (!['image/jpeg', 'image/png'].includes(mimeType)) return null;
  const dims = imageSize(buffer);
  if (!dims.width || dims.width < MIN_WIDTH || dims.height < MIN_HEIGHT) return null;
  return { buffer, mimeType, ...dims };
}

// og:image, twitter:image, link rel=image_src ze strony artykułu
async function pageImages(pageUrl) {
  return (await pageMeta(pageUrl)).images;
}

// Znaczniki strony z <head>: tytuł i opis (og:/twitter:/<title>) oraz adresy zdjęć – np. do karty linku
async function pageMeta(pageUrl) {
  const empty = { title: '', description: '', images: [] };
  const res = await fetch(pageUrl, {
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'accept-language': 'pl,en;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) return empty;
  const reader = res.body.getReader();
  let html = '';
  const decoder = new TextDecoder('utf-8');
  // czytamy tylko początek strony (znaczniki meta są w <head>)
  while (html.length < 600000) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
    if (/<\/head>/i.test(html)) break;
  }
  reader.cancel().catch(() => {});
  const base = res.url || pageUrl;
  const out = [];
  const metaRe = /<meta\b[^>]*>/gi;
  const wanted = ['og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image', 'twitter:image:src'];
  const text = ['og:title', 'twitter:title', 'og:description', 'twitter:description', 'description'];
  const found = {};
  for (const tag of html.match(metaRe) || []) {
    const key = (attr(tag, 'property') || attr(tag, 'name') || '').toLowerCase();
    const content = attr(tag, 'content');
    if ((wanted.includes(key) || text.includes(key)) && content && !found[key]) found[key] = content;
  }
  for (const k of wanted) if (found[k]) out.push(found[k]);
  const link = (html.match(/<link\b[^>]*rel=["']image_src["'][^>]*>/i) || [])[0];
  if (link && attr(link, 'href')) out.push(attr(link, 'href'));
  const title = (html.match(/<title\b[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
  const clean = (s) => decodeEntities(s).replace(/\s+/g, ' ').trim();
  return {
    title: clean(found['og:title'] || found['twitter:title'] || title).slice(0, 300),
    description: clean(found['og:description'] || found['twitter:description'] || found.description || '').slice(0, 1000),
    images: uniqueUrls(out.map((u) => absolute(decodeEntities(u), base))),
  };
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? (m[2] !== undefined ? m[2] : m[3]) : '';
}
const decodeEntities = (s) =>
  String(s)
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/gi, '/')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
function absolute(u, base) {
  try {
    return new URL(u, base).toString();
  } catch (e) {
    return '';
  }
}
function uniqueUrls(list) {
  return [...new Set((Array.isArray(list) ? list : []).map((u) => decodeEntities(u)).filter((u) => /^https?:\/\//i.test(u)))].slice(0, 8);
}

// ---------------------------------------------------------------------------------------------- wymiary obrazu
function imageSize(buf) {
  try {
    if (!buf || buf.length < 24) return {};
    if (buf[0] === 0x89 && buf[1] === 0x50) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = buf[i + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2;
          continue;
        }
        const len = buf.readUInt16BE(i + 2);
        // SOF0–SOF15 z wyjątkiem DHT (C4), JPG (C8) i DAC (CC)
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    }
  } catch (e) {}
  return {};
}

module.exports = { Images, imageSize, pageImages, pageMeta, downloadImage: download };
