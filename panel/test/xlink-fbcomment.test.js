'use strict';
// X ręcznie przez oficjalny link (web intent, bez API) i link w pierwszym komentarzu na Facebooku: ustawienia bota,
// konfiguracja dla n8n, węzły workflow („Parsuj odpowiedź LLM”, „Post własny: przygotuj”, „Parsuj draft”,
// „Podsumowanie publikacji”) w piaskownicy z atrapami $(), połączenia węzłów, bramka i przycisk z adresem pod draftem
// w Telegramie w trakcie publikacji.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const { Store } = require('../lib/store');
const { Runner } = require('../lib/runner');
const { Accounts, UPSTREAM, metaCommentProblems } = require('../lib/accounts');
const { gatewayAllows } = require('../lib/gateway');
const { Telegram } = require('../lib/telegram');
const { tmpDir } = require('./helpers');

const code = (file) => fs.readFileSync(path.join(__dirname, '../../workflows/src/code', file), 'utf8');
const WORKFLOW = JSON.parse(fs.readFileSync(path.join(__dirname, '../../workflows/poster_workflow.json'), 'utf8'));
const tr = (s, ...args) => String(s).replace(/\{(\d+)\}/g, (_, i) => String(args[i]));
const node = (json, isExecuted = true) => ({ isExecuted, first: () => ({ json }) });
const plain = (v) => JSON.parse(JSON.stringify(v));
// tekst zapisany w oficjalnym linku X (tak odczyta go x.com)
const intentText = (u) => {
  assert.match(u, /^https:\/\/x\.com\/intent\/tweet\?text=/);
  return new URL(u).searchParams.get('text');
};

const CFG = { botName: 'Kawiarnia', runId: 'r1', botId: 'b1', enableX: true, enableFacebook: true, requireApproval: true };

// „Parsuj odpowiedź LLM” – draft z newsa
async function newsDraft(cfgChanges = {}, url = 'https://kawiarnia.example/sala') {
  const cfg = {
    ...CFG,
    topic: 'kawa',
    panelUrl: 'http://panel:7081',
    site: null,
    youtube: null,
    gemini: { textModel: 'gemini-3.8-flash' },
    brandName: 'Kawiarnia',
    instructions: '',
    ...cfgChanges,
  };
  const nodes = { Config: cfg, 'Przygotuj prompt LLM': { candidates: [{ title: 'Nowa sala', url, source: 'Kawiarnia' }] } };
  const ai = { selected_index: 0, news_title: 'Nowa sala', post_x: 'Nowa sala „Pod Lipą” – zapraszamy! #kawa', post_fb_insta: 'Post FB' };
  const fn = vm.runInNewContext(`(async function () {\n${code('parse_llm.js')}\n})`, {
    $: (name) => ({ first: () => ({ json: nodes[name] }) }),
    $input: { first: () => ({ json: { text: JSON.stringify(ai), provider: 'gemini', model: 'gemini-3.8-flash' } }) },
    $now: { toFormat: () => '20261107-1200' },
    $env: {},
    tr,
    console,
  });
  const [item] = await fn.call({ helpers: { httpRequest: async () => ({}) } });
  return plain(item.json);
}

// „Post własny: przygotuj” – własny post z panelu
function composeDraft(cfgChanges = {}, composeChanges = {}) {
  const compose = {
    text: 'Nowe ciasto',
    title: 'Nowe ciasto',
    link: 'https://kawiarnia.example/ciasto',
    platforms: ['x', 'facebook'],
    posts: { x: 'Nowe ciasto!\n\nhttps://kawiarnia.example/ciasto', facebook: 'Nowe ciasto dnia!\n\nhttps://kawiarnia.example/ciasto' },
    image: { source: 'none', upload: '' },
    publishNow: false,
    ai: '',
    ...composeChanges,
  };
  const cfg = { ...CFG, topic: 'kawa', enableTiktok: false, tiktok: { mode: 'inbox' }, compose, ...cfgChanges };
  const fn = vm.runInNewContext(`(function () {\n${code('compose.js')}\n})`, {
    $: () => ({ first: () => ({ json: cfg }) }),
    $now: { toFormat: () => '20261107-1200' },
    tr,
    Intl,
  });
  return plain(fn()[0].json);
}

