'use strict';
// Telegram: odbieranie kliknięć ✅/❌ (long-polling getUpdates – NAS nie musi być wystawiony do internetu),
// wykrywanie ID czatów (/start), komenda /post (post z Telegrama, PRO) oraz wysyłanie powiadomień z panelu.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sleep, HttpError, PRODUCT_URL } = require('./util');
const { UPSTREAM } = require('./accounts');
const { tr } = require('./i18n');

// /post albo /post@nazwa_bota na początku wiadomości albo podpisu zdjęcia
const POST_COMMAND = /^\/post(?:@[A-Za-z0-9_]+)?(?=\s|$)/i;

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
  constructor(store, { filesDir, onPublish, onReject }) {
    this.store = store;
    this.filesDir = filesDir;
    this.onPublish = onPublish;
    this.onReject = onReject;
    this.running = false;
    this.conn = { ok: false, code: 'idle', error: '', username: '' };
    this.abort = null;
    this.tokenSeen = null;
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
      throw new HttpError(
        502,
        tr('Brak połączenia z Telegramem: {0}', e.name === 'TimeoutError' ? tr('przekroczono czas') : e.cause?.code || e.message),
      );
    }
    const data = await res.json().catch(() => null);
    if (!data || data.ok !== true) {
      const err = new HttpError(
        res.status === 401 || res.status === 404 ? 400 : 502,
        `Telegram: ${(data && data.description) || `HTTP ${res.status}`}`,
      );
      err.code = data && data.error_code;
      err.description = (data && data.description) || '';
      err.retryAfter = (data && data.parameters && data.parameters.retry_after) || 0; // 429: za ile sekund ponowić
      err.migrateTo = (data && data.parameters && data.parameters.migrate_to_chat_id) || 0; // grupa → supergrupa (nowe ID)
      throw err;
    }
    return data.result;
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
          // Offset zapisujemy PRZED obsługą – kliknięcie nigdy nie zostanie opublikowane dwa razy.
          tg.offset = u.update_id + 1;
          this.store.saveState(true);
          await this.handle(u).catch((e) => console.error(tr('Obsługa aktualizacji Telegrama:'), e.message));
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
          text: tr('✍️ Post z Telegrama (/post) jest w wersji PRO: {0}', PRODUCT_URL),
        });
      }
      return;
    }
    const cq = u.callback_query;
    if (!cq) return;
    const answer = (text) => this.try('answerCallbackQuery', { callback_query_id: cq.id, text: text || undefined });
    const m = String(cq.data || '').match(/^(pub|rej):([A-Za-z0-9_-]{1,40})$/);
    if (!m || !cq.message) return answer('');

    if (!this.authorized(cq.message.chat.id, cq.from)) {
      console.log(tr('Pominięto kliknięcie spoza dozwolonego czatu/użytkownika'), cq.from && cq.from.id);
      return answer(tr('⛔ Brak uprawnień'));
    }
    const from = cq.from && cq.from.username ? `@${cq.from.username}` : (cq.from && (cq.from.first_name || String(cq.from.id))) || '?';
    const draftId = m[2];
    const ctx = { draftId, chatId: cq.message.chat.id, messageId: cq.message.message_id, from };
    const markup = (text) => ({
      chat_id: ctx.chatId,
      message_id: ctx.messageId,
      reply_markup: { inline_keyboard: [[{ text, callback_data: 'noop' }]] },
    });

    const draft = this.readDraft(draftId);
    if (!draft) return answer(tr('Nie znaleziono draftu na dysku'));

    if (m[1] === 'rej') {
      await answer(tr('❌ Odrzucono'));
      await this.try('editMessageReplyMarkup', markup(tr('❌ Odrzucono ({0})', from)));
      return this.onReject(draft, ctx);
    }
    await answer(tr('⏳ Publikuję…'));
    await this.try('editMessageReplyMarkup', markup(tr('⏳ Publikuję…')));
    try {
      await this.onPublish(draft, ctx);
    } catch (e) {
      await this.try('editMessageReplyMarkup', {
        chat_id: ctx.chatId,
        message_id: ctx.messageId,
        reply_markup: {
          inline_keyboard: [
            [
              { text: tr('🔁 Spróbuj ponownie'), callback_data: `pub:${draftId}` },
              { text: tr('❌ Odrzuć'), callback_data: `rej:${draftId}` },
            ],
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
