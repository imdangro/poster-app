// Czyta plik JSON draftu z dysku i ustala, które platformy trzeba jeszcze opublikować (przy ponownej próbie pomijamy
// platformy, które już się udały, i niepewne – bez odpowiedzi platformy – dopóki nie zdecydujesz w Telegramie).
const cfg = $('Config').first().json;
const ctx = $('Kontekst publikacji').first().json;
const buffer = await this.helpers.getBinaryDataBuffer(0, 'data'); // helpers udostępnia task runner n8n
const draft = JSON.parse(buffer.toString('utf8'));
const prev = draft.results || {};

// Draft bez grafiki (albo tryb „link”): X i Facebook publikują tekst z linkiem.
const hasImage = !!(draft.image && draft.image.file);
const linkMode = draft.linkMode === true || !hasImage;
const url = draft.news && /^https?:\/\//i.test(String(draft.news.url || '')) ? String(draft.news.url) : '';
// własny post: tylko platformy wybrane w edytorze (drafty z newsów – wszystkie włączone w bocie)
const chosen = (k) => !Array.isArray(draft.platforms) || draft.platforms.includes(k);
// Niepewny wynik (brak odpowiedzi platformy – post mógł się ukazać) czeka na decyzję w Telegramie: retry – wyślij
// ponownie, confirm – post jest na profilu (nic nie publikujemy, podsumowanie zapisze go jako udany).
const retryUnknown = ctx.unknown === 'retry';
const pending = (k) => ctx.unknown !== 'confirm' && !prev[k]?.ok && (!prev[k]?.unknown || retryUnknown);
// Draft z newsów ma teksty tylko dla platform włączonych w chwili jego powstania – platformę włączoną później
// pomijamy z powodem w raporcie, zamiast wysłać pusty post.
const textOf = {
  x: draft.post_x,
  facebook: draft.post_fb_insta,
};
const hasText = (k) => String(textOf[k] || '').trim() !== '';

const todo = {
  x: cfg.enableX && chosen('x') && hasText('x') && pending('x'),
  facebook: cfg.enableFacebook && chosen('facebook') && hasText('facebook') && pending('facebook'),
};
// platformy pominięte, bo wymagają grafiki
const skipped = {};
// platformy pominięte, bo draft nie ma dla nich tekstu (powstał, gdy były wyłączone)
const noText = {
  x: cfg.enableX && chosen('x') && !hasText('x'),
  facebook: cfg.enableFacebook && chosen('facebook') && !hasText('facebook'),
};

return [
  {
    json: {
      ...draft,
      todo,
      skipped,
      noText,
      hasImage,
      linkMode,
      // X: w trybie linku – tekst z adresem artykułu (X sam pokaże kartę z podglądem)
      xText: linkMode ? draft.post_x_link || draft.post_x : draft.post_x,
      xWithImage: hasImage && !linkMode,
      fbWithImage: hasImage && !linkMode,
      fbLink: url,
      alreadyPublished: draft.status === 'published',
      // komunikat dla węzła „Telegram: już opublikowany”
      alreadyPublishedText: tr('ℹ️ Draft {0} był już opublikowany – pomijam.', draft.draftId),
    },
  },
];