// „Parsuj draft” – przed publikacją
async function parseDraft(draft, cfg = {}) {
  const nodes = { Config: node({ ...CFG, ...cfg }), 'Kontekst publikacji': node({ draftId: draft.draftId, unknown: '' }) };
  const fn = vm.runInNewContext(`(async function () {\n${code('parse_draft.js')}\n})`, { $: (n) => nodes[n], tr, Buffer });
  const [item] = await fn.call({ helpers: { getBinaryDataBuffer: async () => Buffer.from(JSON.stringify(draft)) } });
  return plain(item.json);
}

// „Podsumowanie publikacji” – outputs: wyniki węzłów publikujących (bez wpisu – niewykonane)
function summary(parsed, outputs = {}, cfg = {}) {
  const nodes = {
    Config: node({ ...CFG, ...cfg }),
    'Kontekst publikacji': node({ draftId: parsed.draftId, chatId: 7, messageId: 9, approvedBy: '@ania', via: 'telegram', unknown: '' }),
    'Parsuj draft': node(parsed),
  };
  for (const [name, json] of Object.entries(outputs)) nodes[name] = node(json);
  const [item] = vm.runInNewContext(`(function () {\n${code('summary.js')}\n})()`, { $: (n) => nodes[n] || node(null, false), tr, Buffer });
  const saved = JSON.parse(Buffer.from(item.binary.draft.data, 'base64').toString('utf8'));
  return plain({ ...item.json, saved, keyboard: item.json.markupBody.reply_markup.inline_keyboard, text: item.json.reportBody.text });
}

// odpowiedź Graph API bez uprawnienia, jak zapisuje ją węzeł HTTP n8n (onError: continueRegularOutput)
const NO_PERMISSION =
  '403 - "{\\"error\\":{\\"message\\":\\"(#200) The user hasn\'t authorized the application to perform this action\\",\\"type\\":\\"OAuthException\\",\\"code\\":200}}"';

const DRAFT = {
  draftId: 'd1',
  news: { title: 'Nowa sala', url: 'https://kawiarnia.example/sala' },
  post_x: 'Nowa sala – zapraszamy!',
  post_x_link: 'Nowa sala – zapraszamy!\n\nhttps://kawiarnia.example/sala',
  post_fb_insta: 'Post FB',
};

test('ustawienia bota: domyślnie X przez API i link w poście FB; walidacja, stary config, konfiguracja dla n8n', () => {
  const dir = tmpDir();
  const store = new Store(dir);
  const bot = store.addBot({ name: 'Kawiarnia' });
  assert.equal(bot.publishing.xMode, 'api');
  assert.equal(bot.publishing.fbLinkComment, false);
  store.updateBot(bot.id, { publishing: { x: true, xMode: 'link', facebook: true, fbLinkComment: true } });
  assert.deepEqual([store.bot(bot.id).publishing.xMode, store.bot(bot.id).publishing.fbLinkComment], ['link', true]);
  const cfg = new Runner(store, {}).runtimeConfig(store.bot(bot.id));
  assert.deepEqual([cfg.xMode, cfg.fbLinkComment], ['link', true]);
  store.updateBot(bot.id, { publishing: { xMode: 'przeglądarka' } });
  assert.equal(store.bot(bot.id).publishing.xMode, 'api', 'nieznany tryb – API');

  // config.json sprzed tej wersji – bez nowych pól
  const file = path.join(dir, 'config.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const b of raw.bots) {
    delete b.publishing.xMode;
    delete b.publishing.fbLinkComment;
  }
  fs.writeFileSync(file, JSON.stringify(raw));
  const old = new Store(dir).bot(bot.id);
  assert.deepEqual([old.publishing.xMode, old.publishing.fbLinkComment], ['api', false]);
});

