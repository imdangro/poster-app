'use strict';
// Własne zdjęcie w drafcie: w Telegramie odpowiadasz zdjęciem (albo plikiem JPG, PNG lub WebP) na wiadomość draftu,
// a panel podmienia nim grafikę draftu, zanim klikniesz ✅. Zdjęcie przyjmuje tylko od osób, które mogą klikać ✅
// (lib/telegram.js → authorized), i tylko dla draftu, który czeka na akceptację – nie w trakcie ani po publikacji.
// Draft rozpoznaje po wiadomości, na którą odpowiadasz: wiadomości draftu zapamiętane ze zdarzenia „draft” z n8n
// (nagłówek, teksty, przyciski), przyciski ✅/❌ albo kod draftu w nagłówku.
// Zdjęcie: getFile (do 20 MB) → JPG do 2048 px (ffmpeg, przezroczystość na białym tle), w PRO przy Instagramie środek
// kadru w proporcjach 4:5–1,91:1. Nowy plik <draft>-<losowe>.jpg w data/files (nowa nazwa – panel nie pokaże starego
// zdjęcia z pamięci przeglądarki), stary plik znika, a draft dostaje image.source = upload. Publikacja (n8n) czyta
// grafikę z pliku draftu, więc ✅ opublikuje już nowe zdjęcie.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { HttpError, randomId, writeJsonAtomic } = require('./util');
const { sniffImage, imageSize } = require('./media');
const { convertWebp, fitJpeg } = require('./ffmpeg');
const { esc } = require('./html');
const { tr } = require('./i18n');

const MAX_BYTES = 20 * 1024 * 1024; // pliki do 20 MB – limit pobierania przez Bot API (getFile)
const MAX_SIDE = 2048;
const MAX_JPEG = 5 * 1024 * 1024; // limit zdjęć X
const IMAGE_TYPES = /^image\/(jpeg|png|webp)$/;
const DRAFT_ID = /^d\d{8}-\d{4}-[a-z0-9]{3,8}$/;
const DRAFT_ID_IN_TEXT = /\bd\d{8}-\d{4}-[a-z0-9]{3,8}\b/;
const ALBUM_MS = 5 * 60 * 1000; // album (kilka zdjęć naraz): tylko pierwsze

// Zdjęcie (największy rozmiar) albo plik obrazka z wiadomości: { id, size } | { error } | null – to nie zdjęcie
function photoOf(msg) {
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const p = msg.photo[msg.photo.length - 1];
    return { id: p.file_id, size: p.file_size || 0 };
  }
  const d = msg.document;
  if (d && /^image\//.test(String(d.mime_type || ''))) {
    if (!IMAGE_TYPES.test(d.mime_type)) return { error: tr('Wyślij zdjęcie jako zdjęcie albo plik JPG, PNG lub WebP') };
    return { id: d.file_id, size: d.file_size || 0 };
  }
  return null;
}

class DraftPhoto {
  // telegram – lib/telegram.js (wiadomości, pobieranie plików, uprawnienia); isPublishing(draftId) – publikacja w toku
  constructor(store, { telegram, filesDir, isPublishing = () => false }) {
    this.store = store;
    this.telegram = telegram;
    this.filesDir = filesDir;
    this.isPublishing = isPublishing;
    this.albums = new Map(); // media_group_id → czas (pierwsze zdjęcie albumu już obsłużone)
  }

  // ID draftu z wiadomości tego bota, na którą odpowiedziano; null – to nie wiadomość draftu
  draftOf(msg) {
    const r = msg.reply_to_message;
    const botId = String(this.telegram.token).split(':')[0];
    if (!r || (r.from && String(r.from.id) !== botId)) return null;
    const known = this.telegram.draftOfMessage(msg.chat.id, r.message_id);
    if (known) return known;
    for (const row of (r.reply_markup && r.reply_markup.inline_keyboard) || []) {
      for (const b of Array.isArray(row) ? row : []) {
        const m = /^(?:pub|pua|puc|rej):([A-Za-z0-9_-]{1,40})$/.exec(String((b && b.callback_data) || ''));
        if (m) return m[1];
      }
    }
    const m = DRAFT_ID_IN_TEXT.exec(String(r.caption || r.text || ''));
    return m ? m[0] : null;
  }

