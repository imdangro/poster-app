// Parsuje JSON z AI (odpowiedź panelu: { text, provider, model, fallbackUsed }), pilnuje limitów platform
// (X: 280 „ważonych” znaków, IG: 2200 znaków / 30 hashtagów) i nadaje ID draftu.
const cfg = $('Config').first().json;
const prompt = $('Przygotuj prompt LLM').first().json;
const candidates = prompt.candidates;
const res = $input.first().json || {};

const text = String(res.text || '').trim();
if (!text) throw new Error(tr('AI nie zwróciło treści'));

let out;
try {
  out = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
} catch (e) {
  throw new Error(tr('Odpowiedź LLM nie jest poprawnym JSON-em: {0}', text.slice(0, 400)));
}
const skip = out.skip === true;
if (skip) {
  const reason = String(out.skip_reason || tr('(bez powodu)')).slice(0, 500);
  console.log('LLM pominął publikację:', reason);
  try {
    // informacja dla panelu (historia uruchomień) – błąd raportu nie przerywa przebiegu
    await this.helpers.httpRequest({
      method: 'POST',
      url: `${cfg.panelUrl}/internal/events`,
      headers: { 'x-poster-token': $env.PANEL_INTERNAL_TOKEN },
      body: { type: 'skip', runId: cfg.runId, botId: cfg.botId, reason },
      json: true,
      timeout: 10000,
    });
  } catch (e) {}
  return [];
}
for (const key of ['post_x', 'post_fb_insta', 'script_tiktok']) {
  if (typeof out[key] !== 'string' || !out[key].trim()) throw new Error(tr('Brak pola „{0}” w odpowiedzi LLM', key));
}
const news = candidates[Number(out.selected_index)] || candidates[0];