test('X ręcznie: bez konta API bez ostrzeżenia, a odłączenie konta X nie wyłącza X', () => {
  const store = new Store(tmpDir());
  const bot = store.addBot({ name: 'Kawiarnia' });
  const noAccount = /X włączony, ale bez podłączonego konta/;
  store.updateBot(bot.id, { publishing: { x: true } });
  assert.ok(
    new Runner(store, {}).warnings(store.bot(bot.id)).some((w) => noAccount.test(w)),
    'API bez konta – ostrzeżenie',
  );
  store.updateBot(bot.id, { publishing: { xMode: 'link' } });
  assert.ok(!new Runner(store, {}).warnings(store.bot(bot.id)).some((w) => noAccount.test(w)), 'link – bez ostrzeżenia');

  const accounts = new Accounts(store, { publicUrl: 'http://localhost:7080' });
  accounts.disconnect(bot.id, 'x');
  assert.equal(store.bot(bot.id).publishing.x, true, 'tryb linku – X zostaje włączony');
  store.updateBot(bot.id, { publishing: { xMode: 'api' } });
  accounts.disconnect(bot.id, 'x');
  assert.equal(store.bot(bot.id).publishing.x, false, 'tryb API – bez konta X się wyłącza');
});

test('bramka: komentarz pod postem strony – tak; inne ścieżki i metody komentarzy – nie', () => {
  assert.equal(gatewayAllows('meta', 'POST', '/v24.0/1234567890_987654321/comments'), true);
  assert.equal(gatewayAllows('meta', 'POST', '/v24.0/1234567890/comments'), true);
  assert.equal(gatewayAllows('meta', 'GET', '/v24.0/1234567890_987654321/comments'), false);
  assert.equal(gatewayAllows('meta', 'POST', '/v24.0/me/comments'), false);
  assert.equal(gatewayAllows('meta', 'POST', '/v24.0/1234567890_987654321/comments/likes'), false);
});

test('draft z newsa, X ręcznie: przycisk „📝 Otwórz na X” z tekstem i linkiem, ✅ publikuje resztę', async () => {
  const d = await newsDraft({ xMode: 'link' });
  assert.equal(intentText(d.xIntent), 'Nowa sala „Pod Lipą” – zapraszamy! #kawa\n\nhttps://kawiarnia.example/sala');
  const [, last] = d.telegram.messages;
  assert.deepEqual(last.reply_markup.inline_keyboard, [
    [
      { text: '✅ Publikuj (FB)', callback_data: `pub:${d.draftId}` },
      { text: '❌ Odrzuć', callback_data: `rej:${d.draftId}` },
    ],
    [{ text: '📝 Otwórz na X', url: d.xIntent }],
  ]);
  assert.match(d.telegram.messages[0].text, /🐦 <b>X<\/b> · ręcznie – przycisk „📝 Otwórz na X”/);

  const api = await newsDraft();
  assert.equal(api.xIntent, undefined);
  assert.equal(api.telegram.messages[1].reply_markup.inline_keyboard.length, 1, 'tryb API – bez przycisku X');
  assert.match(api.telegram.messages[1].reply_markup.inline_keyboard[0][0].text, /✅ Publikuj \(X \+ FB\)/);
});

test('oficjalny link X: polskie znaki, nowe linie, &, #, + i ? wracają bez zmian; za długi tekst – bez przycisku', async () => {
  const text = 'Żółć & kawa #1 + ciasto? 50% taniej @Kawiarnia, sprawdź: https://kawiarnia.example/a?b=1&c=2#x\n\nkoniec';
  const p = await parseDraft({ ...DRAFT, post_x_link: text }, { xMode: 'link' });
  assert.equal(p.xManual, true);
  assert.equal(intentText(p.xIntent), text);
  assert.ok(!/%3A|%2F|%40|%2C/.test(p.xIntent), 'dwukropek, ukośnik, @ i przecinek bez kodowania (krótszy adres)');

  const long = await parseDraft({ ...DRAFT, post_x_link: '😀'.repeat(200) }, { xMode: 'link' });
  assert.equal(long.xManual, true);
  assert.equal(long.xIntent, undefined);
  const r = summary(long, { 'Facebook: opublikuj tekst/link': { id: '1_2' } }, { xMode: 'link' });
  assert.match(r.text, /🐦 X: 📝 ręcznie – skopiuj tekst z draftu do X/);
  assert.equal(r.keyboard.length, 1, 'bez przycisku X');
});

