'use strict';
// Drafty zapisane przez n8n w data/files (JSON + grafika + wideo): lista dla panelu, usuwanie starych draftów
// (ustawienie „Pliki draftów”) i wolne miejsce na dysku.
const fs = require('fs');
const path = require('path');

const DRAFT_RE = /^d\d{8}-\d{4}-[a-z0-9]{3,8}\.json$/;
// wszystkie pliki draftu: <draftId>.json, grafika (też własne zdjęcie z Telegrama: <draftId>-<losowe>.jpg) i wideo
const DRAFT_FILE_RE = /^(d\d{8}-\d{4}-[a-z0-9]{3,8})(?:-[a-z0-9]{2,12})?\.(json|jpe?g|png|webp|mp4)$/;
const CACHE_MAX = 1000; // podsumowania draftów w pamięci (najdawniej używane wypadają)
const NAMES_MAX_AGE_MS = 60000; // lista plików odświeżana też co minutę (system plików bez zmian czasu katalogu)
const DAY_MS = 86400 * 1000;

// podobne posty zapisane w drafcie przez workflow – tylko znane pola i bezpieczne linki (trafiają do href w panelu)
const httpUrl = (u) => (/^https?:\/\/\S+$/i.test(String(u || '')) ? String(u) : '');
function similarOf(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((m) => m && typeof m === 'object' && m.id)
    .slice(0, 3)
    .map((m) => ({
      id: String(m.id).slice(0, 40),
      at: String(m.at || ''),
      status: String(m.status || ''),
      title: String(m.title || '').slice(0, 300),
      link: httpUrl(m.link),
      url: httpUrl(m.url),
      same: m.same === 'link' ? 'link' : 'text',
    }));
}

class Drafts {
  constructor(filesDir, store) {
    this.dir = filesDir;
    this.store = store;
    this.cache = new Map(); // plik → { mtimeMs, summary }; kolejność = ostatnie użycie
    this.names = null; // { mtimeMs, at, list } – nazwy plików draftów od najnowszego
  }

  // Nazwy plików JSON draftów od najnowszego. Katalog (tysiące plików po roku) czytany ponownie tylko po zmianie –
  // nowy albo usunięty plik zmienia czas modyfikacji katalogu – i najrzadziej co minutę.
  draftNames() {
    let st;
    try {
      st = fs.statSync(this.dir);
    } catch (e) {
      return [];
    }
    const c = this.names;
    if (c && c.mtimeMs === st.mtimeMs && Date.now() - c.at < NAMES_MAX_AGE_MS) return c.list;
    let list = [];
    try {
      list = fs.readdirSync(this.dir).filter((n) => DRAFT_RE.test(n));
    } catch (e) {
      return [];
    }
    list.sort().reverse(); // nazwa zawiera datę i godzinę
    this.names = { mtimeMs: st.mtimeMs, at: Date.now(), list };
    return list;
  }

  list({ botId, limit = 60 } = {}) {
    const names = this.draftNames();
    const out = [];
    for (const name of names.slice(0, 800)) {
      const d = this.summary(name);
      if (!d) continue;
      if (botId && d.botId !== botId) continue;
      out.push(d);
      if (out.length >= limit) break;
    }
    return out;
  }

