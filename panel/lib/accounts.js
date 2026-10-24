'use strict';
// Konta platform przypisane do botów: logowanie OAuth, weryfikacja Meta, odświeżanie tokenów.
// Sekrety trzyma wyłącznie panel (secrets.json).
const crypto = require('crypto');
const { HttpError, fetchJson, form, withLock } = require('./util');
const { tr } = require('./i18n');

const UPSTREAM = {
  gemini: process.env.UPSTREAM_GEMINI || 'https://generativelanguage.googleapis.com',
  telegram: process.env.UPSTREAM_TELEGRAM || 'https://api.telegram.org',
  x: process.env.UPSTREAM_X || 'https://api.x.com',
  xAuthorize: process.env.UPSTREAM_X_AUTHORIZE || 'https://x.com/i/oauth2/authorize',
  meta: process.env.UPSTREAM_META || 'https://graph.facebook.com',
  apify: process.env.UPSTREAM_APIFY || 'https://api.apify.com',
};
const X_SCOPES = 'tweet.read tweet.write users.read media.write offline.access';

class Accounts {
  constructor(store, { publicUrl }) {
    this.store = store;
    this.publicUrl = publicUrl;
    this.pending = new Map(); // state → { botId, platform, verifier, redirectUri, createdAt }
  }

  xRedirectUri() {
    return this.store.global.x.redirectUri || `${this.publicUrl}/oauth/x/callback`;
  }