  // Wiadomość w odpowiedzi na wiadomość bota w czacie ustawionym w Posterze (sprawdza lib/telegram.js)
  async message(msg) {
    const photo = photoOf(msg);
    if (!photo) return; // tekst albo inny plik w odpowiedzi – nie dotyczy zdjęcia draftu
    const draftId = this.draftOf(msg);
    if (!draftId) return;
    const chatId = msg.chat.id;
    const reply = (html) =>
      this.telegram.try('sendMessage', {
        chat_id: chatId,
        text: html,
        parse_mode: 'HTML',
        reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true },
      });
    if (!this.telegram.authorized(chatId, msg.from)) {
      return reply(
        tr('⛔ Zdjęcie w drafcie podmieni tylko osoba, która może zatwierdzać drafty (Ustawienia → Telegram → ID administratorów).'),
      );
    }
    // draft innego bota (osobny czat) – zdjęcie podmienia się tylko w czacie draftów jego bota
    const target = this.telegram.readDraft(draftId);
    if (target && !this.telegram.ownsDraft(target, draftId, chatId, msg.reply_to_message.message_id)) {
      return reply(tr('⛔ Ten draft należy do innego czatu – zdjęcie podmienisz w czacie jego bota.'));
    }
    // album: tylko pierwsze zdjęcie (każde przychodzi jako osobna wiadomość)
    if (msg.media_group_id) {
      const now = Date.now();
      for (const [k, at] of this.albums) if (now - at > ALBUM_MS) this.albums.delete(k);
      if (this.albums.has(msg.media_group_id)) return;
      this.albums.set(msg.media_group_id, now);
    }
    if (photo.error) return reply(`❗ ${esc(photo.error)}`);
    if (photo.size > MAX_BYTES) return reply(tr('❗ Zdjęcie może mieć najwyżej 20 MB'));
    const refused = this.refusal(draftId);
    if (refused) return reply(refused);
    try {
      const { draft, img, notes } = await this.replace(draftId, photo);
      const from = msg.from && msg.from.username ? `@${msg.from.username}` : (msg.from && msg.from.first_name) || '';
      console.log(tr('Zdjęcie draftu {0} podmienione ({1})', draftId, from || '?'));
      await this.telegram.try('sendPhoto', {
        chat_id: chatId,
        photo: { data: img.buffer, filename: `${draftId}.jpg`, contentType: 'image/jpeg' },
        caption: [
          tr('🖼 <b>Zdjęcie podmienione</b> · <code>{0}</code>', esc(draftId)),
          tr('✅ pod draftem opublikuje to zdjęcie.'),
          draft.linkMode ? tr('X i Facebook: post z linkiem (tryb grafiki bota) – zdjęcie trafi na pozostałe platformy.') : '',
          ...notes,
        ]
          .filter(Boolean)
          .join('\n'),
        parse_mode: 'HTML',
        reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true },
      });
    } catch (e) {
      if (!e.status) console.error(tr('Zdjęcie draftu {0}:', draftId), e.stderr || e.message);
      await reply(tr('❗ Nie udało się podmienić zdjęcia: {0}', esc(e.message)));
    }
  }

  // Draft, którego zdjęcia nie wolno już zmienić: powód (HTML) albo '' – draft czeka na akceptację
  refusal(draftId) {
    const draft = this.telegram.readDraft(draftId);
    if (!draft) return tr('❗ Nie znaleziono draftu <code>{0}</code> na dysku.', esc(draftId));
    if (this.isPublishing(draftId)) return tr('⏳ Ten draft właśnie się publikuje – zdjęcie podmienisz tylko przed ✅.');
    if (((this.store.state.drafts || {})[draftId] || {}).status === 'rejected')
      return tr('ℹ️ Ten draft jest odrzucony – zdjęcia już nie podmienię.');
    if ((draft.status || 'draft') !== 'draft') return tr('ℹ️ Ten draft jest już po publikacji – zdjęcie podmienisz tylko przed ✅.');
    return '';
  }

  // Pobranie, JPG do 2048 px (PRO: kadr pod Instagram) i zapis w drafcie → { draft, img, notes }
  async replace(draftId, photo) {
    let buffer = await this.telegram.downloadFile(photo.id, MAX_BYTES);
    if (!buffer) throw new HttpError(400, tr('Zdjęcie może mieć najwyżej 20 MB'));
    let type = sniffImage(buffer);
    if (type === 'image/webp') {
      const conv = await convertWebp(buffer).catch(() => null);
      if (!conv) throw new HttpError(400, tr('Nie udało się odczytać zdjęcia WebP (animowane?) – wyślij JPG albo PNG'));
      ({ buffer } = conv);
      type = conv.mimeType;
    }
    if (!['image/jpeg', 'image/png'].includes(type))
      throw new HttpError(400, tr('Wyślij zdjęcie jako zdjęcie albo plik JPG, PNG lub WebP'));
    const dims = imageSize(buffer);
    if (!dims.width || !dims.height) throw new HttpError(400, tr('Nie udało się odczytać wymiarów zdjęcia'));
    const notes = [];
    const ratio = null;
    let img = await fitJpeg({ buffer, ...dims }, { ratio, maxSide: MAX_SIDE, flatten: type === 'image/png' });
    if (img.buffer.length > MAX_JPEG) img = await fitJpeg({ buffer, ...dims }, { ratio, maxSide: 1600, flatten: type === 'image/png' });
    // przez pobieranie i konwersję draft mógł się zmienić (❌, publikacja) – sprawdzamy jeszcze raz przed zapisem
    const refused = this.refusal(draftId);
    if (refused) throw new HttpError(409, refused.replace(/<[^>]+>/g, ''));
    return { draft: this.save(this.telegram.readDraft(draftId), img), img, notes };
  }

  // Nowy plik zdjęcia i draft z nim (zapis atomowy, uprawnienia jak plik draftu z n8n), stary plik zdjęcia znika
  save(draft, img) {
    const id = String(draft.draftId || '');
    if (!DRAFT_ID.test(id)) throw new HttpError(400, tr('Niepoprawne ID draftu'));
    const jsonPath = path.join(this.filesDir, `${id}.json`);
    let mode = 0o644;
    try {
      mode = fs.statSync(jsonPath).mode & 0o777;
    } catch (e) {}
    const file = `${id}-${randomId(4)}.jpg`;
    writeFileAtomic(path.join(this.filesDir, file), img.buffer, mode);
    const old = draft.image && draft.image.file;
    // tryb grafiki „link” (np. własna strona): X i Facebook dalej publikują post z linkiem, zdjęcie idzie na pozostałe
    const next = {
      ...draft,
      image: { file, mimeType: 'image/jpeg', sizeBytes: img.buffer.length, source: 'upload', width: img.width, height: img.height },
      linkMode: draft.mode !== 'manual' && draft.imageMode === 'link',
    };
    try {
      writeJsonAtomic(jsonPath, next, mode);
    } catch (e) {
      fs.rmSync(path.join(this.filesDir, file), { force: true });
      throw e;
    }
    if (old && old !== file && /^[A-Za-z0-9._-]+$/.test(old) && old.startsWith(id))
      fs.rmSync(path.join(this.filesDir, old), { force: true });
    return next;
  }
}

// Zapis pliku przez plik tymczasowy i zmianę nazwy – n8n nie odczyta połowy zdjęcia
function writeFileAtomic(file, data, mode) {
  const tmp = `${file}.${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, data, { mode, flag: 'wx' });
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

module.exports = { DraftPhoto, photoOf };