test('publikacja z X ręcznie: X bez API, raport „ręcznie”, status według pozostałych platform, przycisk X zostaje', async () => {
  const p = await parseDraft(DRAFT, { xMode: 'link' });
  assert.equal(p.todo.x, false, 'bez publikacji przez API');
  assert.equal(p.xManual, true);
  assert.equal(intentText(p.xIntent), DRAFT.post_x_link);

  const r = summary(p, { 'Facebook: opublikuj tekst/link': { id: '111_222' } }, { xMode: 'link' });
  assert.equal(r.status, 'published');
  assert.deepEqual(r.results.x, { manual: true, intent: p.xIntent, at: r.results.x.at });
  assert.match(r.text, /^✅ <b>Opublikowano<\/b>/);
  assert.match(r.text, /🐦 X: 📝 ręcznie – przycisk „📝 Otwórz na X” pod draftem/);
  assert.deepEqual(r.keyboard, [[{ text: '✅ Opublikowano', callback_data: 'noop' }], [{ text: '📝 Otwórz na X', url: p.xIntent }]]);
  assert.equal(r.saved.xManual, undefined, 'pola robocze nie trafiają do pliku draftu');
  assert.equal(r.saved.xIntent, p.xIntent, 'link X zostaje w drafcie (panel)');

  // Facebook się nie udał: 🔁 ponawia tylko Facebook, przycisk X pod spodem
  const failed = summary(
    p,
    { 'Facebook: opublikuj tekst/link': { error: { message: '400 - "Invalid OAuth access token"', status: 400 } } },
    { xMode: 'link' },
  );
  assert.equal(failed.status, 'failed');
  assert.deepEqual(
    failed.keyboard.map((row) => row.map((b) => b.callback_data || b.url)),
    [['pub:d1', 'rej:d1'], [p.xIntent]],
  );

  // bot tylko z X (ręcznie): nic do publikacji przez API
  const only = summary(await parseDraft(DRAFT, { xMode: 'link', enableFacebook: false }), {}, { xMode: 'link', enableFacebook: false });
  assert.equal(only.status, 'approved');
  assert.match(only.text, /^✅ <b>Zatwierdzono<\/b> · na X publikujesz ręcznie/);
});

test('Facebook, link w komentarzu: post bez linku, komentarz z adresem; błąd komentarza to ostrzeżenie, nie błąd posta', async () => {
  // sam Facebook (X wyłączony) – status zależy tylko od posta na stronie
  const FB = { fbLinkComment: true, enableX: false };
  const withLink = { ...DRAFT, post_fb_insta: 'Post FB\n\nhttps://kawiarnia.example/sala' };
  const p = await parseDraft(withLink, FB);
  assert.equal(p.fbMessage, 'Post FB', 'adres usunięty z tekstu posta');
  assert.equal(p.fbLink, '', 'bez karty linku w poście');
  assert.equal(p.fbComment, 'https://kawiarnia.example/sala');
  assert.equal(p.fbWithImage, false);

  const ok = summary(p, { 'Facebook: opublikuj tekst/link': { id: '111_222' }, 'Facebook: link w komentarzu': { id: '222_333' } }, FB);
  assert.equal(ok.status, 'published');
  assert.equal(ok.results.facebook.comment, '222_333');
  assert.match(ok.text, /📘 Facebook: ✅ <a href="https:\/\/www\.facebook\.com\/111_222">zobacz post<\/a> · 💬 link w komentarzu/);
  assert.equal(ok.saved.fbComment, undefined);

  const bad = summary(
    p,
    {
      'Facebook: opublikuj tekst/link': { id: '111_222' },
      // błąd Graph API w kształcie z n8n (brak uprawnienia pages_manage_engagement)
      'Facebook: link w komentarzu': { error: { message: NO_PERMISSION, status: 403 } },
    },
    FB,
  );
  assert.equal(bad.status, 'published', 'post jest na stronie');
  assert.equal(
    bad.results.facebook.warning,
    "link w komentarzu nie został dodany: 403 – (#200) The user hasn't authorized the application to perform this action – sprawdź panel: Konta → Facebook",
  );
  assert.match(bad.text, /📘 Facebook: ✅ .* ⚠️ link w komentarzu nie został dodany/);

  // tryb „link” ze zdjęciem (np. własna strona, kanał YouTube): przy linku w komentarzu Facebook dostaje zdjęcie
  const photo = await parseDraft({ ...DRAFT, image: { file: 'd1.jpg' }, linkMode: true }, { fbLinkComment: true });
  assert.equal(photo.fbWithImage, true);
  const plainLink = await parseDraft({ ...DRAFT, image: { file: 'd1.jpg' }, linkMode: true });
  assert.deepEqual([plainLink.fbWithImage, plainLink.fbLink, plainLink.fbComment], [false, DRAFT.news.url, '']);
  // bez linku (własny post bez adresu) – bez komentarza
  const noUrl = await parseDraft({ ...DRAFT, news: { title: 'x', url: '' } }, { fbLinkComment: true });
  assert.deepEqual([noUrl.fbComment, noUrl.fbMessage], ['', 'Post FB']);
});

