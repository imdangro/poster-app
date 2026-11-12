'use strict';
// Telegram: odbieranie kliknięć ✅/❌ (long-polling getUpdates – NAS nie musi być wystawiony do internetu),
// wykrywanie ID czatów (/start), komenda /post (post z Telegrama, PRO), zdjęcie w odpowiedzi na draft (podmiana grafiki
// – lib/draftphoto.js) oraz wysyłanie powiadomień z panelu.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sleep, HttpError, noAnswer, readLimited, productUrl } = require('./util');
const { UPSTREAM } = require('./accounts');
const { tr, lang } = require('./i18n');

// /post albo /post@nazwa_bota na początku wiadomości albo podpisu zdjęcia
const POST_COMMAND = /^\/post(?:@[A-Za-z0-9_]+)?(?=\s|$)/i;
// tyle wiadomości draftów (czat + wiadomość → draft) pamiętamy dla zdjęć w odpowiedzi na draft (ok. 300 draftów)
const DRAFT_MESSAGES_MAX = 900;

// Plik w parametrach wywołania (np. zdjęcie): { data: Buffer, filename, contentType }
const isFile = (v) => !!v && typeof v === 'object' && Buffer.isBuffer(v.data);
// multipart/form-data składany ręcznie: FormData z fetch zamienia \n w polach tekstowych na \r\n (podpis zdjęcia
// rósłby o jeden znak na każdą linię)
function multipart(params) {
  const boundary = `----poster${crypto.randomBytes(12).toString('hex')}`;
  const parts = [];
  for (const [name, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (isFile(v)) {
      const head = `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${v.filename}"\r\nContent-Type: ${v.contentType}\r\n\r\n`;
      parts.push(Buffer.from(head), v.data, Buffer.from('\r\n'));
    } else {
      const text = typeof v === 'object' ? JSON.stringify(v) : String(v);
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${text}\r\n`));
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

// Stan połączenia: kod stanu, a tekst liczony przy odczycie – zawsze w bieżącym języku panelu
const STATUS_TEXT = {
  idle: () => tr('nie uruchomiono'),
  noToken: () => tr('brak tokenu bota'),
  ok: () => tr('działa'),
  conflict: () => tr('inny program odbiera wiadomości tego bota (np. stary workflow n8n z odpytywaniem co minutę – zaimportuj nowy)'),
};

class Telegram {
  // isPublishing(draftId) – czy publikacja tego draftu już trwa (server.js → runner.publishing)
  constructor(store, { filesDir, onPublish, onReject, isPublishing = null }) {
    this.store = store;
    this.filesDir = filesDir;
    this.onPublish = onPublish;
    this.onReject = onReject;
    this.isPublishing = isPublishing;
    this.running = false;
    this.tasks = new Set(); // publikacje rozpoczęte kliknięciem ✅ (w tle – zamykanie panelu na nie czeka)
    this.current = null; // obsługiwana właśnie aktualizacja
    this.conn = { ok: false, code: 'idle', error: '', username: '' };
    this.abort = null;
    this.tokenSeen = null;
    this.photo = null; // zdjęcie w odpowiedzi na draft (lib/draftphoto.js) – ustawia server.js
  }

  get status() {
    const c = this.conn;
    return { ok: c.ok, message: c.code === 'error' ? c.error : STATUS_TEXT[c.code](), username: c.username };
  }

  setStatus(ok, code, { error = '', username = this.conn.username } = {}) {
    this.conn = { ok, code, error, username };
  }

  get token() {
    return this.store.secrets.global.telegramBotToken || '';
  }

  // params: obiekt wysyłany jako JSON, a z plikiem ({ data: Buffer, filename, contentType }) – jako multipart
  async call(method, params = {}, { token = this.token, timeout = 20000, signal } = {}) {
    if (!token) throw new HttpError(400, tr('Brak tokenu bota Telegram'));
    const form = Object.values(params).some(isFile) ? multipart(params) : null;
    let res;
    try {
      res = await fetch(`${UPSTREAM.telegram}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': form ? form.type : 'application/json' },
        body: form ? form.body : JSON.stringify(params),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
      });
    } catch (e) {
      if (e.name === 'AbortError' && signal && signal.aborted) throw e;
      const reason = e.name === 'TimeoutError' ? tr('przekroczono czas') : e.cause?.code || e.message;
      if (!noAnswer(e)) throw new HttpError(502, tr('Brak połączenia z Telegramem: {0}', reason));
      // wiadomość mogła dotrzeć (np. post na kanale) – publikacja pokaże „nie wiadomo” zamiast błędu
      const err = new HttpError(502, tr('Brak odpowiedzi od Telegrama: {0}', reason));
      err.noAnswer = true;
      throw err;
    }
    const data = await res.json().catch(() => null);
    if (!data || data.ok !== true) {
      const err = new HttpError(
        res.status === 401 || res.status === 404 ? 400 : 502,
        `Telegram: ${(data && data.description) || `HTTP ${res.status}`}`,
      );
      if (res.status === 504) err.noAnswer = true;
      err.code = data && data.error_code;
      err.description = (data && data.description) || '';
      err.retryAfter = (data && data.parameters && data.parameters.retry_after) || 0; // 429: za ile sekund ponowić
      err.migrateTo = (data && data.parameters && data.parameters.migrate_to_chat_id) || 0; // grupa → supergrupa (nowe ID)
      throw err;
    }
    return data.result;
  }

  // Plik z Telegrama (getFile → /file/bot<token>/…), najwyżej maxBytes bajtów – null, gdy plik jest większy.
  // Adres pliku zawiera token bota – nie trafia do logów ani komunikatów.
  async downloadFile(fileId, maxBytes) {
    const f = await this.call('getFile', { file_id: fileId });
    const p = String((f && f.file_path) || '');
    if (!/^[\w./-]+$/.test(p) || p.includes('..')) throw new HttpError(502, tr('Telegram nie podał pliku zdjęcia'));
    let res;
    try {
      res = await fetch(`${UPSTREAM.telegram}/file/bot${this.token}/${p}`, { signal: AbortSignal.timeout(30000) });
    } catch (e) {
      throw new HttpError(
        502,
        tr('Nie udało się pobrać zdjęcia z Telegrama: {0}', e.name === 'TimeoutError' ? tr('przekroczono czas') : e.cause?.code || e.name),
      );
    }
    if (!res.ok) {
      if (res.body) res.body.cancel().catch(() => {});
      throw new HttpError(502, tr('Nie udało się pobrać zdjęcia z Telegrama (HTTP {0})', res.status));
    }
    return readLimited(res, maxBytes);
  }

  // Wiadomości draftu w czacie (nagłówek, teksty, przyciski – zdarzenie „draft” z n8n): odpowiedź zdjęciem na
  // dowolną z nich podmienia grafikę draftu. Najstarsze wpisy wypadają.
  rememberDraft(chatId, messageIds, draftId) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(String(draftId || '')) || !Array.isArray(messageIds)) return;
    const tg = this.store.state.telegram;
    const map = (tg.draftMessages = tg.draftMessages || {});
    for (const id of messageIds) if (Number.isInteger(id) && id > 0) map[`${chatId}:${id}`] = draftId;
    const keys = Object.keys(map);
    for (const k of keys.slice(0, Math.max(0, keys.length - DRAFT_MESSAGES_MAX))) delete map[k];
    this.store.saveState();
  }
  draftOfMessage(chatId, messageId) {
    return (this.store.state.telegram.draftMessages || {})[`${chatId}:${messageId}`] || null;
  }

  // Wywołanie „najlepszej próby” – błąd tylko logujemy (np. edycja przycisków starej wiadomości).
  async try(method, params) {
    try {
      return await this.call(method, params);
    } catch (e) {
      console.warn(`Telegram ${method}: ${e.message}`);
      return null;
    }
  }

  restart() {
    if (this.abort) this.abort.abort();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.loop().catch((e) => console.error(tr('Telegram poller zatrzymany:'), e));
  }

  // Zamykanie panelu: koniec odbioru wiadomości, obietnica końca obsługiwanej aktualizacji i publikacji w tle
  stop() {
    this.running = false;
    if (this.abort) this.abort.abort();
    return this.settled();
  }

  // obietnica końca zadań w tle (publikacje po ✅) i bieżącej aktualizacji
  async settled() {
    await Promise.allSettled([this.current, ...this.tasks]);
  }

  track(promise) {
    this.tasks.add(promise);
    promise.finally(() => this.tasks.delete(promise)).catch(() => {});
    return promise;
  }

  async loop() {
    const tg = this.store.state.telegram;
    while (this.running) {
      const token = this.token;
      if (!token) {
        this.setStatus(false, 'noToken', { username: '' });
        await sleep(3000);
        continue;
      }
      if (token !== this.tokenSeen) {
        this.tokenSeen = token;
        const tokenId = token.split(':')[0];
        if (tg.tokenId !== tokenId) {
          tg.tokenId = tokenId;
          tg.offset = 0;
        }
        try {
          const me = await this.call('getMe', {}, { token });
          this.setStatus(true, 'ok', { username: me.username || '' });
        } catch (e) {
          this.setStatus(false, 'error', { error: e.message, username: '' });
          this.tokenSeen = null;
          await sleep(15000);
          continue;
        }
      }
      this.abort = new AbortController();
      try {
        const updates = await this.call(
          'getUpdates',
          { offset: tg.offset || undefined, timeout: 25, allowed_updates: ['message', 'callback_query', 'my_chat_member'] },
          { token, timeout: 40000, signal: this.abort.signal },
        );
        this.setStatus(true, 'ok');
        for (const u of updates) {
          if (!this.running) break; // zamykanie panelu – reszta paczki przyjdzie po starcie (offset bez zmian)
          // Offset zapisujemy PRZED obsługą – kliknięcie nigdy nie zostanie opublikowane dwa razy.
          tg.offset = u.update_id + 1;
          this.store.saveState(true);
          this.current = this.handle(u).catch((e) => console.error(tr('Obsługa aktualizacji Telegrama:'), e.message));
          await this.current;
          this.current = null;
        }
      } catch (e) {
        if (e.name === 'AbortError') continue; // zmiana tokenu w ustawieniach
        const conflict = e.code === 409;
        if (conflict) this.setStatus(false, 'conflict');
        else this.setStatus(false, 'error', { error: e.message });
        await sleep(conflict ? 15000 : 5000);
      }
    }
  }

  rememberChat(chat) {
    if (!chat || chat.id === undefined) return;
    const tg = this.store.state.telegram;
    const title = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || (chat.username ? `@${chat.username}` : '');
    tg.chats = [{ id: String(chat.id), type: chat.type, title, username: chat.username || '', seenAt: new Date().toISOString() }]
      .concat((tg.chats || []).filter((c) => c.id !== String(chat.id)))
      .slice(0, 10);
    this.store.saveState();
  }

  allowedChats() {
    const ids = new Set([String(this.store.global.telegram.chatId || '')]);
    for (const b of this.store.bots) if (b.telegram.chatId) ids.add(String(b.telegram.chatId));
    ids.delete('');
    return ids;
  }

  // Czat ustawiony w Posterze i – gdy jest lista administratorów – użytkownik z tej listy (✅/❌ i /post)
  authorized(chatId, from) {
    const admins = this.store.global.telegram.adminIds || [];
    return this.allowedChats().has(String(chatId)) && (!admins.length || admins.includes(String(from && from.id)));
  }

  // Draft należy do tego czatu: to czat draftów jego bota (własny czat bota albo czat z Ustawień) albo wiadomość, której
  // dotyczy kliknięcie, jest zapamiętaną wiadomością tego draftu (zdarzenie „draft” z n8n – także po zmianie czatu
  // bota). Przy kilku botach z osobnymi czatami osoba z czatu jednego bota nie zatwierdzi, nie odrzuci ani nie zmieni
  // zdjęcia draftu innego bota spreparowanym kliknięciem z jego ID (klient Telegrama może wysłać dowolne callback_data).
  ownsDraft(draft, draftId, chatId, messageId) {
    if (this.draftOfMessage(chatId, messageId) === draftId) return true;
    const bot = draft && draft.botId ? this.store.bot(draft.botId) : this.store.bots[0];
    const home = String((bot && bot.telegram.chatId) || this.store.global.telegram.chatId || '');
    return !!home && home === String(chatId);
  }

  async handle(u) {
    if (u.my_chat_member) this.rememberChat(u.my_chat_member.chat);
    if (u.message) {
      const msg = u.message;
      this.rememberChat(msg.chat);
      const text = String(msg.text || '');
      if (/^\/(start|id)\b/.test(text)) {
        await this.try('sendMessage', {
          chat_id: msg.chat.id,
          parse_mode: 'HTML',
          text: tr(
            '👋 To jest bot <b>Poster</b>.\nID tego czatu: <code>{0}</code>\nWpisz je w panelu: <b>Ustawienia → Telegram → ID czatu</b> (albo kliknij „Wykryj”).',
            msg.chat.id,
          ),
        });
      }
      // post z Telegrama: tylko z czatów ustawionych w Posterze, inne wiadomości są pomijane
      if (POST_COMMAND.test(typeof msg.text === 'string' ? msg.text : String(msg.caption || ''))) {
        if (!this.authorized(msg.chat.id, msg.from)) {
          console.log(tr('Pominięto /post spoza dozwolonego czatu/użytkownika'), msg.from && msg.from.id);
          return;
        }
        return this.try('sendMessage', {
          chat_id: msg.chat.id,
          text: tr('✍️ Post z Telegrama (/post) jest w wersji PRO: {0}', productUrl(lang())),
        });
      }
      // zdjęcie w odpowiedzi na wiadomość draftu: podmiana grafiki draftu (tylko czaty ustawione w Posterze)
      if (this.photo && msg.reply_to_message && this.allowedChats().has(String(msg.chat.id))) return this.photo.message(msg);
      return;
    }
    const cq = u.callback_query;
    if (!cq) return;
    const answer = (text) => this.try('answerCallbackQuery', { callback_query_id: cq.id, text: text || undefined });
    // pub – publikacja / ponowienie nieudanych, rej – odrzucenie; po niepewnej publikacji (brak odpowiedzi platformy):
    // puc – post jest na profilu (zapisz jako opublikowany), pua – posta nie ma (wyślij ponownie także niepewne)
    const m = String(cq.data || '').match(/^(pub|pua|puc|rej):([A-Za-z0-9_-]{1,40})$/);
    if (!m || !cq.message) return answer('');

    if (!this.authorized(cq.message.chat.id, cq.from)) {
      console.log(tr('Pominięto kliknięcie spoza dozwolonego czatu/użytkownika'), cq.from && cq.from.id);
      return answer(tr('⛔ Brak uprawnień'));
    }
    const from = cq.from && cq.from.username ? `@${cq.from.username}` : (cq.from && (cq.from.first_name || String(cq.from.id))) || '?';
    const draftId = m[2];
    const unknown = { pua: 'retry', puc: 'confirm' }[m[1]];
    const ctx = { draftId, chatId: cq.message.chat.id, messageId: cq.message.message_id, from, ...(unknown ? { unknown } : {}) };
    // przyciski z adresem (np. „📝 Otwórz na X” – X ręcznie przez link) zostają pod draftem w trakcie publikacji
    const links = ((cq.message.reply_markup || {}).inline_keyboard || [])
      .map((row) => (Array.isArray(row) ? row.filter((b) => b && typeof b.url === 'string') : []))
      .filter((row) => row.length);
    const markup = (text, keep = true) => ({
      chat_id: ctx.chatId,
      message_id: ctx.messageId,
      reply_markup: { inline_keyboard: [[{ text, callback_data: 'noop' }], ...(keep ? links : [])] },
    });

    const draft = this.readDraft(draftId);
    if (!draft) return answer(tr('Nie znaleziono draftu na dysku'));
    if (!this.ownsDraft(draft, draftId, ctx.chatId, ctx.messageId)) {
      console.log(tr('Pominięto kliknięcie draftu z czatu innego bota'), draftId, cq.from && cq.from.id);
      return answer(tr('⛔ Brak uprawnień'));
    }
    // publikacja tego draftu już trwa (podwójne tapnięcie, dwóch administratorów): bez drugiej publikacji i bez
    // zmiany przycisków – pierwsze kliknięcie pokazuje „⏳ Publikuję…”, a wynik przyjdzie w raporcie
    if (this.isPublishing && this.isPublishing(draftId))
      return answer(tr('⏳ Ten draft właśnie się publikuje – wynik przyjdzie w raporcie'));

    if (m[1] === 'rej') {
      await answer(tr('❌ Odrzucono'));
      await this.try('editMessageReplyMarkup', markup(tr('❌ Odrzucono ({0})', from), false));
      return this.onReject(draft, ctx);
    }
    const busy = unknown === 'confirm' ? tr('⏳ Zapisuję…') : tr('⏳ Publikuję…');
    await answer(busy);
    await this.try('editMessageReplyMarkup', markup(busy));
    // Publikacja w tle: kolejne kliknięcia (też w innych draftach) nie czekają na start n8n (do 30 s). Blokada
    // „publikacja w toku” działa od razu – onPublish (runner.start) zapisuje przebieg, zanim zacznie czekać na n8n.
    this.track(this.startPublish(draft, ctx, m[1], links));
  }

  // action: pub | pua | puc – ten sam przycisk ponawia po błędzie; links – wiersze przycisków z adresem spod draftu
  async startPublish(draft, ctx, action, links = []) {
    const draftId = ctx.draftId;
    try {
      await this.onPublish(draft, ctx);
    } catch (e) {
      await this.try('editMessageReplyMarkup', {
        chat_id: ctx.chatId,
        message_id: ctx.messageId,
        reply_markup: {
          inline_keyboard: [
            [
              { text: tr('🔁 Spróbuj ponownie'), callback_data: `${action}:${draftId}` },
              { text: tr('❌ Odrzuć'), callback_data: `rej:${draftId}` },
            ],
            ...links,
          ],
        },
      });
      await this.try('sendMessage', {
        chat_id: ctx.chatId,
        text: tr('❗ Nie udało się uruchomić publikacji: {0}', e.message),
        reply_parameters: { message_id: ctx.messageId, allow_sending_without_reply: true },
      });
    }
  }

  readDraft(draftId) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(draftId)) return null;
    try {
      return JSON.parse(fs.readFileSync(path.join(this.filesDir, `${draftId}.json`), 'utf8'));
    } catch (e) {
      return null;
    }
  }
}

module.exports = { Telegram, POST_COMMAND };
