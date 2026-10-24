'use strict';
// Własny post (panel → ✍️ Nowy post): użytkownik pisze tekst, AI dopasowuje go do każdej platformy (albo tekst idzie
// bez AI), a zlecenie „compose” trafia do n8n, który robi z niego draft i publikuje jak każdy inny post – od razu
// („Publikuj teraz”) albo po akceptacji w Telegramie. Tu: prompt dopasowania, limity platform (te same zasady co
// w węźle „Parsuj odpowiedź LLM”), sprawdzenie zlecenia i zdjęcie wgrane w panelu. Katalog draftów jest dla panelu
// tylko do odczytu, więc zdjęcie czeka w data/panel/compose, a n8n odbiera je przez /internal/bots/<id>/image.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { HttpError, randomId } = require('./util');
const { sniffImage } = require('./ai');
const { imageSize } = require('./images');
const { promptFor } = require('./compose-prompt');
const { tr } = require('./i18n');

const PLATFORMS = ['x', 'facebook'];
const NAMES = { x: 'X', facebook: 'Facebook' };
const IMAGE_SOURCES = ['upload', 'none'];
const MAX = { text: 5000, link: 1000, hint: 300, x: 280, facebook: 6000, instagram: 2200, tiktok: 2200, videoTitle: 60 };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // limit X dla zdjęć
const MIN_IMAGE_SIDE = 200;
// Instagram przyjmuje zdjęcia o proporcjach od 4:5 do 1,91:1 (szerokość / wysokość)
const IG_RATIO = [0.8, 1.91];
const UPLOAD_TTL_MS = 48 * 3600 * 1000;
const DUPLICATE_MS = 3 * 60 * 1000;

