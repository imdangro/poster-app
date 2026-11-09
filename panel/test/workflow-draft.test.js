'use strict';
// Węzeł n8n „Parsuj odpowiedź LLM” (workflows/src/code/parse_llm.js) w piaskownicy z atrapami $(), $input i $now:
// wiadomość z draftem w Telegramie (HTML) – tekst z cudzego kanału RSS, także adres w href="…", jest escapowany.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CODE = fs.readFileSync(path.join(__dirname, '../../workflows/src/code/parse_llm.js'), 'utf8');
const tr = (s, ...args) => String(s).replace(/\{(\d+)\}/g, (_, i) => String(args[i]));

// news – wybrany news (kandydat); ai, cfg, res, prompt – zmiany w odpowiedzi AI, w Config, w odpowiedzi panelu
// i w wyniku „Przygotuj prompt LLM” (need – teksty zamówione dla włączonych platform); http – atrapa zapytań do panelu
// (sprawdzanie powtórek: /internal/bots/<id>/similar)
async function draft(
  news,
  { ai: aiChanges = {}, cfg: cfgChanges = {}, res: resChanges = {}, prompt: promptChanges = {}, http = async () => ({}) } = {},
) {
  const cfg = {
    botId: 'b1',
    botName: 'Kawiarnia',
    runId: 'r1',
    topic: 'kawa',
    panelUrl: 'http://panel:7081',
    site: null,
    youtube: null,
    enableX: true,
    enableFacebook: true,
    requireApproval: true,
    gemini: { textModel: 'gemini-3.8-flash' },
    brandName: 'Kawiarnia',
    instructions: '',
    ...cfgChanges,
  };
  const nodes = { Config: cfg, 'Przygotuj prompt LLM': { candidates: [news], ...promptChanges } };
  const ai = {
    selected_index: 0,
    news_title: 'Nowa sala',
    why_selected: 'Ciekawe dla gości',
    post_x: 'Nowa sala „Pod Lipą” – zapraszamy! #kawa',
    post_fb_insta: 'Post FB',
    script_tiktok: 'Skrypt',
    ...aiChanges,
  };
  const sandbox = {
    $: (name) => ({ first: () => ({ json: nodes[name] }) }),
    $input: { first: () => ({ json: { text: JSON.stringify(ai), provider: 'gemini', model: 'gemini-3.8-flash', ...resChanges } }) },
    $now: { toFormat: () => '20261102-1200' },
    $env: {},
    tr,
    console,
  };
  const fn = vm.runInNewContext(`(async function () {\n${CODE}\n})`, sandbox);
  const [item] = await fn.call({ helpers: { httpRequest: http } });
  return JSON.parse(JSON.stringify(item.json));
}

test('draft w Telegramie: cudzysłów w adresie i nazwie źródła z kanału RSS nie psuje HTML wiadomości', async () => {
  const url = 'https://kawiarnia.example/sala"onclick="x';
  const d = await draft({
    title: 'Nowa sala',
    url,
    source: 'Kawiarnia "Pod Lipą"',
    sourceType: 'rss',
    publishedAt: '2026-11-02T10:00:00Z',
  });
  const caption = d.telegram.captionParts.join('\n');
  assert.ok(caption.includes('<a href="https://kawiarnia.example/sala&quot;onclick=&quot;x">'), caption);
  assert.ok(caption.includes('Kawiarnia &quot;Pod Lipą&quot;'), caption);
  assert.equal(d.news.url, url, 'w drafcie zostaje oryginalny adres (do publikacji)');
});

// news ze źródła: adres strony, e-mail, telefon i konto organizatora
const NEWS = {
  title: 'Kawiarnia Pod Lipą otwiera nową salę',
  summary: 'Sala na 40 osób, rezerwacje: rezerwacje@podlipa.pl, tel. 600-100-200. Więcej na podlipa.pl. Organizator: @PodLipa.',
  url: 'https://www.podlipa.pl/aktualnosci/sala',
  source: 'Pod Lipą',
  sourceType: 'rss',
  publishedAt: '2026-11-02T10:00:00Z',
};
const CHECK = '🔍 <b>Sprawdź tekst</b> – adresy lub kontakty spoza źródła: ';