  summary(name) {
    const file = path.join(this.dir, name);
    let st;
    try {
      st = fs.statSync(file);
    } catch (e) {
      return null;
    }
    const c = this.cache.get(name);
    if (c && c.mtimeMs === st.mtimeMs) {
      this.cache.delete(name); // ostatnio użyte na koniec kolejki
      this.cache.set(name, c);
      return this.withOverrides(c.summary);
    }
    const d = this.read(name.replace(/\.json$/, ''));
    if (!d) return null;
    const bot = d.botId ? this.store.bot(d.botId) : null;
    const summary = {
      draftId: d.draftId,
      botId: d.botId || null,
      botName: (bot && bot.name) || d.botName || '',
      createdAt: d.createdAt,
      status: d.status || 'draft',
      title: (d.news && d.news.title) || '',
      source: (d.news && d.news.source) || '',
      url: (d.news && d.news.url) || '',
      image: d.image && d.image.file ? d.image.file : null,
      // skąd grafika: source (ze źródła), upload (Twoje zdjęcie – z edytora albo z Telegrama), brand (grafika marki)
      imageSource: d.image && d.image.file ? String(d.image.source || '') : '',
      results: d.results || {},
      // news | manual (własny post z panelu)
      mode: d.mode === 'manual' ? 'manual' : 'news',
      // własny post: platformy wybrane w edytorze (null = wszystkie włączone w bocie) i tekst autora
      platforms: Array.isArray(d.platforms) ? d.platforms : null,
      // draft z newsów: platformy włączone w chwili jego powstania (null = draft sprzed tej informacji)
      targets: Array.isArray(d.targets) ? d.targets : null,
      composeText: d.composeText || '',
      // post z linkiem (tryb „link” albo brak grafiki): X dostał post_x_link
      linkMode: d.linkMode === true || !(d.image && d.image.file),
      post_x: d.post_x || '',
      post_x_link: d.post_x_link || '',
      // X ręcznie przez link: oficjalny link X do nowego posta z gotowym tekstem (przycisk „Otwórz na X”)
      xIntent: /^https:\/\/x\.com\/intent\/tweet\?/.test(String(d.xIntent || '')) ? d.xIntent : '',
      post_fb_insta: d.post_fb_insta || '',
      script_tiktok: d.script_tiktok || '',
      whySelected: d.whySelected || '',
      // sprawdzanie powtórek: podobne wcześniejsze posty bota (lib/similar.js)
      similar: similarOf(d.similar),
      approvedBy: d.approvedBy || '',
      lastAttemptAt: d.lastAttemptAt || null,
    };
    this.cache.delete(name);
    this.cache.set(name, { mtimeMs: st.mtimeMs, summary });
    if (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value);
    return this.withOverrides(summary);
  }

  withOverrides(s) {
    const o = (this.store.state.drafts || {})[s.draftId];
    return o && s.status === 'draft' ? { ...s, ...o } : s;
  }

  read(draftId) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(draftId)) return null;
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir, `${draftId}.json`), 'utf8'));
    } catch (e) {
      return null;
    }
  }

  // Usuwa drafty, których żaden plik (tekst, grafika, wideo) nie zmienił się od `days` dni – razem, żeby draft nie
  // został bez zdjęcia. skip(draftId) – draft, którego nie wolno teraz usunąć (np. publikacja w toku).
  // Zwraca liczbę usuniętych draftów.
  prune(days, { now = Date.now(), skip = () => false } = {}) {
    if (!(days > 0)) return 0;
    const cutoff = now - days * DAY_MS;
    const groups = new Map();
    let names = [];
    try {
      names = fs.readdirSync(this.dir);
    } catch (e) {
      return 0;
    }
    for (const name of names) {
      const m = name.match(DRAFT_FILE_RE);
      if (!m) continue;
      let st;
      try {
        st = fs.lstatSync(path.join(this.dir, name));
      } catch (e) {
        continue;
      }
      if (!st.isFile()) continue;
      const g = groups.get(m[1]) || { files: [], newest: 0 };
      g.files.push(name);
      g.newest = Math.max(g.newest, st.mtimeMs);
      groups.set(m[1], g);
    }
    let removed = 0;
    for (const [draftId, g] of groups) {
      if (g.newest >= cutoff || skip(draftId)) continue;
      let deleted = 0; // bez uprawnień do pliku (np. inny właściciel niż 1000) draft zostaje i nie jest liczony
      for (const name of g.files) {
        try {
          fs.unlinkSync(path.join(this.dir, name));
          deleted++;
        } catch (e) {}
      }
      if (!deleted) continue;
      this.cache.delete(`${draftId}.json`);
      removed++;
    }
    if (removed) this.names = null;
    return removed;
  }

  // Wolne miejsce na dysku z draftami: { free: bajty albo null (system nie podaje), low: mniej niż 1 GB }
  disk() {
    let free = null;
    try {
      const s = fs.statfsSync(this.dir);
      free = Number(s.bavail) * Number(s.bsize);
    } catch (e) {}
    const min = Number(process.env.POSTER_LOW_DISK_BYTES) || 1024 ** 3;
    return { free, low: free !== null && free < min };
  }

  markRejected(draftId, by) {
    const d = (this.store.state.drafts = this.store.state.drafts || {});
    d[draftId] = { status: 'rejected', rejectedBy: by, rejectedAt: new Date().toISOString() };
    const keys = Object.keys(d);
    if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete d[k];
    this.store.saveState();
  }
}

module.exports = { Drafts };