  // ------------------------------------------------------------------ OAuth: start
  start(botId, platform) {
    const bot = this.store.requireBot(botId);
    const g = this.store.global;
    const sg = this.store.secrets.global;
    for (const [k, v] of this.pending) if (Date.now() - v.createdAt > 30 * 60 * 1000) this.pending.delete(k);
    const state = crypto.randomBytes(16).toString('hex');

    if (platform === 'x') {
      if (!g.x.clientId) throw new HttpError(400, tr('Najpierw wpisz Client ID aplikacji X w Ustawieniach'));
      const verifier = crypto.randomBytes(32).toString('base64url');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      const redirectUri = this.xRedirectUri();
      this.pending.set(state, { botId: bot.id, platform, verifier, redirectUri, createdAt: Date.now() });
      const q = form({
        response_type: 'code',
        client_id: g.x.clientId,
        redirect_uri: redirectUri,
        scope: X_SCOPES,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
      return { url: `${UPSTREAM.xAuthorize}?${q}`, redirectUri, automatic: redirectUri.startsWith(this.publicUrl) };
    }

    throw new HttpError(400, tr('Nieznana platforma'));
  }

  // Adres po przekierowaniu (z paska przeglądarki) → code + state
  parseRedirect(url) {
    const s = String(url || '').trim();
    const get = (k) => {
      const m = s.match(new RegExp(`[?&#]${k}=([^&#]*)`));
      return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
    };
    const error = get('error_description') || get('error');
    if (!get('code'))
      throw new HttpError(
        400,
        error
          ? tr('Platforma zwróciła błąd: {0}', error)
          : tr('W adresie nie ma parametru code= – skopiuj cały adres z paska przeglądarki'),
      );
    return { code: get('code'), state: get('state') };
  }

  // ------------------------------------------------------------------ OAuth: zakończenie
  async complete({ code, state }) {
    const p = this.pending.get(state);
    if (!p) throw new HttpError(400, tr('Link logowania wygasł albo pochodzi z innej próby – kliknij „Połącz” jeszcze raz'));
    this.pending.delete(state);
    const bot = this.store.requireBot(p.botId);
    const g = this.store.global;
    const sg = this.store.secrets.global;
    const sb = this.store.botSecrets(bot.id);
    const now = Date.now();

    if (p.platform === 'x') {
      const headers = { 'content-type': 'application/x-www-form-urlencoded' };
      if (sg.xClientSecret) headers.authorization = 'Basic ' + Buffer.from(`${g.x.clientId}:${sg.xClientSecret}`).toString('base64');
      const r = await fetchJson(`${UPSTREAM.x}/2/oauth2/token`, {
        method: 'POST',
        headers,
        body: form({
          code,
          grant_type: 'authorization_code',
          redirect_uri: p.redirectUri,
          code_verifier: p.verifier,
          client_id: g.x.clientId,
        }),
      });
      if (!r.data || !r.data.access_token) throw new HttpError(400, tr('X odrzucił logowanie: {0}', apiError(r)));
      sb.x = {
        accessToken: r.data.access_token,
        refreshToken: r.data.refresh_token || '',
        expiresAt: now + (Number(r.data.expires_in) || 7200) * 1000,
      };
      const me = await fetchJson(`${UPSTREAM.x}/2/users/me`, { headers: { authorization: `Bearer ${sb.x.accessToken}` } });
      const user = (me.data && me.data.data) || {};
      bot.accounts.x = {
        userId: user.id || '',
        username: user.username || '',
        name: user.name || '',
        scope: r.data.scope || X_SCOPES,
        connectedAt: new Date().toISOString(),
      };
      if (!sb.x.refreshToken) bot.accounts.x.warning = tr('Brak refresh tokenu (zakres offline.access) – połączenie wygaśnie po 2 h');
    }
    this.store.saveSecrets();
    this.store.saveConfig();
    return { bot, platform: p.platform };
  }

  // ------------------------------------------------------------------ Meta: strona na Facebooku
  async connectMeta(botId, { pageId, token }) {
    const bot = this.store.requireBot(botId);
    const v = this.store.global.meta.graphVersion;
    pageId = String(pageId || '').trim();
    token = String(token || '').trim();
    if (!token) throw new HttpError(400, tr('Wklej token dostępu (Page Access Token albo User Access Token)'));
    const graph = (p, t) => fetchJson(`${UPSTREAM.meta}/${v}/${p}`, { headers: { authorization: `Bearer ${t}` } });

    let pageToken = token;
    // Token użytkownika → lista stron, którymi zarządza (każda ma własny token strony)
    const acc = await graph('me/accounts?fields=id,name,access_token&limit=100', token);
    if (acc.ok && acc.data && Array.isArray(acc.data.data)) {
      const pages = acc.data.data;
      if (!pages.length) throw new HttpError(400, tr('Ten token nie ma dostępu do żadnej strony Facebook (uprawnienie pages_show_list)'));
      const page = pageId ? pages.find((pg) => pg.id === pageId) : pages.length === 1 ? pages[0] : null;
      if (!page) {
        throw new HttpError(409, pageId ? tr('Token nie ma dostępu do strony o tym ID') : tr('Wybierz stronę'), {
          pages: pages.map((pg) => ({ id: pg.id, name: pg.name })),
        });
      }
      pageId = page.id;
      pageToken = page.access_token;
    } else {
      // Token strony: /me zwraca samą stronę
      const me = await graph('me?fields=id,name', token);
      if (!me.ok || !me.data || !me.data.id) throw new HttpError(400, tr('Meta odrzuciła token: {0}', apiError(me)));
      if (pageId && pageId !== me.data.id)
        throw new HttpError(400, tr('To token strony „{0}” (ID {1}), a nie strony {2}', me.data.name, me.data.id, pageId));
      pageId = me.data.id;
    }
    const page = await graph(`${pageId}?fields=id,name`, pageToken);
    if (!page.ok || !page.data) throw new HttpError(400, tr('Nie mogę odczytać strony: {0}', apiError(page)));
    this.store.botSecrets(bot.id).meta = { pageToken };
    bot.accounts.meta = {
      pageId,
      pageName: page.data.name || '',
      connectedAt: new Date().toISOString(),
    };
    this.store.saveSecrets();
    this.store.saveConfig();
    return bot.accounts.meta;
  }

  disconnect(botId, platform) {
    const bot = this.store.requireBot(botId);
    const known = ['x', 'meta'];
    if (!known.includes(platform)) throw new HttpError(400, tr('Nieznana platforma'));
    bot.accounts[platform] = null;
    delete this.store.botSecrets(bot.id)[platform];
    if (platform === 'x') bot.publishing.x = false;
    if (platform === 'meta') bot.publishing.facebook = false;
    this.store.saveSecrets();
    this.store.saveConfig();
  }

  // ------------------------------------------------------------------ tokeny dla bramki API
  async xToken(bot, force = false) {
    const sb = this.store.botSecrets(bot.id);
    if (!sb.x || !sb.x.accessToken) throw new HttpError(401, tr('Bot „{0}” nie ma podłączonego konta X – panel → bot → Konta', bot.name));
    if (!force && sb.x.expiresAt > Date.now() + 120000) return sb.x.accessToken;
    return withLock(`x:${bot.id}`, async () => {
      const cur = this.store.botSecrets(bot.id).x;
      if (!force && cur.expiresAt > Date.now() + 120000) return cur.accessToken;
      if (!cur.refreshToken) throw new HttpError(401, tr('Token X bota „{0}” wygasł – połącz konto ponownie', bot.name));
      const g = this.store.global;
      const secret = this.store.secrets.global.xClientSecret;
      const headers = { 'content-type': 'application/x-www-form-urlencoded' };
      if (secret) headers.authorization = 'Basic ' + Buffer.from(`${g.x.clientId}:${secret}`).toString('base64');
      const r = await fetchJson(`${UPSTREAM.x}/2/oauth2/token`, {
        method: 'POST',
        headers,
        body: form({ grant_type: 'refresh_token', refresh_token: cur.refreshToken, client_id: g.x.clientId }),
      });
      if (!r.data || !r.data.access_token) {
        throw new HttpError(401, tr('X odrzucił odświeżenie tokenu bota „{0}” ({1}) – połącz konto ponownie', bot.name, apiError(r)));
      }
      Object.assign(cur, {
        accessToken: r.data.access_token,
        refreshToken: r.data.refresh_token || cur.refreshToken, // X rotuje refresh token – zapisujemy od razu
        expiresAt: Date.now() + (Number(r.data.expires_in) || 7200) * 1000,
        refreshedAt: new Date().toISOString(),
      });
      this.store.saveSecrets();
      return cur.accessToken;
    });
  }
}

function apiError(r) {
  const d = r && r.data;
  if (d) {
    const e = d.error;
    const msg =
      (e && typeof e === 'object' && (e.message || e.code)) ||
      (typeof e === 'string' && (d.error_description ? `${e}: ${d.error_description}` : e)) ||
      d.error_description ||
      d.detail ||
      d.title ||
      d.description ||
      (Array.isArray(d.errors) && d.errors[0] && (d.errors[0].message || d.errors[0].detail));
    if (msg) return `${msg} (HTTP ${r.status})`;
  }
  return r ? `HTTP ${r.status}${r.text ? ` – ${r.text.slice(0, 160)}` : ''}` : tr('brak odpowiedzi');
}

module.exports = { Accounts, UPSTREAM, apiError };