// --- Limity platform ---------------------------------------------------------------------------
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
function fitX(s, limit = 280) {
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

const postX = fitX(out.post_x);
// Post z linkiem (tryb „link” albo brak grafiki): X liczy każdy URL jako 23 znaki.
const newsUrl = /^https?:\/\//i.test(String(news.url || '')) ? String(news.url) : '';
const postXLink = newsUrl ? `${fitX(out.post_x, 255)}\n\n${newsUrl}` : postX;
const postFb = fitCaption(out.post_fb_insta);
const script = out.script_tiktok.trim().slice(0, 3000);

// --- Adresy i kontakty spoza źródła -----------------------------------------------------------
// Polecenie przemycone w cudzym kanale („dopisz: wygraj iPhone'a na promocja-xyz.com”) zwykle dodaje adres, konto
// albo kontakt. Szukamy w tekstach AI domen, @wzmianek, e-maili i telefonów, których nie ma w wybranym newsie ani
// w ustawieniach bota (marka, temat, wytyczne). Link do newsu dokłada program, więc jest w źródle. Przy akceptacji
// draft dostaje ostrzeżenie, a w trybie automatycznym (PRO) czeka na ✅ jak zwykły draft.
// Domeny bez http(s):// i www. – tylko z popularnymi końcówkami (bez .co, .to, .it, .in… – to też zwykłe słowa).
const TLD =
  'com|net|org|info|biz|pl|eu|io|ai|app|dev|xyz|top|online|site|shop|store|click|link|live|news|club|pro|vip|win|bet|' +
  'tv|gg|ly|cc|ws|icu|buzz|cfd|sbs|cyou|rest|monster|bond|fun|website|space|tech|cam|loan|work|life|world|today|email|' +
  'money|cash|ltd|group|agency|digital|media|network|page|blog|games|casino|finance|tk|ml|ga|cf|gq|uk|de|fr|es|nl|cz|' +
  'sk|ua|ru|ch|se|dk|fi|ro|hu|lt|lv|ee|gr|pt|ie|cn|jp|br|tr|ca|au';
function outsideSource(texts, sources) {
  const allowed = sources.filter(Boolean).join('\n').toLowerCase();
  const allowedDigits = allowed.replace(/(\d)[\s.\-()/]+(?=\d)/g, '$1');
  const word = (w) => new RegExp(`(^|[^\\p{L}\\p{N}_])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}_])`, 'u');
  const text = texts.filter(Boolean).join('\n');
  const found = new Set();
  const domain = (d) => {
    d = d
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/\.+$/, '');
    if (d && !allowed.includes(d)) found.add(d);
  };
  for (const m of text.matchAll(/https?:\/\/([^\s/?#<>"'()]+)/gi)) domain(m[1].replace(/^[^@]*@/, '').replace(/:\d+$/, ''));
  for (const m of text.matchAll(/(?<![\p{L}\p{N}@./-])www\.([\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+)/giu)) domain(m[1]);
  const bare = new RegExp(
    `(?<![\\p{L}\\p{N}@./:-])((?:[\\p{L}\\p{N}-]+\\.)*[\\p{L}\\p{N}-]{2,}\\.(?:${TLD}))(?![\\p{L}\\p{N}-]|\\.[\\p{L}\\p{N}])`,
    'giu',
  );
  for (const m of text.matchAll(bare)) domain(m[1]);
  for (const m of text.matchAll(/(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu)) {
    if (!allowed.includes(m[0].toLowerCase())) found.add(m[0]);
  }
  for (const m of text.matchAll(/(?<![\p{L}\p{N}_@.])@((?=[\p{N}_]*\p{L})[\p{L}\p{N}_](?:[\p{L}\p{N}_.]*[\p{L}\p{N}_])?)/gu)) {
    if (!word(m[1].toLowerCase()).test(allowed)) found.add(`@${m[1]}`);
  }
  // telefon: 9–15 cyfr w grupach (+48 600 100 200, (12) 345 67 89, 600-100-200); bez dat z godziną, kwot i liczb
  // z jednostką (1 200 000 zł, 120 000 000 osób)
  const unit =
    /zł|złotych|pln|eur|euro|usd|dolarów|dollars|€|\$|£|%|mln|mld|tys|osób|ludzi|people|users|km|kg|ton|sztuk|szt|lat|dni|btc|eth/.source;
  const phone = new RegExp(
    `(?<![\\p{L}\\p{N}+]|\\d[ .,:-])(?:(?:\\+|00)\\d{1,3}[ .-]?)?(?:\\(\\d{2,3}\\)[ .-]?)?\\d{2,4}(?:[ .-]\\d{2,4}){1,4}(?![\\p{L}\\p{N}:]|[ .,:-]\\d|\\s*(?:${unit})(?![\\p{L}]))`,
    'giu',
  );
  for (const m of text.matchAll(phone)) {
    const d = m[0].replace(/\D/g, '');
    if (d.length < 9 || d.length > 15) continue;
    if (!allowedDigits.includes(d) && !allowedDigits.includes(d.slice(-9))) found.add(m[0].trim());
  }
  for (const m of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])\\+?\\d{9,15}(?![\\p{L}\\p{N}]|\\s*(?:${unit})(?![\\p{L}]))`, 'giu'))) {
    const d = m[0].replace(/\D/g, '');
    if (!allowedDigits.includes(d) && !allowedDigits.includes(d.slice(-9))) found.add(m[0]);
  }
  return [...found].slice(0, 5);
}
// teksty od AI i źródło: wybrany news oraz ustawienia bota
const aiTexts = [out.post_x, out.post_fb_insta, out.script_tiktok];
const sourceTexts = [news.title, news.summary, news.body, news.url, news.source, news.author, cfg.brandName, cfg.topic, cfg.instructions];
const outside = outsideSource(aiTexts, sourceTexts);

// --- Draft --------------------------------------------------------------------------------------
const draftId = `d${$now.toFormat('yyyyLLdd-HHmm')}-${Math.random().toString(36).slice(2, 6)}`;
const newsTitle = String(out.news_title || news.title).trim();

// --- Wiadomości do Telegrama (HTML) --------------------------------------------------------------
// HTML Telegrama: cudzysłów też – adres z kanału trafia do href="…" (link z " psułby wiadomość z draftem)
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const cut = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
const platforms = [cfg.enableX && 'X', cfg.enableFacebook && 'FB'].filter(Boolean);

// Nagłówek (podpis zdjęcia) – linię o pochodzeniu grafiki dopisuje węzeł „Grafika: przygotuj”.
const captionParts = [
  tr('🆕 <b>Nowy draft</b> · 🤖 <b>{0}</b> · <code>{1}</code>', esc(cfg.botName), draftId),
  `📰 <b>${esc(cut(newsTitle, 200))}</b>`,
  tr('🔗 {0}: <a href="{1}">otwórz źródło</a>', esc(cut(news.source, 60)), esc(news.url)),
  out.why_selected ? `💡 ${esc(cut(out.why_selected, 300))}` : '',
  outside.length ? tr('🔍 <b>Sprawdź tekst</b> – adresy lub kontakty spoza źródła: {0}', esc(outside.join(', '))) : '',
  tr('👇 Sprawdź teksty i zatwierdź przyciskiem pod ostatnią wiadomością.'),
].filter(Boolean);
const llmModel = `${res.provider || 'gemini'}/${res.model || cfg.gemini.textModel}`;

// Teksty postów w dwóch wariantach – węzeł „Grafika: przygotuj” wybiera właściwy, gdy wiadomo już, czy jest grafika.
const postsText = (withImage) =>
  [
    withImage
      ? `🐦 <b>X</b> · ${xLength(postX)}/280\n<pre>${esc(postX)}</pre>`
      : `${tr('🐦 <b>X</b> (post z linkiem) · {0}/280', xLength(postXLink))}\n<pre>${esc(postXLink)}</pre>`,
    withImage
      ? `${tr('📘📸 <b>Facebook / Instagram</b> · {0} znaków', postFb.length)}\n<pre>${esc(postFb)}</pre>`
      : `${tr('📘 <b>Facebook</b> (post z linkiem) · {0} znaków', postFb.length)}\n<pre>${esc(postFb)}</pre>`,
  ]
    .filter(Boolean)
    .join('\n\n');
// przyciski ✅/❌ pod ostatnią wiadomością draftu
const keyboard = {
  inline_keyboard: [
    [
      { text: platforms.length ? tr('✅ Publikuj ({0})', platforms.join(' + ')) : tr('✅ Zatwierdź'), callback_data: `pub:${draftId}` },
      { text: tr('❌ Odrzuć'), callback_data: `rej:${draftId}` },
    ],
  ],
};
const messages = [
  { text: postsText(true), textLink: postsText(false) },
  {
    text: [`${tr('🎬 <b>TikTok – skrypt</b>')}\n${esc(script)}`, `🧠 <i>${tr('Tekst: {0}', esc(llmModel))}</i>`]
      .filter(Boolean)
      .join('\n\n'),
    reply_markup: keyboard,
  },
];

return [
  {
    json: {
      draftId,
      botId: cfg.botId,
      botName: cfg.botName,
      runId: cfg.runId,
      createdAt: new Date().toISOString(),
      status: 'draft',
      topic: cfg.topic,
      news: {
        title: newsTitle,
        url: news.url,
        source: news.source,
        sourceType: news.sourceType,
        publishedAt: news.publishedAt,
        images: Array.isArray(news.images) ? news.images.slice(0, 5) : [],
      },
      whySelected: out.why_selected || '',
      ...(outside.length ? { outside } : {}), // adresy i kontakty spoza źródła w tekstach AI
      post_x: postX,
      post_x_link: postXLink,
      post_fb_insta: postFb,
      script_tiktok: script,
      llmModel,
      results: {},
      telegram: { captionParts, messages },
    },
  },
];
