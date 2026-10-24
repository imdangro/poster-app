// Zostawia tylko świeże wpisy (maks. wiek z panelu) i usuwa duplikaty w obrębie tego przebiegu
// (ten sam link lub ten sam tytuł z kilku źródeł). Następny węzeł pyta panel, które z nich bot
// już widział w poprzednich uruchomieniach (pamięć duplikatów – osobna dla każdego bota).
const cfg = $('Config').first().json;
const { articles = [], feedErrors = [] } = $input.first().json;

if (feedErrors.length) console.log('⚠️ Błędy źródeł:', JSON.stringify(feedErrors));

const cutoff = Date.now() - cfg.maxAgeHours * 3600 * 1000;
const normTitle = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .slice(0, 120);
const seenIds = new Set();
const seenTitles = new Set();

const fresh = articles
  .filter((a) => new Date(a.publishedAt).getTime() >= cutoff)
  .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
  .filter((a) => {
    const t = normTitle(a.title);
    if (seenIds.has(a.id) || (t && seenTitles.has(t))) return false;
    seenIds.add(a.id);
    if (t) seenTitles.add(t);
    return true;
  })
  .slice(0, 200);

// data najnowszego wpisu w kanałach (także starszego niż limit) – do komunikatu „brak nowego artykułu”
const newestAt = articles.reduce((m, a) => (a.publishedAt > m ? a.publishedAt : m), '') || null;

console.log(`Źródła: ${articles.length} wpisów, świeżych i unikalnych: ${fresh.length}`);
return [{ json: { runId: cfg.runId, total: articles.length, articles: fresh, feedErrors, newestAt } }];
