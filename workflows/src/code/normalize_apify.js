// Dokleja tweety z Apify (opcjonalne źródło X) do listy artykułów z RSS.
const base = $('Normalizuj RSS').first().json;
const articles = [...(base.articles || [])];
const feedErrors = [...(base.feedErrors || [])];

for (const item of $input.all()) {
  const t = item.json || {};
  if (t.error) {
    feedErrors.push({ feed: 'Apify', error: (t.error.message || JSON.stringify(t.error)).slice(0, 300) });
    continue;
  }
  const text = String(t.fullText || t.full_text || t.text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.noResults || !text) continue;

  const user = t.author?.userName || t.author?.screen_name || t.user?.screen_name || 'i';
  const rawUrl = String(t.url || t.twitterUrl || '');
  const fromUrl = rawUrl.match(/status(?:es)?\/(\d+)/);
  const statusId = String(t.id || t.id_str || (fromUrl && fromUrl[1]) || '').trim();
  if (!/^\d+$/.test(statusId)) continue;

  const date = new Date(t.createdAt || t.created_at || Date.now());
  const images = [];
  for (const m of [].concat((t.extendedEntities || t.extended_entities || {}).media || [], (t.entities || {}).media || [], t.media || [])) {
    const u = m && (m.media_url_https || m.media_url || (m.type === 'photo' && m.url));
    if (typeof u === 'string' && /^https?:\/\//.test(u) && !images.includes(u)) images.push(u);
  }
  articles.push({
    id: `x:${statusId}`,
    url: `https://x.com/${user}/status/${statusId}`,
    title: text.slice(0, 280),
    summary: text.slice(0, 600),
    source: `X @${user}`,
    sourceType: 'x',
    author: t.author?.name || user,
    images: images.slice(0, 4),
    publishedAt: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
  });
}

return [{ json: { articles, feedErrors } }];