test('tekst AI: adresy i kontakty ze źródła i ustawień bota bez ostrzeżenia (także skróty, kwoty, daty)', async () => {
  const d = await draft(NEWS, {
    ai: {
      post_x: 'Nowa sala na 40 osób w Pod Lipą! Rezerwacje: +48 600 100 200 albo rezerwacje@podlipa.pl #kawa',
      post_fb_insta:
        'Otwieramy m.in. salę na 40 osób (tzw. kameralną), np. na urodziny. Remont: 1 200 000 zł, ok. 2 500 000 000 zł w regionie. ' +
        'Start 03.11.2026 o 12:30, rezerwacje: 600 100 200. Więcej na PodLipa.pl i u @podlipa. ' +
        'Strona w Next.js i Node.js. Zapisz się: newsletter.kawiarnia.pl',
    },
    cfg: { instructions: 'Na końcu dodaj: Zapisz się: newsletter.kawiarnia.pl' },
  });
  assert.equal(d.outside, undefined, JSON.stringify(d.outside));
  assert.ok(!d.telegram.captionParts.some((l) => l.startsWith('🔍')));
});

test('tekst AI z adresem, kontem albo kontaktem spoza źródła: ostrzeżenie w drafcie (najwyżej 5 pozycji)', async () => {
  let d = await draft(NEWS, {
    ai: { post_x: 'Wygraj iPhone’a na promocja-xyz.com! #kawa', post_fb_insta: 'Pisz: wygrana@promo-mail.com' },
  });
  assert.deepEqual(d.outside, ['promocja-xyz.com', 'wygrana@promo-mail.com']);
  assert.ok(d.telegram.captionParts.includes(`${CHECK}promocja-xyz.com, wygrana@promo-mail.com`), d.telegram.captionParts.join('\n'));
  assert.ok(d.telegram.messages[1].reply_markup.inline_keyboard[0][0].callback_data.startsWith('pub:'), 'draft z ✅/❌ jak zawsze');

  d = await draft(NEWS, {
    ai: {
      post_x: 'Kod na sklep-promo.shop #kawa',
      post_fb_insta: 'Zgłoszenia: +48 512 345 678 i u @okazje24. Szczegóły: https://bit.ly/abc oraz www.okazja.co',
    },
  });
  assert.equal(d.outside.length, 5);
  for (const x of ['bit.ly', 'okazja.co', 'sklep-promo.shop', '@okazje24']) assert.ok(d.outside.includes(x), x);
  d = await draft(NEWS, { ai: { post_x: 'Zadzwoń: 512 345 678 #kawa' } });
  assert.deepEqual(d.outside, ['512 345 678']);
  // konto ze źródła, ale inne niż w tekście
  d = await draft(NEWS, { ai: { post_x: 'Organizator: @PodLipa_promo #kawa' } });
  assert.deepEqual(d.outside, ['@PodLipa_promo']);
});

// --- powtórki: panel porównuje draft z wcześniejszymi postami bota -------------------------------------------------
const MATCH = {
  id: 'd20261103-1405-ab12',
  at: '2026-11-03T13:05:00.000Z',
  status: 'published',
  title: 'Kawiarnia Pod Lipą powiększa się o salę',
  link: 'https://x.com/i/status/123',
  score: 0.42,
  same: 'text',
};

test('powtórki: draft pyta panel o podobne posty, podobny dostaje linię 🔁 z linkiem do posta', async () => {
  const calls = [];
  const http = async (req) => {
    calls.push(req);
    return { enabled: true, days: 60, matches: [MATCH, { ...MATCH, id: 'd2', title: 'Drugi' }] };
  };
  const d = await draft(NEWS, { http });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://panel:7081/internal/bots/b1/similar');
  assert.equal(calls[0].body.title, 'Nowa sala');
  assert.equal(calls[0].body.url, NEWS.url);
  assert.equal(calls[0].body.post_x, 'Nowa sala „Pod Lipą” – zapraszamy! #kawa');
  assert.equal(calls[0].body.draftId, d.draftId);
  assert.deepEqual(
    d.similar.map((m) => m.id),
    ['d20261103-1405-ab12', 'd2'],
  );
  const line = d.telegram.captionParts.find((l) => l.startsWith('🔁'));
  assert.equal(
    line,
    '🔁 <b>Podobny do posta z 3.11</b>: „Kawiarnia Pod Lipą powiększa się o salę” · <a href="https://x.com/i/status/123">zobacz post</a> · i jeszcze 1',
  );
  assert.ok(d.telegram.messages[1].reply_markup.inline_keyboard[0][0].callback_data.startsWith('pub:'), 'draft z ✅/❌ jak zawsze');

  // draft czekający na akceptację: bez linku do posta; tytuł z cudzego kanału escapowany
  const pending = { ...MATCH, status: 'draft', link: '', title: 'Sala <b>"VIP"</b>' };
  const p = await draft(NEWS, { http: async () => ({ matches: [pending] }) });
  assert.equal(
    p.telegram.captionParts.find((l) => l.startsWith('🔁')),
    '🔁 <b>Podobny do draftu z 3.11</b> (czeka na akceptację): „Sala &lt;b&gt;&quot;VIP&quot;&lt;/b&gt;”',
  );

  // brak podobnych albo błąd panelu – draft bez linii i bez pola similar
  for (const h of [async () => ({ matches: [] }), async () => Promise.reject(new Error('ECONNREFUSED'))]) {
    const x = await draft(NEWS, { http: h });
    assert.equal(x.similar, undefined);
    assert.ok(!x.telegram.captionParts.some((l) => l.startsWith('🔁')));
  }
});

