// Grafika z panelu (zdjęcie ze źródła albo brak) → plik binarny n8n + plik JSON draftu.
// Bez grafiki draft też powstaje: X i Facebook dostają wtedy post z linkiem.
// Własny post (✍️ Nowy post): zdjęcie wgrane w panelu; bez grafiki – post z linkiem albo sam tekst.
const cfg = $('Config').first().json;
const compose = cfg.mode === 'compose';
const draft = compose ? $('Post własny: przygotuj').first().json : $('Parsuj odpowiedź LLM').first().json;
const res = $input.first().json || {};

const warnings = [...(Array.isArray(res.warnings) ? res.warnings : [])];
if (res.error) warnings.push(tr('grafika: {0}', typeof res.error === 'string' ? res.error : res.error.message || tr('błąd panelu')));

const b64 = typeof res.data === 'string' && res.data ? res.data : null;
const mime = res.mimeType || 'image/png';
const ext = /jpe?g/i.test(mime) ? 'jpg' : 'png';
const hasImage = !!b64;
const host = (u) => {
  const m = String(u || '').match(/^https?:\/\/([^/?#]+)/i);
  return m ? m[1].replace(/^www\./, '') : '';
};

const image = hasImage
  ? {
      file: `${draft.draftId}.${ext}`,
      mimeType: mime,
      sizeBytes: Math.floor((b64.length * 3) / 4),
      source: res.source,
      ...(res.width ? { width: res.width, height: res.height } : {}),
      ...(res.url ? { url: res.url } : {}),
    }
  : null;
// „link” = X i FB publikują tekst z linkiem (podgląd artykułu robi platforma); własny post – tylko bez grafiki
const linkMode = (!compose && cfg.image.mode === 'link') || !hasImage;
// własny post bez grafiki i bez linku: X i Facebook dostają sam tekst
const textOnly = compose && !draft.news.url;

// --- Telegram: nagłówek z informacją, skąd jest grafika ------------------------------------------
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
const noImage = textOnly ? tr('🚫 Bez grafiki – X i Facebook: sam tekst') : tr('🚫 Bez grafiki – X i Facebook: post z linkiem');
const imageLine = !hasImage
  ? noImage
  : res.source === 'upload'
    ? tr('📷 Twoje zdjęcie')
    : tr('📷 Zdjęcie ze źródła: {0} (sprawdź prawa do publikacji)', esc(host(res.url)));
const parts = [...draft.telegram.captionParts];
// news: po linku do źródła; własny post: przed ostatnią linią (akceptacja / „publikuję teraz”)
const at = compose ? parts.length - 1 : Math.min(3, parts.length);
parts.splice(at, 0, imageLine + (!compose && cfg.image.mode === 'link' && hasImage ? tr(' · X/FB: post z linkiem') : ''));
if (warnings.length) parts.push(`⚠️ ${esc(warnings.join(' · ').slice(0, 400))}`);
// podpis zdjęcia w Telegramie: maks. 1024 znaki – najpierw odpadają uzasadnienie i ostrzeżenia (bez cięcia tagów HTML)
for (const drop of ['⚠️', '💡', '🔗']) {
  if (parts.join('\n').length <= 1024) break;
  const i = parts.findIndex((l) => l.startsWith(drop));
  if (i >= 0) parts.splice(i, 1);
}
const caption = parts.join('\n');

const [posts, script] = draft.telegram.messages;
const telegram = { caption, messages: [{ text: linkMode ? posts.textLink : posts.text }, script] };

const { telegram: _t, ...clean } = draft;
const finalDraft = { ...clean, image, imageMode: compose ? draft.composeImage.source : cfg.image.mode, linkMode, warnings };

const binary = {
  draft: {
    data: Buffer.from(JSON.stringify(finalDraft, null, 2), 'utf8').toString('base64'),
    mimeType: 'application/json',
    fileName: `${draft.draftId}.json`,
    fileExtension: 'json',
  },
};
if (hasImage) binary.data = { data: b64, mimeType: mime, fileName: image.file, fileExtension: ext };

return [{ json: { ...finalDraft, hasImage, telegram }, binary }];
