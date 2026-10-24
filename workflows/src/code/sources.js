// Jeden element = jeden kanał RSS (portale newsowe + profile X zamienione na RSS przez RSSHub).
const feeds = $('Config').first().json.feeds || [];
// Bez kanałów (np. tylko Apify) przepuszczamy pusty element – RSS Read zwróci błąd, który pomijamy.
if (!feeds.length) return [{ json: { url: '', label: '', kind: 'none' } }];
return feeds.map((feed) => ({ json: feed }));
