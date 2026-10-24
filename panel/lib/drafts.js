'use strict';
// Odczyt draftów zapisanych przez n8n w data/files (JSON + grafika + wideo) – panel ma tylko odczyt.
const fs = require('fs');
const path = require('path');

const DRAFT_RE = /^d\d{8}-\d{4}-[a-z0-9]{3,8}\.json$/;

class Drafts {
  constructor(filesDir, store) {
    this.dir = filesDir;
    this.store = store;
    this.cache = new Map(); // plik → { mtimeMs, summary }
  }

  list({ botId, limit = 60 } = {}) {
    let names = [];
    try {
      names = fs.readdirSync(this.dir).filter((n) => DRAFT_RE.test(n));
    } catch (e) {
      return [];
    }
    names.sort().reverse(); // nazwa zawiera datę i godzinę
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
    if (c && c.mtimeMs === st.mtimeMs) return this.withOverrides(c.summary);
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
      results: d.results || {},
      // news | manual (własny post z panelu)
      mode: d.mode === 'manual' ? 'manual' : 'news',
      // własny post: platformy wybrane w edytorze (null = wszystkie włączone w bocie) i tekst autora
      platforms: Array.isArray(d.platforms) ? d.platforms : null,
      composeText: d.composeText || '',
      // post z linkiem (tryb „link” albo brak grafiki): X dostał post_x_link
      linkMode: d.linkMode === true || !(d.image && d.image.file),
      post_x: d.post_x || '',
      post_x_link: d.post_x_link || '',
      post_fb_insta: d.post_fb_insta || '',
      script_tiktok: d.script_tiktok || '',
      whySelected: d.whySelected || '',
      approvedBy: d.approvedBy || '',
      lastAttemptAt: d.lastAttemptAt || null,
    };
    this.cache.set(name, { mtimeMs: st.mtimeMs, summary });
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

  markRejected(draftId, by) {
    const d = (this.store.state.drafts = this.store.state.drafts || {});
    d[draftId] = { status: 'rejected', rejectedBy: by, rejectedAt: new Date().toISOString() };
    const keys = Object.keys(d);
    if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete d[k];
    this.store.saveState();
  }
}

module.exports = { Drafts };