// ---------------------------------------------------------------------------------------------- limity platform
// Długość wg zasad X: URL = 23 znaki, znaki spoza podstawowych zakresów Unicode (emoji, CJK) = 2.
function xLength(s) {
  let n = 0;
  for (const ch of String(s).replace(/https?:\/\/\S+/g, 'x'.repeat(23))) {
    const cp = ch.codePointAt(0);
    const light = cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037);
    n += light ? 1 : 2;
  }
  return n;
}
function splitTags(s) {
  const m = String(s).match(/((?:\s*#[\p{L}\p{N}_]+)+)\s*$/u);
  return m ? { body: s.slice(0, m.index).trim(), tags: m[1].trim().split(/\s+/) } : { body: String(s).trim(), tags: [] };
}
function fitX(s, limit = MAX.x) {
  s = String(s).trim();
  if (xLength(s) <= limit) return s;
  let { body, tags } = splitTags(s);
  const join = (b, t) => (t.length ? `${b}\n\n${t.join(' ')}` : b);
  while (tags.length > 1 && xLength(join(body, tags)) > limit) tags.pop();
  const words = body.split(/\s+/);
  while (words.length > 1 && xLength(join(words.join(' ') + '…', tags)) > limit) words.pop();
  let result = join(words.join(' ') + '…', tags);
  while (xLength(result) > limit) result = [...result].slice(0, -2).join('') + '…';
  return result;
}
function fitCaption(s, limit = 2200, maxTags = 30) {
  let { body, tags } = splitTags(String(s).trim());
  tags = tags.slice(0, maxTags);
  const tagLine = tags.join(' ');
  const room = limit - (tagLine ? tagLine.length + 2 : 0);
  if (body.length > room) body = body.slice(0, Math.max(0, room - 1)).replace(/\s+\S*$/, '') + '…';
  return tagLine ? `${body}\n\n${tagLine}` : body;
}
const countTags = (s) => (String(s).match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length;
// długość tekstu według zasad platformy (X: adres = 23 znaki)
const LENGTH = { x: xLength };
const lengthOf = (k, s) => (LENGTH[k] ? LENGTH[k](s) : String(s).length);
// Tekst w limicie zostaje bez zmian (układ autora / AI); dłuższy – przycięty, hashtagi w ostatniej linii
function fitText(s, limit, maxTags = 30) {
  const t = String(s).trim();
  return t.length <= limit && countTags(t) <= maxTags ? t : fitCaption(t, limit, maxTags);
}

// X: link na końcu (X liczy każdy adres jako 23 znaki); adres wstawiony przez AI usuwamy, żeby się nie powtarzał
function xWithLink(s, link) {
  if (!link) return fitX(s);
  const body = String(s)
    .split(link)
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return `${fitX(body, MAX.x - 25)}\n\n${link}`;
}
// Facebook: link na końcu tekstu (bez zdjęcia Facebook pokaże też podgląd linku)
function withLink(s, link, limit) {
  const body = fitText(s, limit);
  return link && !body.includes(link) ? `${body}\n\n${link}` : body;
}

// Tytuł posta (Telegram, lista draftów, hasło na wideo): pierwsza niepusta linia tekstu
function titleOf(text, max = 120) {
  const line =
    String(text || '')
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .find(Boolean) || '';
  return line.length > max ? `${line.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : line;
}

// ---------------------------------------------------------------------------------------------- wejście
const str = (v) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v)).trim();
// adres http(s); cudzysłów, < > i \ w poprawnym linku są zakodowane (zepsułyby HTML wiadomości w Telegramie)
const isHttpUrl = (s) => /^https?:\/\/[^\s/$.?#][^\s"<>\\]*$/i.test(s);

// Treść, link, wskazówka dla AI i platformy (kolejność jak w workflow)
function readInput(body) {
  const b = body || {};
  const errors = [];
  const text = str(b.text).replace(/\r\n?/g, '\n');
  if (!text) errors.push(tr('Napisz treść posta'));
  else if (text.length > MAX.text) errors.push(tr('Post może mieć najwyżej {0} znaków', MAX.text));
  const link = str(b.link);
  if (link && (!isHttpUrl(link) || link.length > MAX.link))
    errors.push(tr('Link musi być adresem zaczynającym się od http:// lub https://'));
  const hint = str(b.hint).slice(0, MAX.hint);
  const asked = Array.isArray(b.platforms) ? b.platforms.map(String) : [];
  const unknown = asked.filter((k) => !PLATFORMS.includes(k));
  if (unknown.length) errors.push(tr('Nieznana platforma: {0}', unknown.join(', ').slice(0, 60)));
  const platforms = PLATFORMS.filter((k) => asked.includes(k));
  if (!platforms.length && !unknown.length) errors.push(tr('Wybierz co najmniej jedną platformę'));
  if (errors.length) throw new HttpError(400, errors.join(' · '), { errors });
  return { text, link, hint, platforms };
}

// Wersje bez AI: tekst autora przycięty do limitów platform (link na X i Facebooku)
function plainVariants({ text, link, platforms }) {
  const v = {};
  for (const k of platforms) v[k] = variantFor(k, text, link);
  return v;
}
function variantFor(k, s, link) {
  if (k === 'x') return xWithLink(s, link);
  if (k === 'facebook') return withLink(s, link, MAX.facebook - (link ? link.length + 2 : 0));
  return String(s).trim();
}

// Teksty na wybrane platformy: brak tekstu, limity znaków (X liczy po swojemu), hashtagi Instagrama → errors
function checkPosts(platforms, posts, errors) {
  for (const k of platforms) {
    const s = posts[k];
    if (!s) errors.push(tr('Brak tekstu dla: {0}', NAMES[k]));
    else if (k === 'x' && xLength(s) > MAX.x) errors.push(tr('Wpis na X ma {0}/{1} znaków – skróć go', xLength(s), MAX.x));
    else if (k !== 'x' && lengthOf(k, s) > MAX[k])
      errors.push(tr('Tekst dla: {0} ma {1}/{2} znaków – skróć go', NAMES[k], lengthOf(k, s), MAX[k]));
    else if (k === 'instagram' && countTags(s) > 30) errors.push(tr('Instagram przyjmuje najwyżej 30 hashtagów'));
  }
}

// Odpowiedź AI → wersje na platformy; brakujące pole = tekst autora (bez AI) dla tej platformy
function parseAdapt(raw, input) {
  let out;
  try {
    out = JSON.parse(
      String(raw || '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/, ''),
    );
  } catch (e) {
    throw new HttpError(502, tr('AI zwróciło niepoprawną odpowiedź – spróbuj ponownie'));
  }
  if (!out || typeof out !== 'object') throw new HttpError(502, tr('AI zwróciło niepoprawną odpowiedź – spróbuj ponownie'));
  const key = { x: 'post_x', facebook: 'post_facebook' };
  const variants = {};
  const missing = [];
  for (const k of input.platforms) {
    const s = str(out[key[k]]);
    if (!s) missing.push(NAMES[k]);
    variants[k] = variantFor(k, s || input.text, input.link);
  }
  return {
    variants,
    missing,
  };
}

// ---------------------------------------------------------------------------------------------- moduł
class Compose {
  // runner – braki bota (Telegram, AI); ai – tekst AI; images – grafika marki (PRO)
  constructor(store, { dataDir, ai, runner, images }) {
    this.store = store;
    this.ai = ai;
    this.runner = runner;
    this.images = images;
    this.dir = path.join(dataDir, 'compose');
    this.recent = new Map(); // ostatnio wysłane posty (ochrona przed podwójnym kliknięciem)
  }

  // Dane edytora dla jednego bota: platformy (włączone w bocie, konta), braki i możliwości grafiki
  view(bot) {
    const acc = bot.accounts || {};
    const account = {
      x: acc.x ? `@${acc.x.username || '?'}` : null,
      facebook: acc.meta ? acc.meta.pageName || acc.meta.pageId : null,
    };
    const c = bot.content;
    return {
      id: bot.id,
      name: bot.name,
      language: bot.language,
      platforms: PLATFORMS.map((k) => ({ id: k, enabled: !!bot.publishing[k], account: account[k] || null })),
      problems: this.runner.publishProblems(bot),
      aiProblems: this.runner.textProblems(bot),
      ai: `${c.textProvider || 'gemini'}/${c.textModel || '?'}`,
    };
  }

  // Wersje na platformy: AI (ai !== false) albo tekst autora przycięty do limitów
  async adapt(bot, body) {
    const input = readInput(body);
    if (body && body.ai === false) {
      const plain = { variants: plainVariants(input), ai: null };
      return plain;
    }
    const problems = this.runner.textProblems(bot);
    if (problems.length) throw new HttpError(400, tr('AI nie jest gotowe: {0}', problems.join('; ')));
    const r = await this.ai.generateText(bot, promptFor(bot, input));
    const parsed = parseAdapt(r.text, input);
    return { ...parsed, ai: `${r.provider}/${r.model}`, fallbackUsed: r.fallbackUsed };
  }

  // Zlecenie dla n8n: sprawdzone teksty, platformy włączone w bocie i grafika → { job, key, upload } (key – ochrona
  // przed duplikatem; planAt – termin zaplanowanego posta, osobny klucz). save: false – zdjęcie zostaje w `upload`
  // (zapisze je wysyłka albo planowanie, gdy wszystkie boty przejdą sprawdzenie). Rzuca HttpError 400 z listą braków.
  prepare(bot, body, { save = true, planAt = null } = {}) {
    const b = body || {};
    const input = readInput(b);
    const errors = [];
    const off = input.platforms.filter((k) => !bot.publishing[k]);
    if (off.length)
      errors.push(tr('Platformy wyłączone w ustawieniach bota: {0} (zakładka Publikacja)', off.map((k) => NAMES[k]).join(', ')));

    const posts = {};
    for (const k of input.platforms) posts[k] = str(b.posts && b.posts[k]).replace(/\r\n?/g, '\n');
    checkPosts(input.platforms, posts, errors);

    const im = b.image || {};
    const source = IMAGE_SOURCES.includes(im.source) ? im.source : 'none';
    let upload = null;
    if (source === 'upload') {
      upload = this.decodeImage(im.data, errors);
      if (upload && input.platforms.includes('instagram')) {
        const ratio = upload.width / upload.height;
        if (ratio < IG_RATIO[0] - 0.01 || ratio > IG_RATIO[1] + 0.01)
          errors.push(tr('Instagram przyjmuje zdjęcia o proporcjach od 4:5 do 1,91:1 – przytnij zdjęcie albo odznacz Instagram'));
      }
    }
    if (errors.length) throw new HttpError(400, errors.join(' · '), { errors });

    const job = {
      text: input.text,
      title: titleOf(input.text),
      link: input.link,
      platforms: input.platforms,
      posts,
      image: { source },
      publishNow: b.publishNow === true,
      ai: str(b.ai).slice(0, 120),
    };

    // podwójne kliknięcie albo ponowne wysłanie tego samego posta – bez dublowania publikacji
    const key = `${bot.id}:${crypto
      .createHash('sha1')
      .update(JSON.stringify(planAt ? [job.platforms, job.posts, job.link, planAt] : [job.platforms, job.posts, job.link]))
      .digest('hex')}`;
    for (const [k, t] of this.recent) if (Date.now() - t > DUPLICATE_MS) this.recent.delete(k);
    if (this.recent.has(key)) throw new HttpError(409, tr('Ten post został przed chwilą wysłany – sprawdź Telegram i historię bota'));
    if (upload && save) job.image.upload = this.saveUpload(upload);
    return { job, key, upload: save ? null : upload };
  }

  // Post dla jednego albo kilku botów naraz (PRO): najpierw sprawdzenie wszystkich, potem zlecenia – błąd w jednym
  // bocie nie wysyła połowy postów. Wspólne: treść, link, grafika; osobno dla bota: platformy i wersje tekstów.
  // Wynik: { runs, failed } (wysyłka teraz / do akceptacji) albo { planned } (plan: { at, mode } – PRO).
  async batch(body) {
    const b = body || {};
    const list = Array.isArray(b.bots) ? b.bots.filter((it) => it && typeof it === 'object') : [];
    if (!list.length) throw new HttpError(400, tr('Wybierz co najmniej jednego bota'));
    if (list.length > 1) throw new HttpError(400, tr('Post dla kilku botów naraz – w wersji PRO'));
    if (b.plan) throw new HttpError(400, tr('Planowanie postów – w wersji PRO'));
    const plan = null;
    const shared = { text: b.text, link: b.link, hint: b.hint, image: b.image, publishNow: b.publishNow === true && !plan };
    const items = [];
    const errors = [];
    const seen = new Set();
    for (const it of list) {
      const bot = this.store.bot(String(it.id || ''));
      if (!bot) {
        errors.push({ status: 404, message: tr('Nie ma takiego bota') });
        continue;
      }
      if (seen.has(bot.id)) continue;
      seen.add(bot.id);
      const own = { platforms: it.platforms, posts: it.posts, ai: it.ai, videoTitle: it.videoTitle };
      try {
        items.push({ bot, ...this.prepare(bot, { ...shared, ...own }, { save: false, planAt: plan ? String(plan.at || '') : null }) });
      } catch (e) {
        if (!(e instanceof HttpError) || e.status >= 500) throw e;
        errors.push({ status: e.status, message: list.length > 1 ? `${bot.name}: ${e.message}` : e.message });
      }
    }
    if (errors.length) {
      const messages = errors.map((e) => e.message);
      throw new HttpError(errors.every((e) => e.status === 409) ? 409 : 400, messages.join(' · '), { errors: messages });
    }
    const runs = [];
    const failed = [];
    for (const it of items) {
      if (it.upload) it.job.image.upload = this.saveUpload(it.upload);
      try {
        runs.push(await this.runner.start(it.bot, { kind: 'compose', trigger: 'manual', extra: { compose: it.job } }));
        this.recent.set(it.key, Date.now());
      } catch (e) {
        if (it.job.image.upload) this.removeUpload(it.job.image.upload);
        failed.push({ botId: it.bot.id, botName: it.bot.name, error: e.message, status: e.status || 500 });
      }
    }
    // nic nie wyszło – błąd jak przy jednym bocie (np. n8n nie odpowiada)
    if (!runs.length)
      throw new HttpError(failed[0].status, failed.map((f) => (items.length > 1 ? `${f.botName}: ${f.error}` : f.error)).join(' · '));
    return { runs, failed: failed.map(({ botId, botName, error }) => ({ botId, botName, error })) };
  }

  // Zlecenie „compose” do n8n (draft → Telegram albo publikacja od razu); błąd startu usuwa wgrane zdjęcie.
  // trigger: manual (panel) albo telegram (/post z Telegrama, PRO)
  async send(bot, body, { trigger = 'manual' } = {}) {
    const { job, key } = this.prepare(bot, body);
    let run;
    try {
      run = await this.runner.start(bot, { kind: 'compose', trigger, extra: { compose: job } });
    } catch (e) {
      if (job.image.upload) this.removeUpload(job.image.upload);
      throw e;
    }
    this.recent.set(key, Date.now());
    return run;
  }

  // Grafika dla n8n (węzeł „Grafika: panel”): zdjęcie z panelu albo grafika marki (PRO) – jak resolve() w images.js
  async image(bot, { source, upload } = {}) {
    const warnings = [];
    if (source === 'upload') {
      const img = this.readUpload(upload);
      if (img) return { source: 'upload', ...img, warnings };
      warnings.push(tr('nie znaleziono zdjęcia wgranego w panelu'));
    }
    return { source: 'none', warnings };
  }

  // ------------------------------------------------------------------ zdjęcie wgrane w panelu
  decodeImage(data, errors) {
    const buffer = Buffer.from(
      String(data || '')
        .replace(/^data:[^,]*,/, '')
        .replace(/\s+/g, ''),
      'base64',
    );
    const mimeType = sniffImage(buffer);
    if (!buffer.length) errors.push(tr('Dodaj zdjęcie albo wybierz post bez grafiki'));
    else if (!['image/jpeg', 'image/png'].includes(mimeType)) errors.push(tr('Zdjęcie musi być plikiem JPG albo PNG'));
    else if (buffer.length > MAX_IMAGE_BYTES) errors.push(tr('Zdjęcie może mieć najwyżej 5 MB'));
    else {
      const dims = imageSize(buffer);
      if (!dims.width || Math.min(dims.width, dims.height) < MIN_IMAGE_SIDE)
        errors.push(tr('Zdjęcie jest za małe – potrzeba co najmniej {0} px z każdej strony', MIN_IMAGE_SIDE));
      else return { buffer, mimeType, ...dims };
    }
    return null;
  }

  saveUpload({ buffer, mimeType }) {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.cleanup();
    const id = randomId(12);
    fs.writeFileSync(path.join(this.dir, `${id}.${mimeType === 'image/png' ? 'png' : 'jpg'}`), buffer, { mode: 0o600 });
    return id;
  }

  readUpload(id) {
    if (!/^[a-z0-9]{12}$/.test(String(id || ''))) return null;
    for (const ext of ['jpg', 'png']) {
      try {
        const buffer = fs.readFileSync(path.join(this.dir, `${id}.${ext}`));
        return { buffer, mimeType: sniffImage(buffer) || 'image/jpeg', ...imageSize(buffer) };
      } catch (e) {}
    }
    return null;
  }

  removeUpload(id) {
    if (!/^[a-z0-9]{12}$/.test(String(id || ''))) return;
    for (const ext of ['jpg', 'png']) fs.rmSync(path.join(this.dir, `${id}.${ext}`), { force: true });
  }

  // Kopia zdjęcia zaplanowanego posta (PRO) w tym katalogu – stąd odbierze je n8n; oryginał czeka do wysyłki
  copyUpload(file) {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.cleanup();
    const id = randomId(12);
    const target = path.join(this.dir, `${id}${path.extname(file)}`);
    fs.copyFileSync(file, target);
    fs.chmodSync(target, 0o600);
    return id;
  }

  // Zdjęcia starsze niż 48 godzin (n8n zapisał już swoją kopię w data/files)
  cleanup(now = Date.now()) {
    let names = [];
    try {
      names = fs.readdirSync(this.dir);
    } catch (e) {
      return;
    }
    for (const n of names) {
      const p = path.join(this.dir, n);
      try {
        if (now - fs.statSync(p).mtimeMs > UPLOAD_TTL_MS) fs.rmSync(p, { force: true });
      } catch (e) {}
    }
  }
}

module.exports = {
  Compose,
  PLATFORMS,
  NAMES,
  MAX,
  MAX_IMAGE_BYTES,
  IG_RATIO,
  xLength,
  fitX,
  fitCaption,
  titleOf,
  readInput,
  checkPosts,
  promptFor,
  plainVariants,
  variantFor,
  parseAdapt,
};
