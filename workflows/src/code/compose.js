// ✍️ Własny post z panelu (zlecenie „compose”): teksty na wybrane platformy są gotowe – AI dopasowało je w panelu
// albo to tekst autora. Budujemy z nich draft w tym samym formacie co „Parsuj odpowiedź LLM” i wiadomości do
// Telegrama; dalej (grafika, draft, Telegram, publikacja, raport) wszystko jak przy newsach.
const cfg = $('Config').first().json;
const c = cfg.compose;
const has = (k) => c.platforms.includes(k);

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
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
const cut = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

const draftId = `d${$now.toFormat('yyyyLLdd-HHmm')}-${Math.random().toString(36).slice(2, 6)}`;
const postX = c.posts.x || '';
const postFb = c.posts.facebook || '';
const names = { x: 'X', facebook: 'FB' };
const platforms = c.platforms.map((k) => names[k]);

// Nagłówek (podpis zdjęcia) – linię o grafice dopisuje węzeł „Grafika: przygotuj” (przed ostatnią linią)
const captionParts = [
  tr('✍️ <b>Własny post</b> · 🤖 <b>{0}</b> · <code>{1}</code>', esc(cfg.botName), draftId),
  `📝 <b>${esc(cut(c.title, 200))}</b>`,
  c.link ? tr('🔗 <a href="{0}">link w poście</a>', esc(c.link)) : '',
  c.publishNow
    ? tr('🚀 Publikuję teraz – zlecenie z panelu ({0}).', platforms.join(', '))
    : tr('👇 Sprawdź teksty i zatwierdź przyciskiem pod ostatnią wiadomością.'),
].filter(Boolean);

// Teksty postów – w Telegramie najwyżej 4096 znaków na wiadomość, więc długie teksty skracamy tylko w podglądzie
const blocks = [
  has('x') && [`🐦 <b>X</b> · ${xLength(postX)}/280`, postX],
  has('facebook') && [tr('📘 <b>Facebook</b> · {0} znaków', postFb.length), postFb],
].filter(Boolean);
const room = Math.floor(3600 / blocks.length);
const postsText = blocks
  .map(([title, text]) => `${title}\n<pre>${esc(text.length > room ? `${text.slice(0, room - 1)}…` : text)}</pre>`)
  .join('\n\n');

// przyciski ✅/❌ pod ostatnią wiadomością draftu (bez nich, gdy autor kliknął „Publikuj teraz”)
const keyboard = {
  inline_keyboard: [
    [
      { text: tr('✅ Publikuj ({0})', platforms.join(' + ')), callback_data: `pub:${draftId}` },
      { text: tr('❌ Odrzuć'), callback_data: `rej:${draftId}` },
    ],
  ],
};
const info = [`🧠 <i>${c.ai ? tr('Tekst: {0} (dopasowany do platform)', esc(c.ai)) : tr('Tekst: Twój, bez AI')}</i>`]
  .filter(Boolean)
  .join('\n\n');
const messages = [
  { text: postsText, textLink: postsText },
  { text: info, reply_markup: c.publishNow ? undefined : keyboard },
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
      mode: 'manual',
      topic: cfg.topic,
      // „news” – jak w draftach z newsów: tytuł (pierwsza linia tekstu), link z posta, źródło = własny post
      news: {
        title: c.title,
        url: c.link,
        source: tr('Własny post'),
        sourceType: 'manual',
        publishedAt: new Date().toISOString(),
        images: [],
      },
      whySelected: '',
      platforms: c.platforms,
      composeText: c.text,
      // X: link (jeśli jest) panel dopisał już na końcu tekstu
      post_x: postX,
      post_x_link: postX,
      post_fb_insta: postFb,
      script_tiktok: '',
      // grafika dla węzła „Grafika: panel”: zdjęcie wgrane w panelu albo brak
      composeImage: { source: c.image.source, upload: c.image.upload },
      llmModel: c.ai || tr('bez AI'),
      results: {},
      telegram: { captionParts, messages },
    },
  },
];
