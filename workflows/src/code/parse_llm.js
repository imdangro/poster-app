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

// --- Draft --------------------------------------------------------------------------------------
const draftId = `d${$now.toFormat('yyyyLLdd-HHmm')}-${Math.random().toString(36).slice(2, 6)}`;
const newsTitle = String(out.news_title || news.title).trim();

// --- Wiadomości do Telegrama (HTML) --------------------------------------------------------------
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
const cut = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
const platforms = [cfg.enableX && 'X', cfg.enableFacebook && 'FB'].filter(Boolean);

// Nagłówek (podpis zdjęcia) – linię o pochodzeniu grafiki dopisuje węzeł „Grafika: przygotuj”.
const captionParts = [
  tr('🆕 <b>Nowy draft</b> · 🤖 <b>{0}</b> · <code>{1}</code>', esc(cfg.botName), draftId),
  `📰 <b>${esc(cut(newsTitle, 200))}</b>`,
  tr('🔗 {0}: <a href="{1}">otwórz źródło</a>', esc(cut(news.source, 60)), esc(news.url)),
  out.why_selected ? `💡 ${esc(cut(out.why_selected, 300))}` : '',
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
