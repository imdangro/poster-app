'use strict';
// Bramka API dla n8n: http://panel:7081/gw/<bot>/<usługa>/<ścieżka>
// n8n wysyła zapytania bez kluczy, a panel dokleja uwierzytelnienie właściwe dla bota
// (token bota Telegram, token konta X albo strony FB itd.) i przekazuje je dalej.
// Dzięki temu sekrety nie trafiają do historii wykonań n8n, a każdy bot może mieć własne konta.
const { Readable } = require('stream');
const { HttpError, readBody, sendJson } = require('./util');
const { UPSTREAM } = require('./accounts');
const { tr } = require('./i18n');

const SERVICES = ['telegram', 'x', 'meta', 'apify'];
const DROP_REQUEST = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'keep-alive',
  'expect',
  'upgrade',
  'x-poster-token',
  'authorization',
  'accept-encoding',
  'x-goog-api-key',
  'cookie',
]);
const DROP_RESPONSE = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'set-cookie',
  'alt-svc',
]);

class Gateway {
  constructor(store, accounts) {
    this.store = store;
    this.accounts = accounts;
    this.stats = {}; // usługa → { calls, errors, lastError, lastAt }
  }

  async auth(service, bot, force) {
    const sg = this.store.secrets.global;
    switch (service) {
      case 'telegram':
        if (!sg.telegramBotToken) throw new HttpError(401, tr('Brak tokenu bota Telegram – panel → Ustawienia'));
        return { base: `${UPSTREAM.telegram}/bot${sg.telegramBotToken}`, headers: {} };
      case 'apify':
        if (!sg.apifyToken) throw new HttpError(401, tr('Brak tokenu Apify – panel → Ustawienia'));
        return { base: UPSTREAM.apify, headers: { authorization: `Bearer ${sg.apifyToken}` } };
      case 'x':
        return { base: UPSTREAM.x, headers: { authorization: `Bearer ${await this.accounts.xToken(bot, force)}` } };
      case 'meta': {
        const s = this.store.botSecrets(bot.id).meta;
        if (!s || !s.pageToken)
          throw new HttpError(401, tr('Bot „{0}” nie ma podłączonej strony Facebook – panel → bot → Konta', bot.name));
        return { base: UPSTREAM.meta, headers: { authorization: `Bearer ${s.pageToken}` } };
      }
      default:
        throw new HttpError(404, tr('Nieznana usługa {0}', service));
    }
  }

  // req.url = /gw/<bot>/<service>/<rest>?<query>
  async handle(req, res) {
    const m = req.url.match(/^\/gw\/([^/]+)\/([^/?]+)(\/[^?]*)?(\?.*)?$/);
    if (!m) throw new HttpError(404, tr('Niepoprawny adres bramki'));
    const [, botId, service, rest = '', query = ''] = m;
    if (!SERVICES.includes(service)) throw new HttpError(404, tr('Nieznana usługa {0}', service));
    const bot = botId === '_' ? null : this.store.bot(botId);
    if (botId !== '_' && !bot) throw new HttpError(404, tr('Bot {0} nie istnieje (usunięty w panelu?)', botId));
    if (!bot && ['x', 'meta'].includes(service)) throw new HttpError(400, tr('Konto platformy wymaga ID bota'));

    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req, 100 * 1024 * 1024);
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!DROP_REQUEST.has(k)) headers[k] = v;

    const st = (this.stats[service] = this.stats[service] || { calls: 0, errors: 0 });
    st.calls++;
    st.lastAt = new Date().toISOString();

    let auth = await this.auth(service, bot, false);
    let upstream = await this.forward(req.method, auth, rest + query, headers, body);
    // Wygasły token OAuth → jednorazowe wymuszone odświeżenie i ponowienie
    const oauth = service === 'x';
    if (upstream.status === 401 && oauth) {
      await upstream.body?.cancel().catch(() => {});
      auth = await this.auth(service, bot, true);
      upstream = await this.forward(req.method, auth, rest + query, headers, body);
    }
    if (upstream.status >= 400) {
      st.errors++;
      st.lastError = `HTTP ${upstream.status} ${req.method} ${rest.slice(0, 80)}`;
    }

    const out = {};
    upstream.headers.forEach((v, k) => {
      if (!DROP_RESPONSE.has(k)) out[k] = v;
    });
    res.writeHead(upstream.status, out);
    if (!upstream.body || req.method === 'HEAD') return res.end();
    await new Promise((resolve, reject) => {
      const stream = Readable.fromWeb(upstream.body);
      stream.on('error', reject);
      res.on('close', resolve);
      stream.pipe(res);
    });
  }

  // Przekierowania obsługujemy sami: uwierzytelnienie dokładamy tylko w obrębie tej samej domeny.
  async forward(method, auth, pathAndQuery, headers, body) {
    let url = auth.base + pathAndQuery;
    const origin = new URL(auth.base).origin;
    for (let hop = 0; hop < 5; hop++) {
      const sameOrigin = new URL(url).origin === origin;
      let res;
      try {
        res = await fetch(url, {
          method,
          headers: sameOrigin ? { ...headers, ...auth.headers } : headers,
          body,
          redirect: 'manual',
          signal: AbortSignal.timeout(15 * 60 * 1000),
        });
      } catch (e) {
        throw new HttpError(502, tr('Panel nie może połączyć się z {0}: {1}', new URL(url).host, e.cause?.code || e.message));
      }
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc && ['GET', 'HEAD'].includes(method)) {
        await res.body?.cancel().catch(() => {});
        url = new URL(loc, url).toString();
        continue;
      }
      return res;
    }
    throw new HttpError(502, tr('Zbyt wiele przekierowań'));
  }
}

// Błędy bramki w formacie, który węzeł HTTP Request n8n pokaże w opisie błędu.
function gatewayError(res, e) {
  if (res.headersSent) return res.destroy();
  sendJson(res, e.status || 502, { error: { message: e.message, source: 'poster-panel' } });
}

module.exports = { Gateway, gatewayError };
