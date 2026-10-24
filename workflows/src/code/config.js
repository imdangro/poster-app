// ⚙️ CONFIG – ustawienia bota przychodzą z panelu (http://NAS:7080) razem ze zleceniem:
//   kind = "generate" (harmonogram / „Uruchom teraz”), "publish" (kliknięcie ✅ w Telegramie)
//   albo "compose" (własny post z panelu – ✍️ Nowy post: teksty na platformy są już gotowe).
// Sekrety (klucze API, tokeny kont platform) zostają w panelu – wszystkie zapytania do API
// idą przez bramkę panelu (config.gateway), która dokleja klucze właściwe dla danego bota.
const body = $('Start: zlecenie z panelu').first().json.body || {};
const c = body.config || {};
const str = (v, def = '') => (v === undefined || v === null ? '' : String(v)).trim() || def;
const int = (v, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
};
const bool = (v) => v === true || v === 'true';

if (!/^[a-z0-9]{3,20}$/.test(str(c.botId))) throw new Error(tr('Zlecenie z panelu nie zawiera konfiguracji bota'));
const mode = ['publish', 'compose'].includes(body.kind) ? body.kind : 'generate';
const panelUrl = str($env.POSTER_PANEL_URL, str(c.panelUrl, 'http://panel:7081')).replace(/\/+$/, '');

const feeds = (Array.isArray(c.feeds) ? c.feeds : [])
  .filter((f) => f && /^https?:\/\//i.test(String(f.url || '')))
  .map((f) => ({ url: String(f.url), label: str(f.label, String(f.url)), kind: f.kind === 'x' ? 'x' : 'rss' }));
const xSource = ['rsshub', 'apify', 'none'].includes(c.xSource) ? c.xSource : 'rsshub';
const g = c.gemini || {};
const meta = c.meta || {};

let publish = null;
if (mode === 'publish') {
  const draftId = str(body.draftId);
  // ID trafia do ścieżki pliku – tylko bezpieczne znaki
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(draftId)) throw new Error(tr('Niepoprawne ID draftu: {0}', draftId.slice(0, 50)));
  publish = { draftId, chatId: body.chatId, messageId: body.messageId || null, approvedBy: str(body.approvedBy, 'Telegram') };
}
// Własny post: teksty na wybrane platformy (AI dopasowało je w panelu albo to tekst autora) i grafika z panelu
let compose = null;
if (mode === 'compose') {
  const cc = body.compose || {};
  const im = cc.image || {};
  const all = ['x', 'facebook'];
  const platforms = all.filter((k) => Array.isArray(cc.platforms) && cc.platforms.includes(k));
  if (!platforms.length) throw new Error(tr('Własny post bez platform – wybierz je w panelu'));
  compose = {
    text: str(cc.text).slice(0, 5000),
    title: str(cc.title, tr('Własny post')).slice(0, 200),
    link: /^https?:\/\/\S+$/i.test(str(cc.link)) ? str(cc.link).slice(0, 1000) : '',
    platforms,
    posts: Object.fromEntries(platforms.map((k) => [k, str((cc.posts || {})[k])])),
    // upload = zdjęcie wgrane w panelu (panel odda je węzłowi „Grafika: panel”), none = bez grafiki
    image: {
      source: ['upload', 'none'].includes(im.source) ? im.source : 'none',
      upload: /^[a-z0-9]{6,40}$/.test(str(im.upload)) ? str(im.upload) : '',
    },
    publishNow: cc.publishNow === true,
    ai: str(cc.ai).slice(0, 120),
  };
}
if (!str((c.telegram || {}).chatId)) throw new Error(tr('Brak ID czatu Telegram – uzupełnij w panelu (Ustawienia → Telegram)'));
const needFeeds = mode === 'generate';
if (needFeeds && !feeds.length && !(xSource === 'apify' && (c.xHandles || []).length)) {
  throw new Error(tr('Bot nie ma źródeł newsów – dodaj kanały RSS lub profile X w panelu'));
}

return [
  {
    json: {
      mode,
      runId: str(body.runId),
      trigger: str(body.trigger, 'manual'),
      botId: c.botId,
      botName: str(c.botName, 'Poster'),
      // język wiadomości w Telegramie i raportów (tr() w węzłach Code; prompty AI zostają po polsku)
      lang: c.lang === 'en' ? 'en' : 'pl',
      topic: str(c.topic, str(c.botName, 'newsy')),
      brandName: str(c.brandName, str(c.botName, 'Poster')),
      language: str(c.language, 'polski'),
      instructions: str(c.instructions),
      maxAgeHours: int(c.maxAgeHours, 12),
      maxCandidates: int(c.maxCandidates, 25),
      feeds,
      xSource,
      xHandles: (Array.isArray(c.xHandles) ? c.xHandles : []).map((h) => String(h).replace(/^@/, '')).filter(Boolean),
      apify: { actorId: str((c.apify || {}).actorId, 'apidojo~tweet-scraper'), maxItems: int((c.apify || {}).maxItems, 40) },
      gemini: { textModel: str(g.textModel, 'gemini-3.8-flash') },
      // publikacja od razu po zapisaniu draftu: własny post z „Publikuj teraz” w panelu
      autoPublish: !!compose && compose.publishNow,
      compose,
      enableX: bool(c.enableX),
      enableFacebook: bool(c.enableFacebook),
      meta: { graphVersion: str(meta.graphVersion, 'v24.0'), pageId: str(meta.pageId) },
      telegram: { chatId: str(c.telegram.chatId) },
      // grafika: source (zdjęcie ze źródła) | link (post z linkiem) | none
      image: { mode: ['source', 'link', 'none'].includes((c.image || {}).mode) ? c.image.mode : 'source' },
      publish,
      panelUrl,
      gateway: `${panelUrl}/gw/${c.botId}`,
      storageDir: str($env.POSTER_STORAGE_DIR, '/home/node/.n8n-files').replace(/\/+$/, ''),
    },
  },
];