test('własny post: X ręcznie i link w komentarzu – przycisk X, podgląd FB bez adresu, „Publikuj teraz” z samym X', () => {
  const d = composeDraft({ xMode: 'link', fbLinkComment: true });
  assert.equal(intentText(d.xIntent), 'Nowe ciasto!\n\nhttps://kawiarnia.example/ciasto');
  const [posts, last] = d.telegram.messages;
  assert.match(posts.text, /📘 <b>Facebook<\/b> · \d+ znaków · link w pierwszym komentarzu\n<pre>Nowe ciasto dnia!<\/pre>/);
  assert.deepEqual(
    last.reply_markup.inline_keyboard.map((row) => row.map((b) => b.text)),
    [['✅ Publikuj (FB)', '❌ Odrzuć'], ['📝 Otwórz na X']],
  );
  const now = composeDraft({ xMode: 'link' }, { platforms: ['x'], posts: { x: 'Tylko X' }, publishNow: true });
  assert.deepEqual(now.telegram.messages[1].reply_markup, { inline_keyboard: [[{ text: '📝 Otwórz na X', url: now.xIntent }]] });
  assert.ok(now.telegram.captionParts.some((l) => /na X publikujesz sam/.test(l)));
});

test('workflow: komentarz z linkiem po poście FB (zdjęcie albo tekst), potem dalej jak dotąd', () => {
  const next = (name, out = 0) => ((WORKFLOW.connections[name] || {}).main || [])[out]?.map((c) => c.node).sort() || [];
  const after = WORKFLOW.nodes.some((n) => n.name === 'Instagram włączony?') ? 'Instagram włączony?' : 'Podsumowanie publikacji';
  assert.deepEqual(next('Facebook: opublikuj post'), ['FB: link w komentarzu?']);
  assert.deepEqual(next('Facebook: opublikuj tekst/link'), ['FB: link w komentarzu?']);
  assert.deepEqual(next('FB: link w komentarzu?', 0), ['Facebook: link w komentarzu']);
  assert.deepEqual(next('FB: link w komentarzu?', 1), [after]);
  assert.deepEqual(next('Facebook: link w komentarzu'), [after]);
  const comment = WORKFLOW.nodes.find((n) => n.name === 'Facebook: link w komentarzu');
  assert.equal(comment.onError, 'continueRegularOutput', 'błąd komentarza nie przerywa publikacji');
  assert.match(comment.parameters.url, /\/\{\{ \$json\.post_id \|\| \$json\.id \}\}\/comments$/);
  for (const name of ['Facebook: opublikuj post', 'Facebook: opublikuj tekst/link']) {
    assert.match(JSON.stringify(WORKFLOW.nodes.find((n) => n.name === name).parameters), /fbMessage/, `${name}: tekst bez linku`);
  }
});