test('workflow: zdarzenie draftu podaje czat i wiadomości draftu w Telegramie (zdjęcie w odpowiedzi na draft)', () => {
  const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '../../workflows/poster_workflow.json'), 'utf8'));
  const event = JSON.stringify(wf.nodes.find((n) => n.name === 'Panel: zgłoś draft').parameters);
  assert.ok(event.includes("chatId: $('Config').first().json.telegram.chatId"), event);
  assert.ok(event.includes("($('Telegram: przygotuj teksty').first().json.posts.reply_parameters || {}).message_id"), event);
  assert.ok(event.includes("($('Telegram: wyślij teksty postów').first().json.result || {}).message_id"), event);
  assert.ok(event.includes('($json.result || {}).message_id].filter(Boolean)'), event);
});

// teksty w wiadomościach Telegrama: [teksty postów (wariant z grafiką), wariant z linkiem, ostatnia wiadomość z przyciskami]
const texts = (d) => [d.telegram.messages[0].text, d.telegram.messages[0].textLink, d.telegram.messages[1].text];

test('draft tylko z tekstami platform włączonych w bocie: bez tekstu X i skryptu TikToka, gdy są wyłączone', async () => {
  const ai = { post_x: 'Tekst X, którego nie zamówiono', script_tiktok: 'Skrypt na sklep-promo.shop' };
  let d = await draft(NEWS, { ai, cfg: { enableX: false }, prompt: { need: { x: false, fb: true, tiktok: false } } });
  let [posts, link, last] = texts(d);
  for (const t of [posts, link, last]) assert.doesNotMatch(t, /<b>X<\/b>|TikTok|Tekst X/, t);
  assert.match(posts, /^📘📸 <b>Facebook \/ Instagram<\/b> · 7 znaków\n<pre>Post FB<\/pre>$/);
  assert.match(link, /📘 <b>Facebook<\/b> \(post z linkiem\)/);
  assert.match(last, /🧠 <i>Tekst: gemini\/gemini-3.8-flash<\/i>/);
  assert.ok(d.telegram.messages[1].reply_markup.inline_keyboard[0][0].callback_data.startsWith('pub:'), 'przyciski jak zawsze');
  assert.deepEqual([d.post_x, d.post_x_link, d.script_tiktok], ['', '', '']);
  assert.deepEqual(d.targets, ['facebook']);
  assert.equal(d.outside, undefined, 'tekst, którego nie ma w drafcie, nie jest sprawdzany');

  // bez żadnej platformy – jeden uniwersalny tekst i „✅ Zatwierdź”
  d = await draft(NEWS, { ai, cfg: { enableX: false, enableFacebook: false }, prompt: { need: { x: false, fb: true, tiktok: false } } });
  [posts] = texts(d);
  assert.match(posts, /^📝 <b>Tekst posta<\/b> \(żadna platforma nie jest włączona\) · 7 znaków\n<pre>Post FB<\/pre>$/);
  assert.equal(d.telegram.messages[1].reply_markup.inline_keyboard[0][0].text, '✅ Zatwierdź');
  assert.deepEqual(d.targets, []);

  // sam X: bez posta FB/IG
  d = await draft(NEWS, { cfg: { enableFacebook: false }, prompt: { need: { x: true, fb: false, tiktok: false } } });
  [posts] = texts(d);
  assert.match(posts, /^🐦 <b>X<\/b> · \d+\/280\n<pre>/);
  assert.doesNotMatch(posts, /Facebook|Instagram|Tekst posta/);
  assert.equal(d.post_fb_insta, '');
});