test('Telegram: przycisk „📝 Otwórz na X” zostaje pod draftem w trakcie publikacji i po błędzie, znika po odrzuceniu', async () => {
  const filesDir = tmpDir();
  const store = new Store(tmpDir());
  store.updateGlobal({ telegram: { chatId: '-100777' } });
  fs.writeFileSync(path.join(filesDir, 'd1.json'), JSON.stringify({ draftId: 'd1', status: 'draft' }));
  let fail = false;
  const telegram = new Telegram(store, {
    filesDir,
    onPublish: async () => {
      if (fail) throw new Error('n8n nie odpowiada');
    },
    onReject: async () => {},
  });
  const calls = [];
  telegram.call = async (method, params) => {
    calls.push({ method, params });
    return {};
  };
  const xRow = [{ text: '📝 Otwórz na X', url: 'https://x.com/intent/tweet?text=Hej' }];
  const click = async (data) => {
    const reply_markup = { inline_keyboard: [[{ text: '✅ Publikuj (FB)', callback_data: 'pub:d1' }], xRow] };
    await telegram.handle({
      callback_query: {
        id: 'q1',
        data,
        from: { id: 5, username: 'ania' },
        message: { message_id: 9, chat: { id: -100777 }, reply_markup },
      },
    });
    await telegram.settled();
  };
  const marks = () => calls.filter((c) => c.method === 'editMessageReplyMarkup').map((c) => c.params.reply_markup.inline_keyboard);
  await click('pub:d1');
  assert.deepEqual(marks().at(-1), [[{ text: '⏳ Publikuję…', callback_data: 'noop' }], xRow]);
  fail = true;
  await click('pub:d1');
  assert.deepEqual(marks().at(-1).slice(1), [xRow], 'po błędzie: „Spróbuj ponownie” i przycisk X');
  await click('rej:d1');
  assert.deepEqual(marks().at(-1), [[{ text: '❌ Odrzucono (@ania)', callback_data: 'noop' }]]);
});

// Atrapa Graph API Meta dla „Sprawdź i połącz”: routes – ścieżka bez wersji i zapytania → [kod, odpowiedź]
async function graphMock(routes) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    const p = req.url.replace(/^\/v[\d.]+\//, '').split('?')[0];
    seen.push(req.url);
    const [code, body] = routes[p] || [400, { error: { message: `nieznane: ${p}`, code: 100 } }];
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${srv.address().port}`, seen, close: () => srv.close() };
}
async function connect(routes, fbLinkComment = true) {
  const g = await graphMock(routes);
  const saved = UPSTREAM.meta;
  UPSTREAM.meta = g.base;
  try {
    const store = new Store(tmpDir());
    const bot = store.addBot({ name: 'Kawiarnia' });
    store.updateBot(bot.id, { publishing: { facebook: true, fbLinkComment } });
    const account = await new Accounts(store, { publicUrl: 'http://localhost:7080' }).connectMeta(bot.id, { token: 'TOKEN' });
    return { account, seen: g.seen, warnings: new Runner(store, {}).warnings(store.bot(bot.id)) };
  } finally {
    UPSTREAM.meta = saved;
    g.close();
  }
}
const PAGE = { id: '111', name: 'Kawiarnia' };
const perms = (...names) => [200, { data: names.map((permission) => ({ permission, status: 'granted' })) }];

test('Meta „Sprawdź i połącz”: uprawnienia tokenu i prawa na stronie – czego brakuje do linku w komentarzu', async () => {
  // token użytkownika systemowego bez pages_manage_engagement, strona przypisana tylko z prawem do treści
  const bad = await connect({
    'me/accounts': [200, { data: [{ ...PAGE, access_token: 'PAGE', tasks: ['CREATE_CONTENT', 'ANALYZE'] }] }],
    'me/permissions': perms('pages_show_list', 'pages_manage_posts', 'pages_read_engagement'),
    111: [200, PAGE],
  });
  assert.deepEqual(bad.account.scopes, ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement']);
  assert.deepEqual(bad.account.tasks, ['CREATE_CONTENT', 'ANALYZE']);
  const problems = metaCommentProblems(bad.account);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /nie ma uprawnień: pages_manage_engagement, pages_read_user_content/);
  assert.match(problems[1], /nie może moderować strony.*Aktywność społeczności/);
  assert.equal(bad.warnings.filter((w) => /^link w komentarzu na Facebooku nie zadziała: /.test(w)).length, 2, 'ostrzeżenia bota');

  // pages_manage_engagement bez pages_read_user_content (zależność uprawnień Meta) – komentarz kończy się błędem #200,
  // mimo pełnej kontroli strony
  const half = await connect({
    'me/accounts': [200, { data: [{ ...PAGE, access_token: 'PAGE', tasks: ['MANAGE'] }] }],
    'me/permissions': perms('pages_manage_posts', 'pages_read_engagement', 'pages_manage_engagement'),
    111: [200, PAGE],
  });
  assert.deepEqual(metaCommentProblems(half.account).length, 1);
  assert.match(metaCommentProblems(half.account)[0], /nie ma uprawnień: pages_read_user_content –/);

  // komplet: oba uprawnienia i moderowanie (albo pełna kontrola) – bez ostrzeżeń
  const ok = await connect({
    'me/accounts': [200, { data: [{ ...PAGE, access_token: 'PAGE', tasks: ['CREATE_CONTENT', 'MODERATE'] }] }],
    'me/permissions': perms('pages_manage_posts', 'pages_read_engagement', 'pages_manage_engagement', 'pages_read_user_content'),
    111: [200, PAGE],
  });
  assert.deepEqual(metaCommentProblems(ok.account), []);
  assert.ok(!ok.warnings.some((w) => /link w komentarzu/.test(w)));
  const full = await connect({
    'me/accounts': [200, { data: [{ ...PAGE, access_token: 'PAGE', tasks: ['MANAGE'] }] }],
    'me/permissions': perms('pages_manage_engagement', 'pages_read_user_content'),
    111: [200, PAGE],
  });
  assert.deepEqual(metaCommentProblems(full.account), []);
  // opcja wyłączona – brakujące uprawnienia nie są ostrzeżeniem bota
  const off = await connect(
    {
      'me/accounts': [200, { data: [{ ...PAGE, access_token: 'PAGE', tasks: ['CREATE_CONTENT'] }] }],
      'me/permissions': perms('pages_manage_posts'),
      111: [200, PAGE],
    },
    false,
  );
  assert.ok(!off.warnings.some((w) => /link w komentarzu/.test(w)));
});

test('Meta: token strony – uprawnienia z debug_token, prawa na stronie nieznane; błąd odczytu nie psuje łączenia', async () => {
  const page = await connect({
    'me/accounts': [400, { error: { message: '(#100) Tried accessing nonexisting field (accounts)', code: 100 } }],
    me: [200, PAGE],
    'me/permissions': [400, { error: { message: '(#100) nonexisting field', code: 100 } }],
    debug_token: [200, { data: { type: 'PAGE', scopes: ['pages_manage_posts', 'pages_manage_engagement', 'pages_read_user_content'] } }],
    111: [200, PAGE],
  });
  assert.equal(page.account.pageId, '111');
  assert.deepEqual(page.account.scopes, ['pages_manage_posts', 'pages_manage_engagement', 'pages_read_user_content']);
  assert.equal(page.account.tasks, null);
  assert.deepEqual(metaCommentProblems(page.account), [], 'prawa na stronie nieznane – bez zgadywania');
  assert.ok(page.seen.some((u) => /debug_token\?input_token=TOKEN/.test(u)));

  const unknown = await connect({
    'me/accounts': [400, { error: { message: 'x', code: 100 } }],
    me: [200, PAGE],
    111: [200, PAGE],
  });
  assert.equal(unknown.account.pageId, '111', 'łączenie działa bez odczytu uprawnień');
  assert.deepEqual([unknown.account.scopes, unknown.account.tasks], [null, null]);
  assert.deepEqual(metaCommentProblems(unknown.account), []);

  // konto połączone przed tą wersją (bez scopes) – prośba o ponowne zapisanie tokenu
  const old = metaCommentProblems({ pageId: '111', pageName: 'Kawiarnia', connectedAt: '2026-10-01T10:00:00Z' });
  assert.equal(old.length, 1);
  assert.match(old[0], /nie są jeszcze sprawdzone/);
});
